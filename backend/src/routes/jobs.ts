import { Router } from 'express';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/client';
import { jobs } from '../db/schema';
import { buildPaperKey, buildResultKey, sanitizeFileName } from '../storage/paths';
import { getSignedUploadUrl } from '../storage/supabaseAdapter';
import { files as filesTable } from '../db/schema';
import { fetch } from 'undici';
import { parseDatasetConfig } from '../utils/datasetConfig';
import { getAuthedUser, getOwnedJob, getOwnedProject, logAuthzDenied } from '../authz/ownership';
import { logger } from '../utils/logger';
import { formatRunIdFromDateUtc } from '../utils/runId';

export const jobsRouter = Router();

const MODAL_RUNNER_URL = (process.env.MODAL_RUNNER_URL || '').trim();
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').trim();

function getBaseUrl(req: any): string {
	// Prefer configured base URL (recommended for prod behind proxies)
	if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/+$/, '');
	// Fallback for local dev
	const proto = req?.protocol || 'http';
	const host = req?.get?.('host') || 'localhost:4000';
	return `${proto}://${host}`;
}

function getJobMeta(job: any): Record<string, unknown> {
	return job?.metadata && typeof job.metadata === 'object' ? (job.metadata as Record<string, unknown>) : {};
}

function getJobToken(job: any): string | null {
	const meta = getJobMeta(job);
	const t = meta?.jobToken;
	return typeof t === 'string' && t.trim().length > 0 ? t.trim() : null;
}

function getTraceId(job: any): string | null {
	const meta = getJobMeta(job);
	const t = meta?.traceId;
	return typeof t === 'string' && t.trim().length > 0 ? t.trim() : null;
}

function getRunId(job: any): string | null {
	const meta = getJobMeta(job);
	const r = meta?.runId;
	return typeof r === 'string' && r.trim().length > 0 ? r.trim() : null;
}

function isAllowedResultExt(fileName: string): boolean {
	const ext = path.extname(fileName).toLowerCase();
	return ext === '.png' || ext === '.csv';
}

function inferFileTypeFromName(fileName: string): 'img' | 'csv' | 'other' {
	const ext = path.extname(fileName).toLowerCase();
	if (ext === '.png') return 'img';
	if (ext === '.csv') return 'csv';
	return 'other';
}

async function upsertFile(opts: {
	projectId: string;
	jobId?: string | null;
	path: string;
	type: any;
	content?: string | null;
	storageKey?: string | null;
	mimeType?: string | null;
	sizeBytes?: number | null;
	sha256?: string | null;
	origin?: 'user' | 'agent' | 'job';
}): Promise<void> {
	const existing = await db
		.select({ id: filesTable.id })
		.from(filesTable)
		.where(and(eq(filesTable.projectId, opts.projectId), eq(filesTable.path, opts.path)));
	const row = {
		projectId: opts.projectId,
		path: opts.path,
		type: opts.type,
		content: opts.content ?? null,
		storageKey: opts.storageKey ?? null,
		mimeType: opts.mimeType ?? null,
		sizeBytes: opts.sizeBytes ?? null,
		sha256: opts.sha256 ?? null,
		origin: opts.origin ?? 'job',
		jobId: opts.jobId ?? null,
	};
	if (existing[0]?.id) {
		await db.update(filesTable).set(row as any).where(eq(filesTable.id, existing[0].id));
	} else {
		await db.insert(filesTable).values(row as any);
	}
}

