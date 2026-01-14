import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { searchPapersTool } from '../tools/search-papers';
import { writeFileTool } from '../tools/write-file';
import { logger } from '../../utils/logger';

// NOTE: We intentionally do NOT import agents directly here.
// We use `mastra.getAgent(...)` inside steps so the workflow runs with the Mastra runtime instance.

function intFromEnv(name: string, fallback: number, opts?: { min?: number; max?: number }): number {
  const raw = String(process.env[name] ?? '').trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const v = Number.isFinite(parsed) ? parsed : fallback;
  const min = opts?.min ?? Number.NEGATIVE_INFINITY;
  const max = opts?.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, v));
}

function getConfigFromEnv() {
  // Defaults requested by you:
  const nPapers = intFromEnv('NOVELTY_REFINE_N_PAPERS', 10, { min: 1, max: 50 });
  const concurrency = intFromEnv('NOVELTY_REFINE_CONCURRENCY', 5, { min: 1, max: 20 });
  return { nPapers, concurrency };
}

function traceMeta(requestContext: any): { traceId: string | null; userId?: string; projectId?: string } {
  const traceId = requestContext?.get?.('traceId') ? String(requestContext.get('traceId')) : null;
  const userId = requestContext?.get?.('userId') ? String(requestContext.get('userId')) : undefined;
  const projectId = requestContext?.get?.('projectId') ? String(requestContext.get('projectId')) : undefined;
  return { traceId, userId, projectId };
}

const paperSchema = z.object({
  title: z.string(),
  authors: z.array(z.string()).default([]),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  abstract: z.string().optional(),
  url: z.string().url().optional(),
  doi: z.string().optional(),
  source: z.enum(['semantic_scholar', 'exa']),
});

const pairSchema = z.object({
  pairId: z.string(),
  paperA: paperSchema,
  paperB: paperSchema,
});

// Keep worker outputs small + consistent. The worker can still express nuance inside the text fields,
// but the structured arrays are intentionally shallow so the model can fill them reliably.
const miniReportSchema = z.object({
  pairId: z.string(),
  miniLitReviewText: z.string(),
  miniNoveltyAssessmentText: z.string(),
  keyTakeaways: z.array(z.string()).default([]),
  overlapSignals: z.array(z.string()).default([]),
  noveltySignals: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  citations: z.array(z.object({ title: z.string(), doi: z.string().nullable(), url: z.string().nullable() })).default([]),
});

const workerInputSchema = z.object({
  idea: z.string(),
  pairId: z.string(),
  paperA: paperSchema,
  paperB: paperSchema,
});

const textOutSchema = z.object({ text: z.string().min(1) });

const OUTPUT_PATHS = {
  litReview: 'Research/lit_review.md',
  novelty: 'Research/novelty_assessment.md',
  refinedIdea: 'Research/refined_idea.md',
} as const;

/**
 * Step 1: build a paper-search query from the user's idea + conversation memory.
 * - Uses queryBuilderAgent
 * - Uses structuredOutput so we reliably get { query: string }
 * - Uses Mastra Memory scoping: resource=userId, thread=projectId
 */
const buildQueryStep = createStep({
  id: 'build_query',
  description: "Builds an academic search query from the user's idea + conversation context",
  inputSchema: z.object({
    idea: z.string().min(1).max(10_000),
  }),
  outputSchema: z.object({
    idea: z.string(),
    query: z.string().min(1),
  }),
  execute: async ({ inputData, mastra, requestContext }: any) => {
    if (!inputData?.idea) throw new Error('Missing idea');
    if (!mastra) throw new Error('Mastra instance not available in workflow step');

    logger.info('workflow.novelty_refine.build_query.start', {
      ...traceMeta(requestContext),
      ideaChars: String(inputData.idea || '').length,
    });

    const querySchema = z.object({ query: z.string().min(1).max(500) });
    const agent = mastra.getAgent('queryBuilderAgent');
    if (!agent) throw new Error('queryBuilderAgent not found (is it registered in mastra/index.ts?)');

    const prompt = `${inputData.idea}\n\nReturn a single best search query to search for scholarly papers related to user's idea.`;

    const res = await agent.generate(prompt, {
      structuredOutput: { schema: querySchema, errorStrategy: 'strict' },
    } as any);

    const obj = (res as any)?.object as z.infer<typeof querySchema> | undefined;
    const query = String(obj?.query ?? '').trim();
    if (!query) throw new Error('Query builder agent did not return a valid query');

    logger.info('workflow.novelty_refine.build_query.finish', { ...traceMeta(requestContext), queryChars: query.length });
    return { idea: inputData.idea, query };
  },
});

