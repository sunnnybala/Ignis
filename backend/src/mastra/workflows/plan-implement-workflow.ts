import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { readFileTool } from '../tools/read-file';
import { writeFileTool } from '../tools/write-file';
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

const PATHS = {
  refinedIdea: 'Research/refined_idea.md',
  designPlan: 'Design/design_plan.md',
  datasetConfig: 'Design/dataset.json',
  experimentPy: 'Experimentation/experiment.py',
  requirementsTxt: 'Experimentation/requirements.txt',
} as const;

const plannerOutputSchema = z.object({
  designPlanMd: z.string().min(1),
  datasetJson: z.object({
    source: z.literal('kaggle'),
    kaggle: z.object({
      dataset: z.string(),
      unzip: z.boolean(),
    }),
    layout: z.object({
      subdir: z.string(),
    }),
    notes: z.string(),
  }),
  datasetRationale: z.string(),
});

const coderOutputSchema = z.object({
  experimentPy: z.string().min(1),
  // Allow empty: if the script uses only stdlib, requirements can be blank.
  requirementsTxt: z.string(),
});

/**
 * Step 1:
 * - read Research/refined_idea.md (tool)
 * - embed file contents in prompt
 * - call implementationPlannerAgent with structuredOutput + memory (resource=userId, thread=projectId)
 * - write Design/design_plan.md + Design/dataset.json (tool)
 */
const planAndDatasetStep = createStep({
  id: 'plan_and_select_dataset',
  description: 'Create implementation plan + dataset config from refined idea and write to VFS',
  inputSchema: z.object({}),
  outputSchema: z.object({
    designPlanMd: z.string(),
    datasetJsonText: z.string(),
    datasetRationale: z.string(),
  }),
  execute: async ({ mastra, requestContext }: any) => {
    if (!mastra) throw new Error('Mastra instance not available in workflow step');

    logger.info('workflow.plan_implement.plan_and_dataset.start', traceMeta(requestContext));

    const refined = await (readFileTool as any).execute({ path: PATHS.refinedIdea }, { requestContext });
    if (!refined?.found) {
      throw new Error(`Missing required file: ${PATHS.refinedIdea}. Run novelty-refine workflow first.`);
    }
    const refinedIdeaText = clipText('refined_idea', String(refined.content ?? ''), 24_000);

    const agent = mastra.getAgent('implementationPlannerAgent');
    if (!agent) throw new Error('implementationPlannerAgent not found (is it registered in mastra/index.ts?)');

    const prompt = [
      `You are generating two outputs for this project:`,
      `1) Design/design_plan.md`,
      `2) Design/dataset.json`,
      ``,
      `REFINED IDEA (from ${PATHS.refinedIdea}):`,
      refinedIdeaText,
    ].join('\n');

    const res = await agent.generate(prompt, {
      structuredOutput: { schema: plannerOutputSchema, errorStrategy: 'strict' },
    } as any);

    const parsed = plannerOutputSchema.safeParse((res as any)?.object);
    if (!parsed.success) throw new Error('implementationPlannerAgent returned invalid structured output');

    const designPlanMd = String(parsed.data.designPlanMd ?? '').trim();
    if (!designPlanMd) throw new Error('implementationPlannerAgent returned empty designPlanMd');

    const datasetJsonObj = parsed.data.datasetJson;
    const datasetJsonText = JSON.stringify(datasetJsonObj, null, 2);

    await (writeFileTool as any).execute(
      { path: PATHS.designPlan, op: 'replace', content: designPlanMd },
      { requestContext },
    );
    await (writeFileTool as any).execute(
      { path: PATHS.datasetConfig, op: 'replace', content: datasetJsonText },
      { requestContext },
    );

    logger.info('workflow.plan_implement.plan_and_dataset.finish', {
      ...traceMeta(requestContext),
      designPlanChars: designPlanMd.length,
      datasetJsonChars: datasetJsonText.length,
    });

    return {
      designPlanMd,
      datasetJsonText,
      datasetRationale: String(parsed.data.datasetRationale ?? '').trim(),
    };
  },
});

/**
 * Step 2:
 * - read refined idea + plan + dataset config (tools)
 * - embed all file contents in prompt
 * - call experimentCoderAgent with structuredOutput + memory (resource=userId, thread=projectId)
 * - write Experimentation/experiment.py (tool)
 */
