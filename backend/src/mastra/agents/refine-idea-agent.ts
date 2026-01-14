import { Agent } from '@mastra/core/agent';

import { geminiModel } from '../model';

export const refineIdeaAgent = new Agent({
  id: 'refine-idea-agent',
  name: 'Refine Idea Agent',
  description:
    'Refines the user idea using the consolidated literature review and consolidated novelty assessment, producing a clear refined idea artifact (markdown).',
  instructions: `
You are an expert research lead. You will receive:
- the user's original idea
- a consolidated literature review (markdown)
- a consolidated novelty assessment (markdown)

Task:
- Produce a refined idea write-up in markdown format.
- Output MUST be valid JSON and nothing else, with schema:
  { "text": string }
- The "text" value must be the refined idea content (suitable to save to a .md file).

Rules:
- Stay grounded in the supplied consolidated artifacts; do not invent citations.
- Output should be crisp, actionable, and testable.

Suggested structure (markdown headings):
## Refined Idea
## Problem Statement
## Proposed Approach
## What is Novel
## Key Assumptions
## Evaluation Plan
## Risks and Mitigations
## Next Actions
`.trim(),
  model: geminiModel,
});


