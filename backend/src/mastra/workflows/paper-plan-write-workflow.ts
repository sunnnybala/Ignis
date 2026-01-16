import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { readFileTool } from '../tools/read-file';
import { writeFileTool } from '../tools/write-file';
import { readLatestResultsTool } from '../tools/read-latest-results';
import { getLatestResultImagesTool } from '../tools/get-latest-result-images';
import { logger } from '../../utils/logger';

function traceMeta(requestContext: any): { traceId: string | null; userId?: string; projectId?: string } {
  const traceId = requestContext?.get?.('traceId') ? String(requestContext.get('traceId')) : null;
  const userId = requestContext?.get?.('userId') ? String(requestContext.get('userId')) : undefined;
  const projectId = requestContext?.get?.('projectId') ? String(requestContext.get('projectId')) : undefined;
  return { traceId, userId, projectId };
}

function clipText(label: string, text: string, maxChars: number): string {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const half = Math.floor(maxChars / 2);
  return `${s.slice(0, half)}\n\n[... clipped ${label}: ${s.length - maxChars} chars ...]\n\n${s.slice(-half)}`;
}

// NOTE: This workflow uses .stream() + manual JSON parsing instead of .generate() with structuredOutput.
// Complex Zod schemas (nested arrays, tuples, URL validators) cause hangs with Vertex AI/Gemini + structuredOutput.
// The streaming approach bypasses this issue and is proven to work in novelty-refine-workflow.
// See: https://github.com/vercel/ai/issues/4412

const PATHS = {
  refinedIdea: 'Research/refined_idea.md',
  designPlan: 'Design/design_plan.md',
  datasetConfig: 'Design/dataset.json',
  experimentPy: 'Experimentation/experiment.py',
  paperTex: 'Final_Paper/paper.tex',
  paperMeta: 'Final_Paper/paper_metadata.json',
} as const;

const plannerSchema = z.object({
  selectedJournal: z.string(),
  paperTitleCandidates: z.array(z.string()).default([]),
  outline: z.array(z.object({ sectionId: z.string(), bullets: z.array(z.string()).default([]) })).default([]),
  figurePlan: z
    .array(z.object({ figureId: z.string(), imageUrl: z.string().url(), caption: z.string(), sectionId: z.string() }))
    .default([]),
});

const latexSchema = z.object({
  latex: z.string().min(1),
  publicationProbability: z.number().min(0).max(1),
  suggestedJournals: z.tuple([z.string(), z.string(), z.string()]),
});

/**
 * Step 1:
 * - Read refined idea, plan, dataset config, experiment code (VFS)
 * - Read latest results.txt (tool)
 * - Get signed URLs for latest result images (tool)
 * - Construct a single prompt bundle string for downstream agents
 */
