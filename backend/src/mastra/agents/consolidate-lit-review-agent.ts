import { Agent } from '@mastra/core/agent';

import { geminiModel } from '../model';

export const consolidateLitReviewAgent = new Agent({
  id: 'consolidate-lit-review-agent',
  name: 'Consolidate Literature Review Agent',
  description:
    'Consolidates many mini literature reviews into a single coherent literature review artifact (markdown).',
  instructions: `
You are a senior research writer. You will receive multiple mini literature reviews and paper metadata.

Task:
- Produce ONE consolidated literature review in markdown format.
- Output MUST be valid JSON and nothing else, with schema:
  { "text": string }
- The "text" value must be the consolidated literature review content.

Rules:
- Do NOT invent papers, methods, datasets, or results.
- Only cite/mention papers that appear in the provided inputs.
- Use clear markdown section headings, e.g.:
  ## Background
  ## Key Themes
  ## Methods Landscape
  ## Datasets / Benchmarks
  ## Limitations in Prior Work
  ## Implications for the User Idea
  ## References
- Keep it concise but complete (~800-1500 words unless told otherwise).
`.trim(),
  model: geminiModel,
});