/**
 * Step 2: fetch N papers using the search_papers tool (pagination supported).
 * - N is read from env (NOVELTY_REFINE_N_PAPERS), default 10
 * - We keep concurrency in output for later steps, but we don't use it yet.
 */
const fetchPapersStep = createStep({
  id: 'fetch_papers',
  description: 'Fetches N papers for the generated query',
  inputSchema: z.object({
    idea: z.string(),
    query: z.string().min(1),
  }),
  outputSchema: z.object({
    idea: z.string(),
    query: z.string(),
    nPapers: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    papers: z.array(paperSchema),
  }),
  execute: async ({ inputData, requestContext }: any) => {
    const { nPapers, concurrency } = getConfigFromEnv();

    logger.info('workflow.novelty_refine.fetch_papers.start', {
      ...traceMeta(requestContext),
      queryChars: String(inputData.query || '').length,
      nPapers,
      concurrency,
    });

    const collected: Array<z.infer<typeof paperSchema>> = [];
    let cursor: string | undefined = undefined;
    let pages = 0;

    while (collected.length < nPapers) {
      const remaining = nPapers - collected.length;
      const limit = Math.min(10, remaining);

      const page: any = await (searchPapersTool as any).execute(
        { query: inputData.query, limit, cursor },
        { requestContext },
      );
      pages += 1;

      const results = Array.isArray(page?.results) ? page.results : [];
      for (const r of results) {
        // Tool already normalizes, but we validate/normalize again at the boundary.
        const parsed = paperSchema.safeParse(r);
        if (parsed.success) collected.push(parsed.data);
      }

      const next: string | null = typeof page?.nextCursor === 'string' ? page.nextCursor : null;
      if (!next) break;
      cursor = next;
    }

    logger.info('workflow.novelty_refine.fetch_papers.finish', {
      ...traceMeta(requestContext),
      pages,
      papersCollected: collected.length,
    });
    return {
      idea: inputData.idea,
      query: inputData.query,
      nPapers,
      concurrency,
      papers: collected.slice(0, nPapers),
    };
  },
});

/**
 * Step 3: convert the papers list into 2-paper work items (pairs).
 * We intentionally drop the last paper if the count is odd to keep schemas simple.
 */
const pairPapersStep = createStep({
  id: 'pair_papers',
  description: 'Batches papers into pairs (2 papers per worker) for downstream parallel processing',
  inputSchema: z.object({
    idea: z.string(),
    query: z.string(),
    nPapers: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    papers: z.array(paperSchema),
  }),
  outputSchema: z.object({
    idea: z.string(),
    query: z.string(),
    nPapers: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    papers: z.array(paperSchema),
    pairs: z.array(pairSchema),
  }),
  execute: async ({ inputData }) => {
    // No requestContext here (pure step). Keep logs lightweight.
    logger.info('workflow.novelty_refine.pair_papers.start', {
      papersCount: inputData?.papers?.length,
    });
    const papers = Array.isArray(inputData?.papers) ? inputData.papers : [];
    const evenCount = Math.floor(papers.length / 2) * 2;
    const usable = papers.slice(0, evenCount);

    const pairs: Array<z.infer<typeof pairSchema>> = [];
    for (let i = 0; i < usable.length; i += 2) {
      pairs.push({
        pairId: `pair-${Math.floor(i / 2) + 1}`,
        paperA: usable[i],
        paperB: usable[i + 1],
      });
    }

    logger.info('workflow.novelty_refine.pair_papers.finish', {
      papersCount: inputData?.papers?.length,
      pairsCount: pairs.length,
    });

    return { ...inputData, pairs };
  },
});