// POST /experiment/:projectId/run -> create job + call Modal runner
jobsRouter.post('/experiment/:projectId/run', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const projectId = String(req.params.projectId);
		const owned = await getOwnedProject(projectId, user.id);
		if (!owned) {
			logAuthzDenied(req, { projectId });
			return res.status(404).json({ error: 'Project not found' });
		}
		const traceId = crypto.randomUUID();
		const jobToken = crypto.randomUUID();

		logger.info('jobs.run.start', { traceId, projectId });

		if (!MODAL_RUNNER_URL) {
			return res.status(500).json({ error: 'MODAL_RUNNER_URL is not set' });
		}

		const jobId = crypto.randomUUID();
		const inserted = await db
			.insert(jobs)
			.values({
				id: jobId,
				projectId,
				type: 'experiment_run',
				status: 'queued',
				metadata: { traceId, jobToken },
			})
			.returning({ createdAt: jobs.createdAt });
		const createdAt = inserted[0]?.createdAt instanceof Date ? inserted[0].createdAt : new Date();
		const runId = formatRunIdFromDateUtc(createdAt);
		// Persist runId into metadata so downstream endpoints (presign/complete) can look it up cheaply.
		await db.update(jobs).set({ metadata: { traceId, jobToken, runId } as any }).where(eq(jobs.id, jobId));
		logger.info('job.enqueue', { requestId: req.requestId || null, traceId, jobId, projectId, userId: user.id });
		logger.debug('jobs.run.job_created', { traceId, jobId, projectId });

		const all = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
		const exp = all.find((f) => f.path === 'Experimentation/experiment.py' && f.type === 'py')?.content ?? '';
		const datasetJson = all.find((f) => f.path === 'Design/dataset.json' && f.type === 'txt')?.content ?? '';
		const requirementsTxt =
			all.find((f) => f.path === 'Experimentation/requirements.txt' && f.type === 'txt')?.content ?? '';

		if (!exp || exp.trim().length === 0) {
			logger.warn('jobs.run.missing_experiment', { traceId, jobId, projectId });
			await db.update(jobs).set({ status: 'failed', output: 'Experimentation/experiment.py is empty', endedAt: new Date() }).where(eq(jobs.id, jobId));
			return res.status(400).json({ error: 'Experimentation/experiment.py is empty', jobId });
		}
		if (!datasetJson || datasetJson.trim().length === 0) {
			logger.warn('jobs.run.missing_dataset', { traceId, jobId, projectId });
			await db.update(jobs).set({ status: 'failed', output: 'Design/dataset.json is empty', endedAt: new Date() }).where(eq(jobs.id, jobId));
			return res.status(400).json({ error: 'Design/dataset.json is empty', jobId });
		}

		// Logging-only parse for debugging (do not block)
		const parsed = parseDatasetConfig(datasetJson);
		logger.debug('jobs.run.inputs_loaded', {
			traceId,
			jobId,
			projectId,
			expLen: exp.length,
			datasetLen: datasetJson.length,
			requirementsLen: requirementsTxt.length,
			datasetParseOk: parsed.ok,
			datasetError: parsed.ok ? undefined : parsed.error,
			kaggleDataset: parsed.ok ? parsed.value.kaggle.dataset : undefined,
		});

		const baseUrl = getBaseUrl(req);
		const presignUrl = `${baseUrl}/jobs/${jobId}/artifacts/presign`;
		const completeUrl = `${baseUrl}/jobs/${jobId}/complete`;

		// Modal prints the full web function URL (typically rooted at "/"), e.g.
		//   https://<workspace>--<app>-<function>.modal.run
		// So MODAL_RUNNER_URL should be set to that full URL and we should not append "/run" here.
		const runnerUrl = `${MODAL_RUNNER_URL.replace(/\/+$/, '')}`;
		logger.debug('jobs.run.modal_call', { traceId, jobId, runnerUrl, presignUrl, completeUrl });

		const payload = {
			traceId,
			jobId,
			runId,
			projectId,
			jobToken,
			experimentPy: exp,
			requirementsTxt,
			datasetJson,
			presignUrl,
			completeUrl,
		};

		const resp = await fetch(runnerUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});

		if (!resp.ok) {
			const body = await resp.text().catch(() => '');
			logger.warn('jobs.run.modal_rejected', {
				traceId,
				jobId,
				status: resp.status,
				body: body.slice(0, 2000),
			});
			await db
				.update(jobs)
				.set({ status: 'failed', output: `Modal runner rejected: HTTP ${resp.status}`, endedAt: new Date() })
				.where(eq(jobs.id, jobId));
			return res.status(502).json({ error: 'Modal runner rejected', details: `HTTP ${resp.status}`, jobId });
		}

		// Mark as running, but ONLY if the job is still queued.
		// Modal can fail fast and call /complete before we reach this point; we must not overwrite
		// a terminal status (completed/failed) back to running.
		const runningRows = await db
			.update(jobs)
			.set({ status: 'running', startedAt: new Date() })
			.where(and(eq(jobs.id, jobId), eq(jobs.status, 'queued')))
			.returning({ id: jobs.id });
		if (runningRows.length === 0) {
			const [cur] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
			logger.debug('jobs.run.running_skipped', {
				traceId,
				jobId,
				currentStatus: cur?.status,
			});
		}
		logger.info('jobs.run.modal_accepted', { traceId, jobId });
		return res.status(200).json({ jobId, runId });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to enqueue experiment';
		return res.status(500).json({ error: message });
	}
});

