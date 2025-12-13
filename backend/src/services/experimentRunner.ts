import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';

import { db } from '../db/client';
import { files, jobs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { putObject } from '../storage/supabaseAdapter';

function detectMime(filename: string): { type: 'img' | 'csv' | 'other'; mime: string } {
	const ext = path.extname(filename).toLowerCase();
	if (ext === '.png') return { type: 'img', mime: 'image/png' };
	if (ext === '.jpg' || ext === '.jpeg') return { type: 'img', mime: 'image/jpeg' };
	if (ext === '.csv') return { type: 'csv', mime: 'text/csv' };
	return { type: 'other', mime: 'application/octet-stream' };
}

async function sha256(buffer: Buffer): Promise<string> {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function writeTempDir(jobId: string): Promise<string> {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), `ignis-${jobId}-`));
	return base;
}

async function runPython(
	cwd: string,
	args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		// Prefer venv Python if VENV_PATH is provided; otherwise allow explicit PYTHON_BIN; fallback to system python
		const venv = process.env.VENV_PATH?.trim();
		let venvPython = venv
			? process.platform === 'win32'
				? path.join(venv, 'Scripts', 'python.exe')
				: path.join(venv, 'bin', 'python')
			: undefined;
		const override = process.env.PYTHON_BIN?.trim();
		if (process.platform === 'win32') {
			if (venvPython) venvPython = venvPython.replace(/\//g, '\\');
		}
		const fallback = process.platform === 'win32' ? 'python' : 'python3';
		const pick = (p?: string) => (p && fsSync.existsSync(p) ? p : undefined);
		const cmd = pick(venvPython) || pick(override) || fallback;
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[runner] python resolution', {
				venv,
				venvPython,
				venvPythonExists: venvPython ? fsSync.existsSync(venvPython) : null,
				override,
				overrideExists: override ? fsSync.existsSync(override) : null,
				cmd,
				cwd,
				args,
			});
		}
		let stdout = '';
		let stderr = '';
		const child = spawn(cmd, args, { cwd, env: process.env });
		child.on('error', (err) => {
			if (process.env.NODE_ENV === 'development') {
				// eslint-disable-next-line no-console
				console.log('[runner] spawn error', { err: String(err?.message || err) });
			}
		});
		// Increase timeout to 30 minutes (configurable via EXPERIMENT_TIMEOUT_MS or PYTHON_TIMEOUT_MS)
		const timeoutMs = Number(
			process.env.EXPERIMENT_TIMEOUT_MS ||
				process.env.PYTHON_TIMEOUT_MS ||
				30 * 60 * 1000,
		);
		const timeout = setTimeout(() => {
			if (process.env.NODE_ENV === 'development') {
				// eslint-disable-next-line no-console
				console.log('[runner] timeout reached, killing python', { timeoutMs });
			}
			try {
				child.kill('SIGKILL');
			} catch {}
		}, timeoutMs);
		child.stdout.on('data', (d) => (stdout += String(d)));
		child.stderr.on('data', (d) => (stderr += String(d)));
		child.on('exit', (code) => {
			clearTimeout(timeout);
			resolve({ code: code ?? -1, stdout, stderr });
		});
	});
}

export async function runExperimentJob(jobId: string): Promise<void> {
	// Load job and project
	const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
	if (!job) return;
	if (process.env.NODE_ENV === 'development') {
		// eslint-disable-next-line no-console
		console.log('[runner] job loaded', { jobId, projectId: job.projectId });
	}
	await db
		.update(jobs)
		.set({ status: 'running', startedAt: new Date() })
		.where(eq(jobs.id, jobId));

	// Find experiment.py from DB
	const [expFile] = await db
		.select()
		.from(files)
		.where(eq(files.projectId, job.projectId))
		.then((rows) => rows.filter((f) => f.path === 'Experimentation/experiment.py' && f.type === 'py'));

	if (!expFile) {
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[runner] experiment.py not found', { jobId });
		}
		await db
			.update(jobs)
			.set({ status: 'failed', output: 'Experimentation/experiment.py not found' })
			.where(eq(jobs.id, jobId));
		return;
	}

	const tempDir = await writeTempDir(jobId);
	try {
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[runner] temp dir created', { jobId, tempDir });
		}
		await fs.writeFile(path.join(tempDir, 'experiment.py'), expFile.content ?? '', 'utf8');

		// Prepare CLI args: use a fixed absolute data_dir on Windows as requested (simple MVP)
		const dataDir =
			process.platform === 'win32'
				? 'C:\\Users\\dhruv\\OneDrive\\Desktop\\startups\\Ignis\\MVP\\data\\rsna'
				: path.resolve('data/rsna');
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[runner] data_dir selected', { dataDir, exists: fsSync.existsSync(dataDir) });
		}
		const args = ['experiment.py', '--data_dir', dataDir];

		const { code, stdout, stderr } = await runPython(tempDir, args);
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[runner] python finished', { jobId, code });
		}
		const resultsText =
			`Exit code: ${code}\n\n=== STDOUT ===\n` + stdout + `\n\n=== STDERR ===\n` + stderr + '\n';

		// Write results.txt in DB under Results/{jobId}/results.txt
		await db.insert(files).values({
			projectId: job.projectId,
			path: `Results/${jobId}/results.txt`,
			type: 'txt',
			content: resultsText,
			origin: 'job',
			jobId: jobId,
		});

		// Upload artifacts from tempDir
		const entries = await fs.readdir(tempDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			if (entry.name === 'experiment.py') continue;
			if (process.env.NODE_ENV === 'development') {
				// eslint-disable-next-line no-console
				console.log('[runner] found artifact', { jobId, name: entry.name });
			}
			const full = path.join(tempDir, entry.name);
			const buf = await fs.readFile(full);
			const size = buf.byteLength;
			const hash = await sha256(buf);
			const { type, mime } = detectMime(entry.name);
			// Only persist known artifacts img/csv for MVP; others skipped
			if (type === 'other') continue;
			const storageKey = `projects/${job.projectId}/results/${jobId}/${entry.name}`;
			try {
				await putObject(storageKey, buf, mime, true);
				await db.insert(files).values({
					projectId: job.projectId,
					path: `Results/${jobId}/${entry.name}`,
					type: type === 'img' ? 'img' : 'csv',
					origin: 'job',
					jobId: jobId,
					storageKey,
					mimeType: mime,
					sizeBytes: size,
					sha256: hash,
				});
			} catch (e: any) {
				if (process.env.NODE_ENV === 'development') {
					// eslint-disable-next-line no-console
					console.log('[runner] artifact upload failed (continuing)', {
						jobId,
						name: entry.name,
						error: String(e?.message || e),
					});
				}
				// continue with next artifact
			}
		}

		await db
			.update(jobs)
			.set({ status: code === 0 ? 'completed' : 'failed', endedAt: new Date(), output: stdout + '\n' + stderr })
			.where(eq(jobs.id, jobId));
	} catch (err: any) {
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[runner] error', { jobId, error: String(err?.message || err) });
		}
		await db
			.update(jobs)
			.set({ status: 'failed', endedAt: new Date(), output: String(err?.message || err) })
			.where(eq(jobs.id, jobId));
	} finally {
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {}
	}
}


