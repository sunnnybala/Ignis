import { Router } from 'express';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/client';
import { files as filesTable } from '../db/schema';
import { getOpenAI } from '../llm/openai';
import { initSse } from '../utils/sse';
import { compileLatexToPdf, LatexCompileError } from '../services/latexCompiler';

export const paperRouter = Router();

const DESIGN_PATH = 'Design/design_plan.md';
const EXP_PATH = 'Experimentation/experiment.py';
const PAPER_PATH = 'Final Paper/paper.tex';
const META_PATH = 'Final Paper/athena_meta.txt';

type AthenaMeta = {
	publicationProbability: number; // 0..1
	suggestedJournals: string[]; // limit 3
	selectedJournal: string; // e.g. "General"
	hasResults?: boolean;
	notes?: string;
};

type PaperChatWriteToolArgs = {
	latex: string;
	publicationProbability: number;
	// journal may be omitted; if provided, we keep it, else preserve existing
	selectedJournal?: string;
};

async function upsertTextFile(
	projectId: string,
	path: string,
	type: 'txt' | 'md' | 'py' | 'tex',
	content: string,
): Promise<string> {
	const existing = await db
		.select()
		.from(filesTable)
		.where(and(eq(filesTable.projectId, projectId), eq(filesTable.path, path)));
	if (existing[0]) {
		await db.update(filesTable).set({ content, type }).where(eq(filesTable.id, existing[0].id));
		return existing[0].id;
	}
	const id = crypto.randomUUID();
	await db.insert(filesTable).values({ id, projectId, path, type, content });
	return id;
}

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

function normalizeMeta(maybe: any, selectedJournalFallback: string): AthenaMeta {
	const prob = clamp01(Number(maybe?.publicationProbability));
	const sj = Array.isArray(maybe?.suggestedJournals)
		? maybe.suggestedJournals.filter((x: any) => typeof x === 'string' && x.trim().length > 0).map((s: string) => s.trim())
		: [];
	const suggestedJournals = sj.slice(0, 3);
	const selectedJournal =
		typeof maybe?.selectedJournal === 'string' && maybe.selectedJournal.trim().length > 0
			? maybe.selectedJournal.trim()
			: selectedJournalFallback;
	const hasResults = typeof maybe?.hasResults === 'boolean' ? maybe.hasResults : undefined;
	const notes = typeof maybe?.notes === 'string' ? maybe.notes : undefined;
	return { publicationProbability: prob, suggestedJournals, selectedJournal, hasResults, notes };
}

function parseDelimitedResponse(text: string): { meta: AthenaMeta; latex: string } {
	const META_MARK = '===META_JSON===';
	const LATEX_MARK = '===LATEX===';
	const metaIdx = text.indexOf(META_MARK);
	const latexIdx = text.indexOf(LATEX_MARK);

	if (metaIdx === -1 || latexIdx === -1 || latexIdx < metaIdx) {
		// Fallback: treat everything as latex
		return {
			meta: { publicationProbability: 0, suggestedJournals: [], selectedJournal: 'General', notes: 'Unparseable model output' },
			latex: text,
		};
	}

	const metaRaw = text.slice(metaIdx + META_MARK.length, latexIdx).trim();
	const latex = text.slice(latexIdx + LATEX_MARK.length).trim();

	let metaObj: any = {};
	try {
		metaObj = JSON.parse(metaRaw);
	} catch {
		metaObj = { publicationProbability: 0, suggestedJournals: [], selectedJournal: 'General', notes: 'Failed to parse META_JSON' };
	}

	return { meta: normalizeMeta(metaObj, 'General'), latex };
}

async function readMeta(projectId: string): Promise<AthenaMeta | null> {
	const rows = await db
		.select()
		.from(filesTable)
		.where(and(eq(filesTable.projectId, projectId), eq(filesTable.path, META_PATH)));
	const raw = rows[0]?.content ?? '';
	if (!raw || typeof raw !== 'string') return null;
	try {
		const parsed = JSON.parse(raw);
		return normalizeMeta(parsed, 'General');
	} catch {
		return null;
	}
}

async function loadProjectInputs(projectId: string): Promise<{
	design: string;
	experiment: string;
	results: string;
	hasResults: boolean;
	paperTex: string;
}> {
	const all = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
	const design = all.find((f) => f.path === DESIGN_PATH && f.type === 'md')?.content ?? '';
	const experiment = all.find((f) => f.path === EXP_PATH && f.type === 'py')?.content ?? '';
	const paperTex = all.find((f) => f.path === PAPER_PATH && f.type === 'tex')?.content ?? '';

	const resultsCandidates = all
		.filter((f) => f.type === 'txt' && f.path.startsWith('Results/') && f.path.endsWith('/results.txt'))
		.sort((a, b) => {
			const at = (a.createdAt instanceof Date ? a.createdAt.getTime() : 0) || 0;
			const bt = (b.createdAt instanceof Date ? b.createdAt.getTime() : 0) || 0;
			return bt - at;
		});
	const results = resultsCandidates[0]?.content ?? '';
	const hasResults = resultsCandidates.length > 0 && (results ?? '').trim().length > 0;
	return { design, experiment, results, hasResults, paperTex };
}