/**
 * Step 4: per-pair worker. This step is executed via `.foreach()` (fan-out).
 * - Calls miniReviewWorkerAgent
 * - Uses structuredOutput to enforce miniReportSchema
 * - Does NOT use memory (we don't want to pollute conversation history with internal worker chatter)
 */
const miniReviewWorkerStep = createStep({
  id: 'mini_review_worker',
  description: 'Produces a mini literature review + novelty assessment for one 2-paper pair',
  inputSchema: workerInputSchema,
  outputSchema: miniReportSchema,
  execute: async ({ inputData, mastra }: any) => {
    logger.info('workflow.novelty_refine.mini_review_worker.start', {
      pairId: inputData.pairId,
      ideaChars: String(inputData.idea || '').length,
      paperAChars: String(inputData.paperA.title || '').length,
      paperBChars: String(inputData.paperB.title || '').length,
    });
    if (!mastra) throw new Error('Mastra instance not available in workflow step');
    const agent = mastra.getAgent('miniReviewWorkerAgent');
    if (!agent) throw new Error('miniReviewWorkerAgent not found (is it registered in mastra/index.ts?)');

    const paperBlock = (label: 'A' | 'B', p: z.infer<typeof paperSchema>) => {
      const authors = Array.isArray(p.authors) ? p.authors.join(', ') : '';
      return [
        `PAPER ${label}`,
        `Title: ${p.title}`,
        `Authors: ${authors || 'Unknown based on provided data'}`,
        `Year: ${typeof p.year === 'number' ? String(p.year) : 'Unknown based on provided data'}`,
        `Venue: ${p.venue ?? 'Unknown based on provided data'}`,
        `DOI: ${p.doi ?? 'Unknown based on provided data'}`,
        `URL: ${p.url ?? 'Unknown based on provided data'}`,
        `Abstract: ${p.abstract ?? 'Unknown based on provided data'}`,
      ].join('\n');
    };

    const prompt = [
      `PAIR ID: ${inputData.pairId}`,
      `USER IDEA:\n${inputData.idea}`,
      '',
      paperBlock('A', inputData.paperA),
      '',
      paperBlock('B', inputData.paperB),
    ].join('\n');

    try {
      // Stream the worker output so we can:
      // - see partial progress (via logs, and potentially forwarded through Mastra's network stream)
      // - more clearly localize timeouts/errors to a specific pair
      const response = await (agent as any).stream([{ role: 'user', content: prompt }] as any);

      let raw = '';
      let lastLogAt = 0;
      let deltaChars = 0;

      for await (const chunk of response.textStream as AsyncIterable<string>) {
        raw += chunk;
        deltaChars += chunk.length;

        const now = Date.now();
        if (now - lastLogAt > 1500) {
          lastLogAt = now;
          logger.debug('workflow.novelty_refine.mini_review_worker.delta', {
            pairId: inputData.pairId,
            deltaChars,
          });
        }
      }

      const trimmed = raw.trim();

      // Parse JSON. Be defensive in case the model wraps output despite instructions.
      let obj: unknown = null;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          obj = JSON.parse(trimmed.slice(start, end + 1));
        } else {
          throw new Error('miniReviewWorkerAgent stream did not return parseable JSON');
        }
      }

      const parsed = miniReportSchema.safeParse(obj);
      if (!parsed.success) {
        throw new Error('miniReviewWorkerAgent returned invalid structured output');
      }

      logger.info('workflow.novelty_refine.mini_review_worker.finish', {
        pairId: inputData.pairId,
        miniLitReviewTextChars: String(parsed.data.miniLitReviewText || '').length,
        miniNoveltyAssessmentTextChars: String(parsed.data.miniNoveltyAssessmentText || '').length,
      });

      // Ensure pairId is preserved even if the model forgets.
      return { ...parsed.data, pairId: inputData.pairId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('workflow.novelty_refine.mini_review_worker.error', {
        pairId: inputData.pairId,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });

      // IMPORTANT: Do not throw. If we throw inside .foreach(), one pair failure can abort the entire fan-out.
      // Instead, return a "best-effort" report that preserves schema so consolidation can still proceed.
      return {
        pairId: inputData.pairId,
        miniLitReviewText: `Worker failed for ${inputData.pairId}. Error: ${message}`,
        miniNoveltyAssessmentText: `Worker failed for ${inputData.pairId}. Error: ${message}`,
        keyTakeaways: [],
        overlapSignals: [],
        noveltySignals: [],
        risks: [`worker_error: ${message}`],
        citations: [],
      };
    }
  },
});

