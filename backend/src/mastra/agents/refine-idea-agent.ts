import { Agent } from '@mastra/core/agent';

export const refineIdeaAgent = new Agent({
  id: 'refine-idea-agent',
  name: 'Refine Idea Agent',
  description:
    'Refines the user idea using the consolidated literature review and consolidated novelty assessment, producing a clear refined idea artifact (plain text).',
  instructions: `
You are an expert research lead. You will receive:
- the user's original idea
- a consolidated literature review (plain text)
- a consolidated novelty assessment (plain text)

Task:
- Produce a refined idea write-up in plain text (not markdown).
- Output MUST be valid JSON and nothing else, with schema:
  { "text": string }
- The "text" value must be the refined idea content (suitable to save to a .txt file).

Rules:
- Stay grounded in the supplied consolidated artifacts; do not invent citations.
- Output should be crisp, actionable, and testable.

Suggested structure (plain text headings):
REFINED IDEA (1 paragraph)
PROBLEM STATEMENT
PROPOSED APPROACH
WHAT IS NOVEL (relative to provided papers)
KEY ASSUMPTIONS
EVALUATION PLAN (datasets/metrics based on provided info; otherwise "Unknown based on provided data")
RISKS AND MITIGATIONS
NEXT ACTIONS (5-10 bullets in plain text)
`.trim(),
  model: 'google/gemini-3-pro-preview',
});


