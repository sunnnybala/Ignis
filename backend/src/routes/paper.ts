import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { files as filesTable } from '../db/schema';
import { compileLatexToPdf, LatexCompileError } from '../services/latexCompiler';
import { getAuthedUser, getOwnedProject, logAuthzDenied } from '../authz/ownership';
import { logger } from '../utils/logger';

export const paperRouter = Router();

const PAPER_PATH = 'Final_Paper/paper.tex';

// POST /paper/:projectId/compile -> compile current paper.tex and return a PDF
paperRouter.post('/:projectId/compile', async (req, res) => {
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
		const t0 = Date.now();
		const all = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
		const paperTex = all.find((f) => f.path === PAPER_PATH && f.type === 'tex')?.content ?? '';
		if (!paperTex || paperTex.trim().length === 0) {
			logger.debug('paper.compile.empty', { traceId, projectId });
			return res.status(400).json({ error: 'paper.tex is empty' });
		}

		const { pdf, log } = await compileLatexToPdf(paperTex);

		// Stub for later: upload to Supabase (no-op for now)
		void log; // keep for debugging later; not returned on success
		logger.info('paper.compile.success', {
			traceId,
			projectId,
			latexLen: paperTex.length,
			pdfBytes: pdf.byteLength,
			ms: Date.now() - t0,
		});

		res.status(200);
		res.setHeader('Content-Type', 'application/pdf');
		res.setHeader('Content-Disposition', 'inline; filename="paper.pdf"');
		return res.send(pdf);
	} catch (err: unknown) {
		if (err instanceof LatexCompileError) {
			logger.warn('paper.compile.failed', { error: err.message });
			return res.status(400).json({ error: err.message, log: err.log.slice(0, 20000) });
		}
		const message = err instanceof Error ? err.message : 'Failed to compile LaTeX';
		logger.error('paper.compile.error', { error: message });
		return res.status(500).json({ error: message });
	}
});
