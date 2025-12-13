import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { jobs } from '../db/schema';
import { buildPaperKey, buildResultKey, sanitizeFileName } from '../storage/paths';
import { getSignedUploadUrl } from '../storage/supabaseAdapter';
import { runExperimentJob } from '../services/experimentRunner';
import { files as filesTable } from '../db/schema';
import { and } from 'drizzle-orm';
import { fetch } from 'undici';

export const jobsRouter = Router();

// POST /experiment/:projectId/run (stub)
jobsRouter.post('/experiment/:projectId/run', async (req, res) => {
	try {
		const projectId = String(req.params.projectId);
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[jobs] enqueue experiment', { projectId });
		}
		const id = crypto.randomUUID();
		await db.insert(jobs).values({ id, projectId, type: 'experiment_run', status: 'queued' });
		// schedule async execution
		setImmediate(() => {
			if (process.env.NODE_ENV === 'development') {
				// eslint-disable-next-line no-console
				console.log('[jobs] starting experiment job', { jobId: id });
			}
			runExperimentJob(id).catch(() => {});
		});
		return res.status(200).json({ jobId: id });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to enqueue experiment';
		return res.status(500).json({ error: message });
	}
});

// POST /paper/:projectId/compile (stub)
jobsRouter.post('/paper/:projectId/compile', async (req, res) => {
	try {
		const projectId = String(req.params.projectId);
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[jobs] enqueue compile', { projectId });
		}
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

		// TODO: AuthZ: ensure requester is project owner

		const items: Array<{ fileName: string; mimeType?: string; sizeBytes?: number }> =
			Array.isArray(req.body?.items) ? req.body.items : [];
		if (!items.length) {
			return res.status(400).json({ error: 'No items provided' });
		}

		const uploads = await Promise.all(
			items.map(async (item) => {
				const safeName = sanitizeFileName(item.fileName);
				const key =
					job.type === 'paper_compile'
						? buildPaperKey(job.projectId, job.id) // enforce 'paper.pdf' by convention
						: buildResultKey(job.projectId, job.id, safeName);

				const signed = await getSignedUploadUrl(key);
				return { ...signed, fileName: safeName, mimeType: item.mimeType };
			}),
		);

		return res.status(200).json({ uploads });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to presign uploads';
		return res.status(500).json({ error: message });
	}
});

// GET /jobs/:jobId -> fetch job metadata/status
jobsRouter.get('/:jobId', async (req, res) => {
	try {
		const jobId = String(req.params.jobId);
		const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
		if (!job) return res.status(404).json({ error: 'Job not found' });
		return res.status(200).json(job);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to fetch job';
		return res.status(500).json({ error: message });
	}
});

// POST /jobs/paper/:projectId/generate -> call external create_paper and write Final Paper/paper.tex
jobsRouter.post('/paper/:projectId/generate', async (req, res) => {
	try {
		const projectId = String(req.params.projectId);
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper] assembling inputs', { projectId });
		}
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
			email_address: process.env.PAPER_EMAIL || 'dev@ignis.local',
			raw_data: JSON.stringify({
				'design_plan.md': design,
				'experiment.py': exp,
				'results.txt': results,
			}),
			first_name: process.env.PAPER_FIRST_NAME || 'Dev',
		};
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper] calling external service', {
				projectId,
				designLen: design.length,
				expLen: exp.length,
				resultsLen: results.length,
			});
		}
		const resp = await fetch('https://scientist.up.railway.app/create_paper', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper] external service response', resp);
		}
		if (!resp.ok) {
			const txt = await resp.text();
			if (process.env.NODE_ENV === 'development') {
				// eslint-disable-next-line no-console
				console.log('[paper] external service failed', { status: resp.status, body: txt.slice(0, 2000) });
			}
			return res.status(502).json({ error: 'Paper generation failed', details: `HTTP ${resp.status}` });
		}
		const paperTex = await resp.text();
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper] received response', { len: paperTex.length });
		}
		// Upsert Final Paper/paper.tex
		const paperPath = 'Final Paper/paper.tex';
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
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper] error', { error: message });
		}
		return res.status(500).json({ error: message });
	}
});


