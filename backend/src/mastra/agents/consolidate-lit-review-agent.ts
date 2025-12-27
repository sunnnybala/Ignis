import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

export const consolidateLitReviewAgent = new Agent({
  id: 'consolidate-lit-review-agent',
  name: 'Consolidate Literature Review Agent',
  description:
    'Consolidates many mini literature reviews into a single coherent literature review artifact (plain text).',
  instructions: `
You are a senior research writer. You will receive multiple mini literature reviews and paper metadata.

Task:
- Produce ONE consolidated literature review in plain text (not markdown).
- Output MUST be valid JSON and nothing else, with schema:
  { "text": string }
- The "text" value must be the consolidated literature review content.

Rules:
- Do NOT invent papers, methods, datasets, or results.
- Only cite/mention papers that appear in the provided inputs.
- Use clear section headings in plain text, e.g.:
  "BACKGROUND"
  "KEY THEMES"
  "METHODS LANDSCAPE"
  "DATASETS / BENCHMARKS"
  "LIMITATIONS IN PRIOR WORK"
  "IMPLICATIONS FOR THE USER IDEA"
  "REFERENCES (from provided list)"
- Keep it concise but complete (~800-1500 words unless told otherwise).
`.trim(),
  model: 'google/gemini-3-pro-preview',
  memory: new Memory(),
});


