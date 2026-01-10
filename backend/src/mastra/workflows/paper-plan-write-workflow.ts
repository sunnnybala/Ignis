import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { readFileTool } from '../tools/read-file';
import { writeFileTool } from '../tools/write-file';
import { readLatestResultsTool } from '../tools/read-latest-results';
import { getLatestResultImagesTool } from '../tools/get-latest-result-images';

function clipText(label: string, text: string, maxChars: number): string {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const half = Math.floor(maxChars / 2);
  return `${s.slice(0, half)}\n\n[... clipped ${label}: ${s.length - maxChars} chars ...]\n\n${s.slice(-half)}`;
}

function inferImageMimeTypeFromUrl(url: string): string | undefined {
  const u = String(url || '').toLowerCase();
  if (u.includes('.png')) return 'image/png';
  if (u.includes('.jpg') || u.includes('.jpeg')) return 'image/jpeg';
  if (u.includes('.webp')) return 'image/webp';
  return undefined;
}

function maxPaperImageCount(): number {
  // Reuse the existing env convention used by the legacy paper route if set.
  const raw = Number(process.env.PAPER_MAX_IMAGE_COUNT || 6);
  if (!Number.isFinite(raw)) return 6;
  return Math.min(20, Math.max(0, Math.floor(raw)));
}

const PATHS = {
  refinedIdea: 'Research/refined_idea.txt',
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

    const agent = mastra.getAgent('paperPlannerAgent');
    if (!agent) throw new Error('paperPlannerAgent not found (is it registered in mastra/index.ts?)');

    const prompt = [
      `You will return a JSON paper plan.`,
      ``,
      inputData.promptBundle,
      ``,
      `IMPORTANT: Only reference imageUrl values that appear in the FIGURE URLS list above.`,
    ].join('\n');

    const cappedUrls = Array.isArray(inputData.imageUrls) ? inputData.imageUrls.slice(0, maxPaperImageCount()) : [];
    const contentParts: any[] = [];
    for (const url of cappedUrls) {
      const mimeType = inferImageMimeTypeFromUrl(url);
      // Per Mastra docs, images must be passed as multimodal parts to be "seen" by the model.
      contentParts.push({ type: 'image', image: url, ...(mimeType ? { mimeType } : {}) });
    }
    contentParts.push({ type: 'text', text: prompt });

    const res = await agent.generate(
      [
        {
          role: 'user',
          content: contentParts,
        },
      ],
      {
      structuredOutput: { schema: plannerSchema, errorStrategy: 'strict' },
      } as any,
    );

    const parsed = plannerSchema.safeParse((res as any)?.object);
    if (!parsed.success) throw new Error('paperPlannerAgent returned invalid structured output');

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

    const agent = mastra.getAgent('latexWriterAgent');
    if (!agent) throw new Error('latexWriterAgent not found (is it registered in mastra/index.ts?)');

    const prompt = [
      `You will return JSON with latex + publicationProbability + 3 suggested journals.`,
      ``,
      inputData.promptBundle,
      ``,
      `PAPER PLAN (JSON):`,
      JSON.stringify(inputData.paperPlan, null, 2),
    ].join('\n');

    // Pass the signed URLs explicitly (threaded from Step 1) so we attach exactly the intended figures.
    const cappedUrls = (Array.isArray(inputData.imageUrls) ? inputData.imageUrls : []).slice(0, maxPaperImageCount());
    const contentParts: any[] = [];
    for (const url of cappedUrls) {
      const mimeType = inferImageMimeTypeFromUrl(url);
      contentParts.push({ type: 'image', image: url, ...(mimeType ? { mimeType } : {}) });
    }
    contentParts.push({ type: 'text', text: prompt });

    const res = await agent.generate(
      [
        {
          role: 'user',
          content: contentParts,
        },
      ],
      {
      structuredOutput: { schema: latexSchema, errorStrategy: 'strict' },
      } as any,
    );

    const parsed = latexSchema.safeParse((res as any)?.object);
    if (!parsed.success) throw new Error('latexWriterAgent returned invalid structured output');

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