const gatherPaperContextStep = createStep({
  id: 'gather_paper_context',
  description: 'Gather latest results + images + project artifacts and build a prompt bundle for paper planning',
  inputSchema: z.object({
    selectedJournal: z.string().optional().default('General'),
  }),
  outputSchema: z.object({
    selectedJournal: z.string(),
    promptBundle: z.string(),
    imageUrls: z.array(z.string().url()).default([]),
    latestRunId: z.string().nullable(),
  }),
  execute: async ({ inputData, requestContext }: any) => {
    logger.info('workflow.paper_plan_write.gather_context.start', traceMeta(requestContext));

    const selectedJournal = (String(inputData?.selectedJournal ?? '').trim() || 'General').trim();

    const refined = await (readFileTool as any).execute({ path: PATHS.refinedIdea }, { requestContext });
    if (!refined?.found) throw new Error(`Missing required file: ${PATHS.refinedIdea}. Run novelty-refine workflow first.`);
    const refinedIdeaText = clipText('refined_idea', String(refined.content ?? ''), 18_000);

    const plan = await (readFileTool as any).execute({ path: PATHS.designPlan }, { requestContext });
    const designPlanMd = plan?.found ? clipText('design_plan', String(plan.content ?? ''), 18_000) : '';

    const dataset = await (readFileTool as any).execute({ path: PATHS.datasetConfig }, { requestContext });
    const datasetJsonText = dataset?.found ? clipText('dataset_json', String(dataset.content ?? ''), 6_000) : '';

    const exp = await (readFileTool as any).execute({ path: PATHS.experimentPy }, { requestContext });
    const experimentPy = exp?.found ? clipText('experiment_py', String(exp.content ?? ''), 22_000) : '';

    const latestResults = await (readLatestResultsTool as any).execute({ maxChars: 120_000 }, { requestContext });
    const latestResultsText = latestResults?.found ? String(latestResults.content ?? '') : '';
    const latestRunId: string | null =
      latestResults?.found && typeof latestResults?.timestamp === 'string' && latestResults.timestamp.trim()
        ? latestResults.timestamp.trim()
        : null;

    const imagesRes = await (getLatestResultImagesTool as any).execute({ maxCount: 20 }, { requestContext });
    const images = Array.isArray(imagesRes?.images) ? imagesRes.images : [];
    const imageUrls = images
      .map((x: any) => String(x?.signedUrl || '').trim())
      .filter((u: string) => u.length > 0);

    const figuresBlock =
      imageUrls.length > 0
        ? imageUrls.map((u: string, i: number) => `- Figure ${i + 1}: ${u}`).join('\n')
        : '(no figures found)';

    const promptBundle = [
      `SELECTED JOURNAL: ${selectedJournal}`,
      ``,
      `REFINED IDEA (from ${PATHS.refinedIdea}):`,
      refinedIdeaText,
      ``,
      `DESIGN PLAN (from ${PATHS.designPlan}):`,
      designPlanMd || '(missing/empty)',
      ``,
      `DATASET CONFIG (from ${PATHS.datasetConfig}):`,
      datasetJsonText || '(missing/empty)',
      ``,
      `EXPERIMENT CODE (from ${PATHS.experimentPy}):`,
      experimentPy || '(missing/empty)',
      ``,
      `LATEST RESULTS.TXT (from Results/<run>/results.txt):`,
      latestResultsText ? clipText('results_txt', latestResultsText, 60_000) : '(no results found)',
      ``,
      `FIGURE URLS (signed):`,
      figuresBlock,
    ].join('\n');

    logger.info('workflow.paper_plan_write.gather_context.finish', {
      ...traceMeta(requestContext),
      imageUrlsCount: imageUrls.length,
      hasLatestResults: !!latestResultsText,
      promptBundleChars: promptBundle.length,
    });

    return { selectedJournal, promptBundle, imageUrls, latestRunId };
  },
});

/**
 * Step 2: Call paperPlannerAgent with structured output schema (simplified).
 */