const generateExperimentStep = createStep({
  id: 'generate_experiment',
  description:
    'Generate Experimentation/experiment.py + Experimentation/requirements.txt from refined idea + design plan + dataset config and write to VFS',
  inputSchema: z.object({
    designPlanMd: z.string(),
    datasetJsonText: z.string(),
    datasetRationale: z.string(),
  }),
  outputSchema: z.object({
    designPlanMd: z.string(),
    datasetJsonText: z.string(),
    experimentPy: z.string(),
    requirementsTxt: z.string(),
  }),
  execute: async ({ inputData, mastra, requestContext }: any) => {
    if (!mastra) throw new Error('Mastra instance not available in workflow step');

    logger.info('workflow.plan_implement.generate_experiment.start', traceMeta(requestContext));

    const refined = await (readFileTool as any).execute({ path: PATHS.refinedIdea }, { requestContext });
    const plan = await (readFileTool as any).execute({ path: PATHS.designPlan }, { requestContext });
    const dataset = await (readFileTool as any).execute({ path: PATHS.datasetConfig }, { requestContext });

    if (!refined?.found) throw new Error(`Missing required file: ${PATHS.refinedIdea}`);
    if (!plan?.found) throw new Error(`Missing required file: ${PATHS.designPlan}`);
    if (!dataset?.found) throw new Error(`Missing required file: ${PATHS.datasetConfig}`);

    const refinedIdeaText = clipText('refined_idea', String(refined.content ?? ''), 18_000);
    const designPlanText = clipText('design_plan', String(plan.content ?? ''), 24_000);
    const datasetConfigText = clipText('dataset_json', String(dataset.content ?? ''), 8_000);

    // Extract verified file listing from dataset.json to pass to experiment coder
    let fileListingBlock = '';
    try {
      const dsObj = JSON.parse(String(dataset.content ?? '{}'));
      const files = dsObj.kaggle?.files;
      if (Array.isArray(files) && files.length > 0) {
        // Handle both string[] and {name: string}[] formats
        const names = files.map((f: unknown) => (typeof f === 'string' ? f : (f as { name?: string })?.name ?? '')).filter(Boolean);
        if (names.length > 0) {
          fileListingBlock = [
            ``,
            `VERIFIED DATASET FILES (from Kaggle API):`,
            ...names.map((n: string) => `  - ${n}`),
            ``,
            `IMPORTANT: Use ONLY these exact file paths in your code. Do NOT guess or assume other paths exist.`,
            `If your experiment needs a file not in this list, print an error explaining what's missing.`,
          ].join('\n');
        }
      }
    } catch {
      // Ignore JSON parse errors, proceed without file listing
    }

    const agent = mastra.getAgent('experimentCoderAgent');
    if (!agent) throw new Error('experimentCoderAgent not found (is it registered in mastra/index.ts?)');

    const prompt = [
      `You are generating TWO outputs for this project:`,
      `1) ${PATHS.experimentPy}`,
      `2) ${PATHS.requirementsTxt}`,
      ``,
      `REFINED IDEA (from ${PATHS.refinedIdea}):`,
      refinedIdeaText,
      ``,
      `DESIGN PLAN (from ${PATHS.designPlan}):`,
      designPlanText,
      ``,
      `DATASET CONFIG (from ${PATHS.datasetConfig}):`,
      datasetConfigText,
      fileListingBlock,
      ``,
      `Important: requirements.txt must list ONLY package names (one per line), no versions.`,
    ].join('\n');

    const res = await agent.generate(prompt, {
      structuredOutput: { schema: coderOutputSchema, errorStrategy: 'strict' },
    } as any);

    const parsed = coderOutputSchema.safeParse((res as any)?.object);
    if (!parsed.success) throw new Error('experimentCoderAgent returned invalid structured output');

    const experimentPy = String(parsed.data.experimentPy ?? '').trim();
    if (!experimentPy) throw new Error('experimentCoderAgent returned empty experimentPy');

    const requirementsTxt = String(parsed.data.requirementsTxt ?? '');

    await (writeFileTool as any).execute(
      { path: PATHS.experimentPy, op: 'replace', content: experimentPy },
      { requestContext },
    );
    await (writeFileTool as any).execute(
      { path: PATHS.requirementsTxt, op: 'replace', content: requirementsTxt },
      { requestContext },
    );

    logger.info('workflow.plan_implement.generate_experiment.finish', {
      ...traceMeta(requestContext),
      experimentPyChars: experimentPy.length,
      requirementsTxtChars: requirementsTxt.length,
    });

    // Return the file contents so a supervisor can summarize without re-reading.
    return {
      designPlanMd: String(inputData.designPlanMd ?? '').trim(),
      datasetJsonText: String(inputData.datasetJsonText ?? '').trim(),
      experimentPy,
      requirementsTxt,
    };
  },
});

export const planImplementWorkflow = createWorkflow({
  id: 'plan-implement-workflow',
  description:
    'Plan + implement: read refined idea, write a design plan + dataset config, then generate experiment.py from those artifacts.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    designPlanMd: z.string(),
    datasetJsonText: z.string(),
    experimentPy: z.string(),
    requirementsTxt: z.string(),
  }),
})
  .then(planAndDatasetStep)
  .then(generateExperimentStep)
  .commit();


