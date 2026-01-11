import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

import { logger } from '../utils/logger';

export class LatexCompileError extends Error {
	public readonly log: string;
	constructor(message: string, log: string) {
		super(message);
		this.name = 'LatexCompileError';
		this.log = log;
	}
}

async function writeTempDir(prefix: string): Promise<string> {
	return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

function pickTectonicBin(): string {
	const override = process.env.TECTONIC_BIN?.trim();
	if (override) return override;
	return 'tectonic';
}

function timeoutMs(): number {
	const v = Number(process.env.LATEX_TIMEOUT_MS || 2 * 60 * 1000);
	return Number.isFinite(v) && v > 0 ? v : 2 * 60 * 1000;
}

async function runTectonic(
	cwd: string,
	texFileName: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
	return await new Promise((resolve) => {
		const cmd = pickTectonicBin();
		const args = ['-X', 'compile', texFileName, '--outdir', cwd];
		logger.debug('latex.spawn', { cmd, args, cwd, timeoutMs: timeoutMs() });

		let stdout = '';
		let stderr = '';
		const child = spawn(cmd, args, { cwd, env: process.env });

		child.stdout.on('data', (d) => (stdout += String(d)));
		child.stderr.on('data', (d) => (stderr += String(d)));

		const t = setTimeout(() => {
			logger.warn('latex.timeout', { timeoutMs: timeoutMs() });
			try {
				child.kill('SIGKILL');
			} catch {}
		}, timeoutMs());

		child.on('error', (err) => {
			clearTimeout(t);
			stderr += `\n[spawn error] ${String((err as any)?.message || err)}\n`;
			logger.error('latex.spawn_error', { err: String((err as any)?.message || err) });
			resolve({ code: -1, stdout, stderr });
		});

		child.on('exit', (code) => {
			clearTimeout(t);
			logger.debug('latex.exit', { code: code ?? -1 });
			resolve({ code: code ?? -1, stdout, stderr });
		});
	});
}

/**
 * Compile a LaTeX document to PDF using Tectonic.
 * - Requires `tectonic` to be installed and available on PATH (or set TECTONIC_BIN).
 */
export async function compileLatexToPdf(latex: string): Promise<{ pdf: Buffer; log: string }> {
	const dir = await writeTempDir('ignis-tectonic');
	try {
		const texName = 'paper.tex';
		logger.info('latex.start', { dir, latexLen: (latex ?? '').length });
		await fs.writeFile(path.join(dir, texName), latex ?? '', 'utf8');

		const { code, stdout, stderr } = await runTectonic(dir, texName);
		const log = `Exit code: ${code}\n\n=== STDOUT ===\n${stdout}\n\n=== STDERR ===\n${stderr}\n`;

		const pdfPath = path.join(dir, 'paper.pdf');
		if (code !== 0 || !fsSync.existsSync(pdfPath)) {
			logger.error('latex.failed', { code, hasPdf: fsSync.existsSync(pdfPath) });
			throw new LatexCompileError('LaTeX compilation failed', log);
		}
		const pdf = await fs.readFile(pdfPath);
		logger.info('latex.success', { pdfBytes: pdf.byteLength });
		return { pdf, log };
	} finally {
		try {
			await fs.rm(dir, { recursive: true, force: true });
		} catch {}
	}
}

/**
 * Stub for later: upload compiled PDF to Supabase.
 * Intentionally a no-op for now.
 */
export async function uploadPdfToSupabaseStub(_opts: {
	projectId: string;
	jobId?: string;
	pdf: Buffer;
}): Promise<void> {
	// no-op
}