// POST /paper/:projectId/compile (stub)
jobsRouter.post('/paper/:projectId/compile', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const projectId = String(req.params.projectId);
		const owned = await getOwnedProject(projectId, user.id);
		if (!owned) {
			logAuthzDenied(req, { projectId });
			return res.status(404).json({ error: 'Project not found' });
		}
		logger.debug('jobs.compile.enqueue', { projectId });
		const id = crypto.randomUUID();
		await db.insert(jobs).values({ id, projectId, type: 'paper_compile', status: 'queued' });
		return res.status(200).json({ jobId: id });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to enqueue compile';
		return res.status(500).json({ error: message });
	}
});

// POST /jobs/:jobId/artifacts/presign
// Body: { items: [{ fileName: string, mimeType?: string, sizeBytes?: number }] }
// Returns: { uploads: [{ key, signedUrl, token, fileName, mimeType }] }
jobsRouter.post('/:jobId/artifacts/presign', async (req, res) => {
	try {
		const jobId = String(req.params.jobId);
		const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
		if (!job) return res.status(404).json({ error: 'Job not found' });

		const traceId = getTraceId(job) || crypto.randomUUID();
		const expectedToken = getJobToken(job);
		const providedToken = typeof req.body?.token === 'string' ? String(req.body.token).trim() : '';
		if (expectedToken && providedToken !== expectedToken) {
			logger.warn('jobs.presign.denied', { traceId, jobId, reason: 'invalid token' });
			return res.status(401).json({ error: 'Invalid token' });
		}

		const items: Array<{ fileName: string; mimeType?: string; sizeBytes?: number }> =
			Array.isArray(req.body?.items) ? req.body.items : [];
		if (!items.length) {
			return res.status(400).json({ error: 'No items provided' });
		}
		logger.info('job.presign', { requestId: req.requestId || null, traceId, jobId, projectId: job.projectId, count: items.length });
		logger.debug('jobs.presign.start', {
			traceId,
			jobId,
			count: items.length,
			names: items.map((i) => i.fileName).slice(0, 30),
		});

		const uploads = await Promise.all(
			items.map(async (item) => {
				const safeName = sanitizeFileName(item.fileName);
				if (job.type !== 'paper_compile' && !isAllowedResultExt(safeName)) {
					throw new Error(`Disallowed artifact extension: ${safeName}`);
				}
				// For experiment runs, artifacts are stored under projects/<projectId>/results/<runId>/...
				// For paper compile, the convention is fixed: paper.pdf under paper/<jobId>/paper.pdf
				const runId =
					job.type === 'paper_compile'
						? null
						: getRunId(job) ||
							(job.createdAt instanceof Date ? formatRunIdFromDateUtc(job.createdAt) : null);
				if (job.type !== 'paper_compile' && !runId) {
					throw new Error('Missing runId for job');
				}
				const key =
					job.type === 'paper_compile'
						? buildPaperKey(job.projectId, job.id) // enforce 'paper.pdf' by convention
						: buildResultKey(job.projectId, runId as string, safeName);

				const signed = await getSignedUploadUrl(key);
				return { ...signed, fileName: safeName, mimeType: item.mimeType };
			}),
		);

		logger.debug('jobs.presign.ok', { traceId, jobId, count: uploads.length });
		return res.status(200).json({ uploads });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to presign uploads';
		// Most common failure is invalid requested artifact types -> treat as 400.
		const isBadRequest = /Disallowed artifact extension/i.test(message);
		return res.status(isBadRequest ? 400 : 500).json({ error: message });
	}
});