function excerpt(s: string, max = 8000): string {
	if (!s) return '';
	if (s.length <= max) return s;
	const half = Math.floor(max / 2);
	return s.slice(0, half) + '\n...\n' + s.slice(-half);
}

function buildGeneratePrompt(input: {
	design: string;
	experiment: string;
	results: string;
	hasResults: boolean;
	selectedJournal: string;
}): string {
	return `You are Athena, a research-paper writer.\n\nTASK\n- Create a complete LaTeX paper (article class) from the provided inputs.\n- Provide a publishability probability and exactly 3 suggested journals.\n\nOUTPUT FORMAT (MUST FOLLOW EXACTLY)\n===META_JSON===\n{ \"publicationProbability\": 0.0, \"suggestedJournals\": [\"J1\",\"J2\",\"J3\"], \"selectedJournal\": \"${input.selectedJournal}\", \"hasResults\": ${input.hasResults} }\n===LATEX===\n<full LaTeX document>\n\nCONSTRAINTS\n- suggestedJournals must be an array of exactly 3 strings.\n- publicationProbability must be a number in [0,1].\n- Use only LaTeX; do not include markdown.\n\nINPUTS\n[Design Plan]\n${input.design}\n\n[Experiment Code]\n${input.experiment}\n\n[Results]\n${input.results}\n`;
}

function buildRegeneratePrompt(input: {
	currentLatex: string;
	design: string;
	experiment: string;
	results: string;
	hasResults: boolean;
	journal: string;
}): string {
	return `You are Athena, a research-paper writer.\n\nTASK\n- Rewrite/format the provided LaTeX paper to match the style expectations for the selected journal.\n- Keep the scientific content consistent with the provided inputs.\n- Provide a publishability probability and exactly 3 suggested journals (they can change).\n\nOUTPUT FORMAT (MUST FOLLOW EXACTLY)\n===META_JSON===\n{ \"publicationProbability\": 0.0, \"suggestedJournals\": [\"J1\",\"J2\",\"J3\"], \"selectedJournal\": \"${input.journal}\", \"hasResults\": ${input.hasResults} }\n===LATEX===\n<full LaTeX document>\n\nCONSTRAINTS\n- suggestedJournals must be an array of exactly 3 strings.\n- publicationProbability must be a number in [0,1].\n- Use only LaTeX; do not include markdown.\n\nSELECTED JOURNAL\n${input.journal}\n\nCURRENT LATEX\n${input.currentLatex}\n\nINPUTS (ground truth)\n[Design Plan]\n${input.design}\n\n[Experiment Code]\n${input.experiment}\n\n[Results]\n${input.results}\n`;
}

paperRouter.post('/:projectId/generate', async (req, res) => {
	try {
		const projectId = String(req.params.projectId);
		const selectedJournal = 'General';
		const traceId = crypto.randomUUID();
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.generate] start', { traceId, projectId });
		}
		const { design, experiment, results, hasResults } = await loadProjectInputs(projectId);
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.generate] inputs', {
				traceId,
				projectId,
				designLen: design.length,
				experimentLen: experiment.length,
				resultsLen: results.length,
				hasResults,
			});
		}

		const client = getOpenAI();
		const prompt = buildGeneratePrompt({ design, experiment, results, hasResults, selectedJournal });
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.generate] calling openai', { traceId, projectId, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' });
		}
		const completion = await client.chat.completions.create({
			model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: 'You produce strictly formatted outputs.' },
				{ role: 'user', content: prompt },
			],
		});
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.generate] openai done', { traceId, projectId });
		}

		const text = completion.choices?.[0]?.message?.content ?? '';
		const parsed = parseDelimitedResponse(text);
		const meta: AthenaMeta = normalizeMeta(
			{ ...parsed.meta, hasResults },
			selectedJournal,
		);

		const latex =
			parsed.latex && parsed.latex.trim().length > 0
				? parsed.latex
				: '\\\\documentclass{article}\\n\\\\begin{document}\\nPaper generation failed.\\n\\\\end{document}\\n';

		await upsertTextFile(projectId, PAPER_PATH, 'tex', latex);
		await upsertTextFile(projectId, META_PATH, 'txt', JSON.stringify(meta, null, 2));

		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.generate] complete', { traceId, projectId, latexLen: latex.length, meta });
		}
		return res.status(200).json({ ok: true, meta });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to generate paper';
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.generate] error', { error: message });
		}
		return res.status(500).json({ error: message });
	}
});

