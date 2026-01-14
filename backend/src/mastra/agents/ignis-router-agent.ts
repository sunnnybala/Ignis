import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

import { geminiModel } from '../model';
import { noveltyRefineWorkflow } from '../workflows/novelty-refine-workflow';
import { planImplementWorkflow } from '../workflows/plan-implement-workflow';
import { paperPlanWriteWorkflow } from '../workflows/paper-plan-write-workflow';

import { researchAgent } from './research-agent';
import { planImplementAgent } from './plan-implement-agent';
import { paperWritingAgent } from './paper-writing-agent';

export type RouterPrimitiveId =
  | 'noveltyRefineWorkflow'
  | 'planImplementWorkflow'
  | 'paperPlanWriteWorkflow'
  | 'researchAgent'
  | 'planImplementAgent'
  | 'paperWritingAgent';

export type RouterStatus = {
  // non-empty checks only (per product decision)
  files: Record<string, boolean>;
  booleans: {
    research_files_ready: boolean;
    implementation_files_ready: boolean;
    paper_files_ready: boolean;
    research_workflow_has_run_once: boolean;
    implementation_workflow_has_run_once: boolean;
    paper_workflow_has_run_once: boolean;
  };
  allowedPrimitiveIds: RouterPrimitiveId[];
  overwritePathsByWorkflow: Record<
    'noveltyRefineWorkflow' | 'planImplementWorkflow' | 'paperPlanWriteWorkflow',
    string[]
  >;
};

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

export const ignisRouterAgent = new Agent({
  id: 'ignis-router-agent',
  name: 'Ignis Router Agent',
  description:
    'Top-level network router: chooses exactly one primitive (workflow or follow-up generalist agent) based on user intent + project artifact status and then summarizes what happened + next steps.',
  instructions: ({ requestContext }) => {
    const status = requestContext?.get?.('routerStatus') as RouterStatus | undefined;
    const allowedPrimitiveIds = uniq(status?.allowedPrimitiveIds ?? []);

    const overwriteBlock = status
      ? `OVERWRITE TARGETS (only for explicit reset + confirmation)
- noveltyRefineWorkflow overwrites:
  ${status.overwritePathsByWorkflow.noveltyRefineWorkflow.map((p) => `- ${p}`).join('\n  ')}
- planImplementWorkflow overwrites:
  ${status.overwritePathsByWorkflow.planImplementWorkflow.map((p) => `- ${p}`).join('\n  ')}
- paperPlanWriteWorkflow overwrites:
  ${status.overwritePathsByWorkflow.paperPlanWriteWorkflow.map((p) => `- ${p}`).join('\n  ')}
`
      : '';

    return `
You are the top-level router for Ignis.

You MUST do ONE of the following:
- Call EXACTLY ONE primitive from the allowed list, OR
- Call NO primitive, but ONLY for:
  (A) clarifying the user's original idea (only allowed before research has run once), OR
  (B) asking for confirmation before overwriting files to rerun a workflow reset.

ALLOWED PRIMITIVES RIGHT NOW:
${allowedPrimitiveIds.length ? allowedPrimitiveIds.map((id) => `- ${id}`).join('\n') : '- (none)'}

PROJECT READINESS (strict):
- research_files_ready means ALL are non-empty: Research/lit_review.md, Research/novelty_assessment.md, Research/refined_idea.md
- implementation_files_ready means ALL are non-empty: Design/design_plan.md, Design/dataset.json, Experimentation/experiment.py
- paper_files_ready means Final_Paper/paper.tex is non-empty (metadata optional)

PHASE GATES:
- If research_files_ready is false: do NOT choose implementation or paper primitives.
- If implementation_files_ready is false: do NOT choose paper primitives.
- Generalist agents are for follow-up edits only: do NOT choose a generalist agent if its workflow has never produced any non-empty artifacts.

FOLLOW-UP POLICY:
- For incremental edits, prefer the corresponding generalist agent.
- Rerun a workflow ONLY when the user explicitly requests a reset/regeneration that completly overwrites current files.

RESET CONFIRMATION RULE:
- If the user requests a reset and any of the workflow's target files are currently non-empty, you MUST ask ONE confirmation question and call NO primitive.
- Your confirmation must require the user to reply EXACTLY with:
  CONFIRM OVERWRITE <workflowId>
  where <workflowId> is one of: noveltyRefineWorkflow | planImplementWorkflow | paperPlanWriteWorkflow
- If the user did not provide that exact confirmation string in their latest message, do NOT run the workflow.

${overwriteBlock}

CLARIFY-IDEA RULE:
- If the user’s idea is too vague AND research_workflow_has_run_once is false, ask 2–4 concise clarifying questions and dont call call any primitive. This is allowed only once; after you ask once, assume missing details and proceed on the next turn.
- Otherwise, make reasonable assumptions and proceed with exactly one allowed primitive.

MIXED-INTENT RULE:
- If the user asks for multiple phases at once (e.g., refine my idea and then change the design plan), explicitly say: "I'll start with Research first; after that we can do Implementation later."
- You must still execute at most ONE primitive in this turn.

OUTPUT FORMAT (human-readable; DO NOT output JSON):
Use this structure:


A general summary about your actions.

What happened: <3–6 bullets. If you ran a primitive, summarize its outputs (briefly).>

Files: <list the key files updated/produced, or "None" if no primitive ran>

Next steps: <3–6 bullets, phase-aware (Research → Implementation → Paper)>

Important: Your final response MUST be a complete answer in the above format.
`.trim();
  },
  model: geminiModel,
  // Layer A enforcement (requestContext-only):
  // Dynamically expose ONLY the allowed primitives derived server-side from artifact status.
  agents: ({ requestContext }) => {
    const status = requestContext?.get?.('routerStatus') as RouterStatus | undefined;
    const allowed = new Set(status?.allowedPrimitiveIds ?? []);
    const out: Record<string, any> = {};
    if (allowed.has('researchAgent')) out.researchAgent = researchAgent;
    if (allowed.has('planImplementAgent')) out.planImplementAgent = planImplementAgent;
    if (allowed.has('paperWritingAgent')) out.paperWritingAgent = paperWritingAgent;
    return out;
  },
  workflows: ({ requestContext }) => {
    const status = requestContext?.get?.('routerStatus') as RouterStatus | undefined;
    const allowed = new Set(status?.allowedPrimitiveIds ?? []);
    const out: Record<string, any> = {};
    if (allowed.has('noveltyRefineWorkflow')) out.noveltyRefineWorkflow = noveltyRefineWorkflow;
    if (allowed.has('planImplementWorkflow')) out.planImplementWorkflow = planImplementWorkflow;
    if (allowed.has('paperPlanWriteWorkflow')) out.paperPlanWriteWorkflow = paperPlanWriteWorkflow;
    return out;
  },
  memory: new Memory({
    options: { lastMessages: 20 },
  }),
});