const planPaperStep = createStep({
  id: 'plan_paper',
  description: 'Plan paper outline and figure placement (journal-aware)',
  inputSchema: z.object({
    selectedJournal: z.string(),
    promptBundle: z.string(),
    imageUrls: z.array(z.string().url()).default([]),
    latestRunId: z.string().nullable(),
  }),
  outputSchema: z.object({
    selectedJournal: z.string(),
    promptBundle: z.string(),
    imageUrls: z.array(z.string().url()).default([]),
    paperPlan: plannerSchema,
    latestRunId: z.string().nullable(),
  }),
  execute: async ({ inputData, mastra, requestContext }: any) => {
    if (!mastra) throw new Error('Mastra instance not available in workflow step');

    logger.info('workflow.paper_plan_write.plan_paper.start', traceMeta(requestContext));

    const agent = mastra.getAgent('paperPlannerAgent');
    if (!agent) throw new Error('paperPlannerAgent not found (is it registered in mastra/index.ts?)');

    const prompt = [
      `You will return a JSON paper plan.`,
      ``,
      inputData.promptBundle,
      ``,
      `IMPORTANT: Only reference imageUrl values that appear in the FIGURE URLS list above.`,
      ``,
      `Return ONLY valid JSON matching this schema (no markdown, no explanation):`,
      `{ "selectedJournal": string, "paperTitleCandidates": string[], "outline": [{ "sectionId": string, "bullets": string[] }], "figurePlan": [{ "figureId": string, "imageUrl": string, "caption": string, "sectionId": string }] }`,
    ].join('\n');

    // Use .stream() + manual JSON parsing to avoid Vertex AI/Gemini structured output hang
    // with complex schemas (nested arrays, defaults, tuples, URL validators).
    // This pattern is proven to work in novelty-refine-workflow's mini-review-worker.
    // See: https://github.com/vercel/ai/issues/4412
    logger.debug('workflow.paper_plan_write.plan_paper.stream_start', {
      ...traceMeta(requestContext),
      promptChars: prompt.length,
    });

    const response = await (agent as any).stream([{ role: 'user', content: prompt }] as any);

    let raw = '';
    let lastLogAt = Date.now();
    let chunkCount = 0;

    for await (const chunk of response.textStream as AsyncIterable<string>) {
      raw += chunk;
      chunkCount++;

      // Log progress every 2 seconds to show streaming is working
      const now = Date.now();
      if (now - lastLogAt > 2000) {
        logger.debug('workflow.paper_plan_write.plan_paper.stream_progress', {
          ...traceMeta(requestContext),
          chunkCount,
          totalChars: raw.length,
          elapsedMs: now - lastLogAt,
        });
        lastLogAt = now;
      }
    }

    logger.debug('workflow.paper_plan_write.plan_paper.stream_complete', {
      ...traceMeta(requestContext),
      chunkCount,
      totalChars: raw.length,
    });

    // Parse JSON defensively - handle markdown code blocks or extra text
    let obj: unknown = null;
    const trimmed = raw.trim();
    try {
      obj = JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        obj = JSON.parse(trimmed.slice(start, end + 1));
      } else {
        throw new Error('paperPlannerAgent stream did not return parseable JSON');
      }
    }

    const parsed = plannerSchema.safeParse(obj);
    if (!parsed.success) throw new Error('paperPlannerAgent returned invalid structured output: ' + parsed.error.message);

    logger.info('workflow.paper_plan_write.plan_paper.finish', {
      ...traceMeta(requestContext),
      outlineSections: parsed.data.outline.length,
      figurePlanCount: parsed.data.figurePlan.length,
    });

    return {
      selectedJournal: String(parsed.data.selectedJournal || inputData.selectedJournal).trim() || inputData.selectedJournal,
      promptBundle: inputData.promptBundle,
      imageUrls: Array.isArray(inputData.imageUrls) ? inputData.imageUrls : [],
      paperPlan: parsed.data,
      latestRunId: inputData.latestRunId ?? null,
    };
  },
});

/**
 * Step 3: Call latexWriterAgent and write paper outputs to VFS.
 * - Writes Final_Paper/paper.tex
 * - Writes Final_Paper/paper_metadata.json (json with publicationProbability + suggestedJournals + selectedJournal + latestRunId)
 */