/**
 * Step 5a: consolidate literature review + write to VFS.
 */
const consolidateLitReviewAndWriteStep = createStep({
  id: 'consolidate_lit_review_and_write',
  description: 'Consolidates mini literature reviews into one lit review artifact and writes it to VFS',
  inputSchema: z.object({
    idea: z.string(),
    query: z.string(),
    nPapers: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    papers: z.array(paperSchema),
    pairs: z.array(pairSchema),
    miniReports: z.array(miniReportSchema),
  }),
  outputSchema: z.object({
    litReviewPath: z.string(),
    litReviewText: z.string(),
  }),
  execute: async ({ inputData, mastra, requestContext }: any) => {
    logger.info('workflow.novelty_refine.consolidate_lit_review_and_write.start', {
      ...traceMeta(requestContext),
      ideaChars: String(inputData.idea || '').length,
      queryChars: String(inputData.query || '').length,
      nPapers: inputData.nPapers,
      concurrency: inputData.concurrency,
      papersCount: inputData.papers?.length,
      pairsCount: inputData.pairs?.length,
      miniReportsCount: inputData.miniReports?.length,
    });
    if (!mastra) throw new Error('Mastra instance not available in workflow step');
    const agent = mastra.getAgent('consolidateLitReviewAgent');
    if (!agent) throw new Error('consolidateLitReviewAgent not found (is it registered in mastra/index.ts?)');

    const papersList = inputData.papers
      .map((p: z.infer<typeof paperSchema>) => {
        const y = typeof p.year === 'number' ? ` (${p.year})` : '';
        const u = p.url ? ` — ${p.url}` : '';
        const d = p.doi ? ` DOI:${p.doi}` : '';
        return `- ${p.title}${y}${d}${u}`;
      })
      .join('\n');

    const miniLit = inputData.miniReports
      .map((r: z.infer<typeof miniReportSchema>) => {
        const takeaways = (r.keyTakeaways ?? []).map((t) => `- ${t}`).join('\n');
        return `PAIR ${r.pairId}\nMINI LIT REVIEW:\n${r.miniLitReviewText}\nKEY TAKEAWAYS:\n${takeaways || '(none)'}\n`;
      })
      .join('\n');

    const prompt = [
      `USER IDEA:\n${inputData.idea}`,
      '',
      `QUERY USED:\n${inputData.query}`,
      '',
      `PAPERS (PROVIDED LIST):\n${papersList}`,
      '',
      `MINI LITERATURE REVIEWS:\n${miniLit}`,
      '',
      `Write a single consolidated literature review in markdown with clear headings. Do not invent citations.`,
    ].join('\n');

    const res = await agent.generate(prompt, {
      structuredOutput: { schema: textOutSchema, errorStrategy: 'strict' },
    } as any);

    const litReviewText = String((res as any)?.object?.text ?? '').trim();
    if (!litReviewText) throw new Error('consolidateLitReviewAgent returned empty text');

    await (writeFileTool as any).execute(
      { path: OUTPUT_PATHS.litReview, op: 'replace', content: litReviewText },
      { requestContext },
    );

    logger.info('workflow.novelty_refine.consolidate_lit_review_and_write.finish', {
      ...traceMeta(requestContext),
      litReviewTextChars: litReviewText.length,
    });

    return { litReviewPath: OUTPUT_PATHS.litReview, litReviewText };
  },
});

/**
 * Step 5b: consolidate novelty assessment + write to VFS.
 */