// POST /jobs/:jobId/complete
// Body: { token: string, traceId?: string, exitCode: number, resultsText: string, artifacts?: [{ path, storageKey, mimeType?, sizeBytes?, sha256? }] }
jobsRouter.post('/:jobId/complete', async (req, res) => {
	try {
		const jobId = String(req.params.jobId);
		const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
		if (!job) return res.status(404).json({ error: 'Job not found' });
		const traceId = (typeof req.body?.traceId === 'string' && req.body.traceId.trim().length > 0 ? req.body.traceId.trim() : null) || getTraceId(job) || crypto.randomUUID();
		const runId = getRunId(job) || (job.createdAt instanceof Date ? formatRunIdFromDateUtc(job.createdAt) : null);
		if (job.type === 'experiment_run' && !runId) {
			return res.status(500).json({ error: 'Missing runId for job' });
		}

		const expectedToken = getJobToken(job);
		const providedToken = typeof req.body?.token === 'string' ? String(req.body.token).trim() : '';
		if (expectedToken && providedToken !== expectedToken) {
			logger.warn('jobs.complete.denied', { traceId, jobId, reason: 'invalid token' });
			return res.status(401).json({ error: 'Invalid token' });
		}

		const exitCode = Number(req.body?.exitCode);
		const resultsText = typeof req.body?.resultsText === 'string' ? req.body.resultsText : '';
		const artifacts = Array.isArray(req.body?.artifacts) ? req.body.artifacts : [];

		logger.debug('jobs.complete.start', {
			traceId,
			jobId,
			projectId: job.projectId,
			exitCode,
			resultsLen: resultsText.length,
			artifactsCount: artifacts.length,
		});

		const status = exitCode === 0 ? 'completed' : 'failed';
		await db
			.update(jobs)
			.set({
				status: status as any,
				endedAt: new Date(),
				output: resultsText,
			})
			.where(eq(jobs.id, jobId));
		logger.info('job.complete', {
			requestId: req.requestId || null,
			traceId,
			jobId,
			projectId: job.projectId,
			status,
			artifactsCount: Array.isArray(artifacts) ? artifacts.length : 0,
		});

		// Persist results.txt into DB-visible tree
		await upsertFile({
			projectId: job.projectId,
			jobId: jobId,
			path: `Results/${runId}/results.txt`,
			type: 'txt',
			content: resultsText,
			origin: 'job',
		});

		// Persist artifact metadata into DB-visible tree (binaries already uploaded to Supabase by runner)
		for (const a of artifacts) {
			const p = typeof a?.path === 'string' ? a.path.trim() : '';
			const storageKey = typeof a?.storageKey === 'string' ? a.storageKey.trim() : '';
			const mimeType = typeof a?.mimeType === 'string' ? a.mimeType.trim() : null;
			const sizeBytes = typeof a?.sizeBytes === 'number' ? a.sizeBytes : null;
			const sha256 = typeof a?.sha256 === 'string' ? a.sha256.trim() : null;
			if (!p || !storageKey) continue;

			// Enforce job-scoped result paths
			const prefix = `Results/${runId}/`;
			if (!p.startsWith(prefix)) continue;
			const fileName = p.slice(prefix.length);
			if (!isAllowedResultExt(fileName)) continue;

			// Enforce storage key prefix
			const expectedPrefix = `projects/${job.projectId}/results/${runId}/`;
			if (!storageKey.startsWith(expectedPrefix)) continue;

			const inferredType = inferFileTypeFromName(fileName);
			if (inferredType === 'other') continue;

			await upsertFile({
				projectId: job.projectId,
				jobId: jobId,
				path: p,
				type: inferredType,
				content: null,
				storageKey,
				mimeType,
				sizeBytes,
				sha256,
				origin: 'job',
			});
		}

		logger.info('jobs.complete.done', { traceId, jobId, status });

		return res.status(200).json({ ok: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to complete job';
		return res.status(500).json({ error: message });
	}
});

// GET /jobs/:jobId -> fetch job metadata/status
jobsRouter.get('/:jobId', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const jobId = String(req.params.jobId);
		const ownedJob = await getOwnedJob(jobId, user.id);
		if (!ownedJob) {
			logAuthzDenied(req, { jobId });
			return res.status(404).json({ error: 'Job not found' });
		}
		return res.status(200).json(ownedJob);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to fetch job';
		return res.status(500).json({ error: message });
	}
});