paperRouter.post('/:projectId/regenerate', async (req, res) => {
	try {
		const projectId = String(req.params.projectId);
		const journal = typeof req.body?.journal === 'string' && req.body.journal.trim().length > 0 ? req.body.journal.trim() : 'General';
		const traceId = crypto.randomUUID();
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.regenerate] start', { traceId, projectId, journal });
		}

		const { design, experiment, results, hasResults, paperTex } = await loadProjectInputs(projectId);
		const currentLatex = paperTex || '\\\\documentclass{article}\\n\\\\begin{document}\\n\\\\end{document}\\n';
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.regenerate] inputs', {
				traceId,
				projectId,
				journal,
				currentLatexLen: currentLatex.length,
				designLen: design.length,
				experimentLen: experiment.length,
				resultsLen: results.length,
				hasResults,
			});
		}

		const client = getOpenAI();
		const prompt = buildRegeneratePrompt({ currentLatex, design, experiment, results, hasResults, journal });
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.regenerate] calling openai', { traceId, projectId, journal, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' });
		}
		const completion = await client.chat.completions.create({
			model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
			messages: [
				{ role: 'system', content: 'You produce strictly formatted outputs.' },
				{ role: 'user', content: prompt },
			],
		});
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.regenerate] openai done', { traceId, projectId, journal });
		}

		const text = completion.choices?.[0]?.message?.content ?? '';
		const parsed = parseDelimitedResponse(text);
		const meta: AthenaMeta = normalizeMeta(
			{ ...parsed.meta, selectedJournal: journal, hasResults },
			journal,
		);
		const latex =
			parsed.latex && parsed.latex.trim().length > 0
				? parsed.latex
				: currentLatex;

		await upsertTextFile(projectId, PAPER_PATH, 'tex', latex);
		await upsertTextFile(projectId, META_PATH, 'txt', JSON.stringify(meta, null, 2));

		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.regenerate] complete', { traceId, projectId, journal, latexLen: latex.length, meta });
		}
		return res.status(200).json({ ok: true, meta });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to regenerate paper';
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.regenerate] error', { error: message });
		}
		return res.status(500).json({ error: message });
	}
});

// POST /paper/:projectId/compile -> compile current paper.tex and return a PDF (no uploads yet)
paperRouter.post('/:projectId/compile', async (req, res) => {
	try {
		const projectId = String(req.params.projectId);
		const traceId = crypto.randomUUID();
		const t0 = Date.now();
		const all = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
		const paperTex = all.find((f) => f.path === PAPER_PATH && f.type === 'tex')?.content ?? '';
		if (!paperTex || paperTex.trim().length === 0) {
			if (process.env.NODE_ENV === 'development') {
				// eslint-disable-next-line no-console
				console.log('[paper.compile] empty', { traceId, projectId });
			}
			return res.status(400).json({ error: 'paper.tex is empty' });
		}

		const { pdf, log } = await compileLatexToPdf(paperTex);

		// Stub for later: upload to Supabase (no-op for now)
		void log; // keep for debugging later; not returned on success
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.compile] success', {
				traceId,
				projectId,
				latexLen: paperTex.length,
				pdfBytes: pdf.byteLength,
				ms: Date.now() - t0,
			});
		}

		res.status(200);
		res.setHeader('Content-Type', 'application/pdf');
		res.setHeader('Content-Disposition', 'inline; filename="paper.pdf"');
		return res.send(pdf);
	} catch (err: unknown) {
		if (err instanceof LatexCompileError) {
			if (process.env.NODE_ENV === 'development') {
				// eslint-disable-next-line no-console
				console.log('[paper.compile] failed', { error: err.message });
			}
			return res.status(400).json({ error: err.message, log: err.log.slice(0, 20000) });
		}
		const message = err instanceof Error ? err.message : 'Failed to compile LaTeX';
		if (process.env.NODE_ENV === 'development') {
			// eslint-disable-next-line no-console
			console.log('[paper.compile] error', { error: message });
		}
		return res.status(500).json({ error: message });
	}
});