const consolidateNoveltyAndWriteStep = createStep({
  id: 'consolidate_novelty_and_write',
  description: 'Consolidates mini novelty assessments into one novelty artifact and writes it to VFS',
  inputSchema: z.object({
    idea: z.string(),
    query: z.string(),
    nPapers: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    papers: z.array(paperSchema),
    pairs: z.array(pairSchema),
    miniReports: z.array(miniReportSchema),
  }),
  outputSchema: z.object({
    noveltyAssessmentPath: z.string(),
    noveltyAssessmentText: z.string(),
  }),
  execute: async ({ inputData, mastra, requestContext }: any) => {
    if (!mastra) throw new Error('Mastra instance not available in workflow step');
    const agent = mastra.getAgent('consolidateNoveltyAgent');
    if (!agent) throw new Error('consolidateNoveltyAgent not found (is it registered in mastra/index.ts?)');

    const papersList = inputData.papers
      .map((p: z.infer<typeof paperSchema>) => {
        const y = typeof p.year === 'number' ? ` (${p.year})` : '';
        const u = p.url ? ` — ${p.url}` : '';
        const d = p.doi ? ` DOI:${p.doi}` : '';
        return `- ${p.title}${y}${d}${u}`;
      })
      .join('\n');

    const miniNovelty = inputData.miniReports
      .map((r: z.infer<typeof miniReportSchema>) => {
        const overlap = (r.overlapSignals ?? []).map((t) => `- ${t}`).join('\n');
        const novelty = (r.noveltySignals ?? []).map((t) => `- ${t}`).join('\n');
        const risks = (r.risks ?? []).map((t) => `- ${t}`).join('\n');
        return [
          `PAIR ${r.pairId}`,
          `MINI NOVELTY ASSESSMENT:\n${r.miniNoveltyAssessmentText}`,
          `OVERLAP SIGNALS:\n${overlap || '(none)'}`,
          `NOVELTY SIGNALS:\n${novelty || '(none)'}`,
          `RISKS:\n${risks || '(none)'}`,
          '',
        ].join('\n');
      })
      .join('\n');

    const prompt = [
      `USER IDEA:\n${inputData.idea}`,
      '',
      `QUERY USED:\n${inputData.query}`,
      '',
      `PAPERS (PROVIDED LIST):\n${papersList}`,
      '',
      `MINI NOVELTY ASSESSMENTS:\n${miniNovelty}`,
      '',
      `Write a single consolidated novelty assessment in markdown with clear headings. Do not invent citations.`,
    ].join('\n');

    const res = await agent.generate(prompt, {
      structuredOutput: { schema: textOutSchema, errorStrategy: 'strict' },
    } as any);

    const noveltyAssessmentText = String((res as any)?.object?.text ?? '').trim();
    if (!noveltyAssessmentText) throw new Error('consolidateNoveltyAgent returned empty text');

    await (writeFileTool as any).execute(
      { path: OUTPUT_PATHS.novelty, op: 'replace', content: noveltyAssessmentText },
      { requestContext },
    );

    return { noveltyAssessmentPath: OUTPUT_PATHS.novelty, noveltyAssessmentText };
  },
});

/**
 * Step 5c: refine the idea + write to VFS.
 * - Uses memory scoping (resource=userId, thread=projectId) so it can pick up constraints/preferences.
 */