// POST /jobs/paper/:projectId/generate -> call external create_paper and write Final_Paper/paper.tex
jobsRouter.post('/paper/:projectId/generate', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const projectId = String(req.params.projectId);
		const owned = await getOwnedProject(projectId, user.id);
		if (!owned) {
			logAuthzDenied(req, { projectId });
			return res.status(404).json({ error: 'Project not found' });
		}
		logger.debug('paper.assembling_inputs', { projectId });
		// Load required text files from DB
		const designPath = 'Design/design_plan.md';
		const expPath = 'Experimentation/experiment.py';
		const all = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
		const design = all.find((f) => f.path === designPath && f.type === 'md')?.content ?? '';
		const exp = all.find((f) => f.path === expPath && f.type === 'py')?.content ?? '';
		// Find any Results/*/results.txt
		const resultsCandidates = all.filter(
			(f) => f.type === 'txt' && f.path.startsWith('Results/') && f.path.endsWith('/results.txt'),
		);
		let results = '';
		if (resultsCandidates.length > 0) {
			const pick = resultsCandidates[Math.floor(Math.random() * resultsCandidates.length)];
			results = pick.content ?? '';
		}
		// Build payload
		const payload = {
			// NOTE: This is a legacy integration; do not use dev user emails in production defaults.
			email_address: process.env.PAPER_EMAIL || 'noreply@ignis.to',
			raw_data: JSON.stringify({
				'design_plan.md': design,
				'experiment.py': exp,
				'results.txt': results,
			}),
			first_name: process.env.PAPER_FIRST_NAME || 'Dev',
		};
		logger.debug('paper.external_service_call', {
			projectId,
			designLen: design.length,
			expLen: exp.length,
			resultsLen: results.length,
		});
		const resp = await fetch('https://scientist.up.railway.app/create_paper', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		logger.debug('paper.external_service_response', { projectId, status: resp.status });
		if (!resp.ok) {
			const txt = await resp.text();
			logger.warn('paper.external_service_failed', { status: resp.status, body: txt.slice(0, 2000) });
			return res.status(502).json({ error: 'Paper generation failed', details: `HTTP ${resp.status}` });
		}
		const paperTex = await resp.text();
		logger.debug('paper.received_response', { len: paperTex.length });
		// Upsert Final_Paper/paper.tex
		const paperPath = 'Final_Paper/paper.tex';
		const existing = all.find((f) => f.path === paperPath && f.type === 'tex');
		if (existing) {
			await db.update(filesTable).set({ content: paperTex }).where(eq(filesTable.id, existing.id));
		} else {
			await db.insert(filesTable).values({
				projectId,
				path: paperPath,
				type: 'tex',
				content: paperTex,
			});
		}
		return res.status(200).json({ ok: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to generate paper';
		logger.error('paper.error', { error: message });
		return res.status(500).json({ error: message });
	}
});