const writePaperStep = createStep({
  id: 'write_paper',
  description: 'Write LaTeX paper and metadata based on plan + latest results',
  inputSchema: z.object({
    selectedJournal: z.string(),
    promptBundle: z.string(),
    imageUrls: z.array(z.string().url()).default([]),
    paperPlan: plannerSchema,
    latestRunId: z.string().nullable(),
  }),
  outputSchema: z.object({
    paperPlan: plannerSchema,
    latex: z.string(),
    publicationProbability: z.number().min(0).max(1),
    suggestedJournals: z.array(z.string()).length(3),
  }),
  execute: async ({ inputData, mastra, requestContext }: any) => {
    if (!mastra) throw new Error('Mastra instance not available in workflow step');

    logger.info('workflow.paper_plan_write.write_paper.start', traceMeta(requestContext));

    const agent = mastra.getAgent('latexWriterAgent');
    if (!agent) throw new Error('latexWriterAgent not found (is it registered in mastra/index.ts?)');

    const prompt = [
      `You will return JSON with latex + publicationProbability + 3 suggested journals.`,
      ``,
      inputData.promptBundle,
      ``,
      `PAPER PLAN (JSON):`,
      JSON.stringify(inputData.paperPlan, null, 2),
      ``,
      `Return ONLY valid JSON matching this schema (no markdown, no explanation):`,
      `{ "latex": string, "publicationProbability": number (0-1), "suggestedJournals": [string, string, string] }`,
    ].join('\n');

    // Use .stream() + manual JSON parsing to avoid Vertex AI/Gemini structured output hang
    // with complex schemas (tuples). This pattern is proven in novelty-refine-workflow.
    // See: https://github.com/vercel/ai/issues/4412
    logger.debug('workflow.paper_plan_write.write_paper.stream_start', {
      ...traceMeta(requestContext),
      promptChars: prompt.length,
    });

    const response = await (agent as any).stream([{ role: 'user', content: prompt }] as any);

    let raw = '';
    let lastLogAt = Date.now();
    let chunkCount = 0;

    for await (const chunk of response.textStream as AsyncIterable<string>) {
      raw += chunk;
      chunkCount++;

      // Log progress every 2 seconds to show streaming is working
      const now = Date.now();
      if (now - lastLogAt > 2000) {
        logger.debug('workflow.paper_plan_write.write_paper.stream_progress', {
          ...traceMeta(requestContext),
          chunkCount,
          totalChars: raw.length,
          elapsedMs: now - lastLogAt,
        });
        lastLogAt = now;
      }
    }

    logger.debug('workflow.paper_plan_write.write_paper.stream_complete', {
      ...traceMeta(requestContext),
      chunkCount,
      totalChars: raw.length,
    });

    // Parse JSON defensively - handle markdown code blocks or extra text
    let obj: unknown = null;
    const trimmed = raw.trim();
    try {
      obj = JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        obj = JSON.parse(trimmed.slice(start, end + 1));
      } else {
        throw new Error('latexWriterAgent stream did not return parseable JSON');
      }
    }

    const parsed = latexSchema.safeParse(obj);
    if (!parsed.success) throw new Error('latexWriterAgent returned invalid structured output: ' + parsed.error.message);

    const latex = String(parsed.data.latex ?? '').trim();
    if (!latex) throw new Error('latexWriterAgent returned empty latex');

    const suggestedJournals = Array.from(parsed.data.suggestedJournals).map((s) => String(s).trim());
    const publicationProbability = Number(parsed.data.publicationProbability);

    await (writeFileTool as any).execute(
      { path: PATHS.paperTex, op: 'replace', content: latex },
      { requestContext },
    );

    const meta = {
      selectedJournal: inputData.selectedJournal,
      publicationProbability,
      suggestedJournals,
      latestRunId: inputData.latestRunId,
      generatedAt: new Date().toISOString(),
    };
    await (writeFileTool as any).execute(
      { path: PATHS.paperMeta, op: 'replace', content: JSON.stringify(meta, null, 2) },
      { requestContext },
    );

    logger.info('workflow.paper_plan_write.write_paper.finish', {
      ...traceMeta(requestContext),
      latexChars: latex.length,
      publicationProbability,
    });

    return {
      paperPlan: inputData.paperPlan,
      latex,
      publicationProbability,
      suggestedJournals,
    };
  },
});

export const paperPlanWriteWorkflow = createWorkflow({
  id: 'paper-plan-write-workflow',
  description:
    'Paper writing: gather latest results + images, plan the paper, then write LaTeX and metadata into Final_Paper.',
  inputSchema: z.object({
    selectedJournal: z.string().optional().default('General'),
  }),
  outputSchema: z.object({
    paperPlan: plannerSchema,
    latex: z.string(),
    publicationProbability: z.number().min(0).max(1),
    suggestedJournals: z.array(z.string()).length(3),
  }),
})
  .then(gatherPaperContextStep)
  .then(planPaperStep)
  .then(writePaperStep)
  .commit();