const refineIdeaAndWriteStep = createStep({
  id: 'refine_idea_and_write',
  description: 'Refines the idea using consolidated lit review + novelty assessment and writes it to VFS',
  inputSchema: z.object({
    idea: z.string(),
    query: z.string(),
    litReviewPath: z.string(),
    litReviewText: z.string(),
    noveltyAssessmentPath: z.string(),
    noveltyAssessmentText: z.string(),
  }),
  outputSchema: z.object({
    litReviewText: z.string(),
    noveltyAssessmentText: z.string(),
    refinedIdeaText: z.string(),
  }),
  execute: async ({ inputData, mastra, requestContext }: any) => {
    logger.info('workflow.novelty_refine.refine_idea_and_write.start', {
      ...traceMeta(requestContext),
      ideaChars: String(inputData.idea || '').length,
      litReviewTextChars: String(inputData.litReviewText || '').length,
      noveltyAssessmentTextChars: String(inputData.noveltyAssessmentText || '').length,
    });
    if (!mastra) throw new Error('Mastra instance not available in workflow step');
    const agent = mastra.getAgent('refineIdeaAgent');
    if (!agent) throw new Error('refineIdeaAgent not found (is it registered in mastra/index.ts?)');

    const prompt = [
      `ORIGINAL USER IDEA:\n${inputData.idea}`,
      '',
      `CONSOLIDATED LITERATURE REVIEW (from ${inputData.litReviewPath}):\n${inputData.litReviewText}`,
      '',
      `CONSOLIDATED NOVELTY ASSESSMENT (from ${inputData.noveltyAssessmentPath}):\n${inputData.noveltyAssessmentText}`,
      '',
      `Write a refined idea in markdown format, grounded in the above artifacts.`,
    ].join('\n');

    const res = await agent.generate(prompt, {
      structuredOutput: { schema: textOutSchema, errorStrategy: 'strict' },
    } as any);

    const refinedIdeaText = String((res as any)?.object?.text ?? '').trim();
    if (!refinedIdeaText) throw new Error('refineIdeaAgent returned empty text');

    await (writeFileTool as any).execute(
      { path: OUTPUT_PATHS.refinedIdea, op: 'replace', content: refinedIdeaText },
      { requestContext },
    );

    logger.info('workflow.novelty_refine.refine_idea_and_write.finish', {
      ...traceMeta(requestContext),
      refinedIdeaTextChars: refinedIdeaText.length,
    });

    return {
      litReviewText: inputData.litReviewText,
      noveltyAssessmentText: inputData.noveltyAssessmentText,
      refinedIdeaText,
    };
  },
});

export const noveltyRefineWorkflow = createWorkflow({
  id: 'novelty-refine-workflow',
  description:
    'Novelty refine: build a search query from idea, fetch N papers, batch into pairs, run per-pair workers, consolidate, and write artifacts.',
  inputSchema: z.object({
    idea: z.string().min(1).max(10_000),
  }),
  outputSchema: z.object({
    litReviewText: z.string(),
    noveltyAssessmentText: z.string(),
    refinedIdeaText: z.string(),
  }),
})
  .then(buildQueryStep)
  .then(fetchPapersStep)
  .then(pairPapersStep)
  // Prepare array input for foreach (foreach requires the workflow input to be an array).
  .map(async ({ inputData }) => {
    return inputData.pairs.map((p: z.infer<typeof pairSchema>) => ({
      idea: inputData.idea,
      pairId: p.pairId,
      paperA: p.paperA,
      paperB: p.paperB,
    }));
  })
  // Fan-out: run a mini review per pair, in parallel with env-driven concurrency.
  .foreach(miniReviewWorkerStep, { concurrency: getConfigFromEnv().concurrency })
  // Rehydrate the full object shape for downstream consolidation steps.
  .map(async ({ inputData, getStepResult }) => {
    const paired = getStepResult('pair_papers') as any;
    return {
      ...paired,
      miniReports: Array.isArray(inputData) ? inputData : [],
    };
  })
  // Run both consolidations in parallel to reduce latency/cost wall-time.
  .parallel([consolidateLitReviewAndWriteStep, consolidateNoveltyAndWriteStep])
  // Merge parallel outputs into the refine step input, and drop miniReports from the payload.
  .map(async ({ getStepResult }) => {
    const paired = getStepResult('pair_papers') as any;
    const lit = getStepResult('consolidate_lit_review_and_write') as any;
    const nov = getStepResult('consolidate_novelty_and_write') as any;

    return {
      idea: paired.idea,
      query: paired.query,
      litReviewPath: String(lit?.litReviewPath || OUTPUT_PATHS.litReview),
      litReviewText: String(lit?.litReviewText || ''),
      noveltyAssessmentPath: String(nov?.noveltyAssessmentPath || OUTPUT_PATHS.novelty),
      noveltyAssessmentText: String(nov?.noveltyAssessmentText || ''),
    };
  })
  .then(refineIdeaAndWriteStep)
  .commit();