// POST /paper/:projectId/chat -> paper-focused streaming chat (no phase, no ask_user)
paperRouter.post('/:projectId/chat', async (req, res) => {
	const sse = initSse(res);
	try {
		const projectId = String(req.params.projectId);
		const inputMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
		const history = Array.isArray(req.body?.history)
			? (req.body.history as Array<{ role?: unknown; text?: unknown }>)
			: [];

		// Load current paper + meta so the model edits the latest version
		const all = await db.select().from(filesTable).where(eq(filesTable.projectId, projectId));
		const paperTex = all.find((f) => f.path === PAPER_PATH && f.type === 'tex')?.content ?? '';
		const meta = await readMeta(projectId);
		const selectedJournal = meta?.selectedJournal || 'General';
		const suggestedJournals = meta?.suggestedJournals || [];

		const systemPrompt = `You are Athena, a paper editing assistant.\n\nRULES\n- Stream concise edits/suggestions as normal text.\n- If you decide to change the paper, you MUST call the tool write_paper.\n- Do NOT change the suggested journals list. Keep it exactly as-is.\n- You MUST provide a new publicationProbability when writing.\n- Do NOT ask the user questions; do not request clarification tools. tell the user what you are doing and how. \n\nCONTEXT\nSelected journal: ${selectedJournal}\nSuggested journals (immutable): ${JSON.stringify(suggestedJournals)}\n\nCurrent paper.tex :\n${paperTex}\n`;

		const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
			{ role: 'system', content: systemPrompt },
		];

		for (const h of history) {
			const role = h?.role === 'assistant' ? 'assistant' : h?.role === 'user' ? 'user' : null;
			const text = typeof h?.text === 'string' ? h.text : '';
			if (!role || !text) continue;
			messages.push({ role, content: text });
		}
		if (inputMessage) messages.push({ role: 'user', content: inputMessage });

		const tools = [
			{
				type: 'function',
				function: {
					name: 'write_paper',
					description:
						'Atomically update Final Paper/paper.tex and Final Paper/athena_meta.txt. suggestedJournals MUST remain unchanged; only update publicationProbability (and latex).',
					parameters: {
						type: 'object',
						properties: {
							latex: { type: 'string' },
							publicationProbability: { type: 'number' },
							selectedJournal: { type: 'string' },
						},
						required: ['latex', 'publicationProbability'],
					},
				},
			},
		] as const;

		const client = getOpenAI();

		type ToolCallAccum = { name?: string; args: string };
		const toolCalls: Record<number, ToolCallAccum> = {};

		const stream = await client.chat.completions.create({
			model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
			messages,
			tools: tools as any,
			tool_choice: 'auto',
			stream: true,
		});

		let finishedWithToolCalls = false;

		for await (const chunk of stream) {
			const choice = chunk.choices?.[0];
			if (!choice) continue;

			const deltaText = choice.delta?.content;
			if (typeof deltaText === 'string' && deltaText.length > 0) {
				sse.write({ type: 'delta', text: deltaText });
			}

			const tc = choice.delta?.tool_calls;
			if (tc && Array.isArray(tc)) {
				for (const t of tc) {
					const idx = t.index ?? 0;
					if (!toolCalls[idx]) toolCalls[idx] = { args: '' };
					if (t.function?.name) toolCalls[idx].name = t.function.name;
					if (t.function?.arguments) toolCalls[idx].args += t.function.arguments;
				}
			}

			if (choice.finish_reason === 'tool_calls') {
				finishedWithToolCalls = true;
			}
		}

		if (finishedWithToolCalls) {
			const firstIdx = Object.keys(toolCalls)
				.map((k) => parseInt(k, 10))
				.sort((a, b) => a - b)[0];
			const call = typeof firstIdx === 'number' ? toolCalls[firstIdx] : undefined;
			if (call?.name === 'write_paper') {
				let args: PaperChatWriteToolArgs;
				try {
					args = JSON.parse(call.args || '{}') as PaperChatWriteToolArgs;
				} catch {
					sse.write({ type: 'delta', text: 'Error: Failed to parse tool arguments\n' });
					return sse.close();
				}

				const latex = typeof args?.latex === 'string' ? args.latex : '';
				const prob = clamp01(Number(args?.publicationProbability));
				const nextJournal =
					typeof args?.selectedJournal === 'string' && args.selectedJournal.trim().length > 0
						? args.selectedJournal.trim()
						: selectedJournal;

				// Preserve suggested journals; do NOT change after chat edits
				const nextMeta: AthenaMeta = {
					publicationProbability: prob,
					suggestedJournals: suggestedJournals.slice(0, 3),
					selectedJournal: nextJournal,
					hasResults: meta?.hasResults,
				};

				// Persist both files atomically-ish (sequential but always both)
				await upsertTextFile(projectId, PAPER_PATH, 'tex', latex);
				const metaJson = JSON.stringify(nextMeta, null, 2);
				await upsertTextFile(projectId, META_PATH, 'txt', metaJson);

				sse.write({ type: 'file_update', path: PAPER_PATH, op: 'replace', content: latex });
				sse.write({ type: 'file_update', path: META_PATH, op: 'replace', content: metaJson });
				return sse.close();
			}

			// Unknown tool call: ignore but close
			sse.write({ type: 'delta', text: 'Error: Unknown tool call\n' });
			return sse.close();
		}

		// No tool calls; finish normally
	} catch (err: unknown) {
		sse.write({ type: 'delta', text: `Error: ${err instanceof Error ? err.message : 'Failed'}\n` });
	} finally {
		sse.close();
	}
});


