import { Agent } from '@mastra/core/agent';

import { geminiModel } from '../model';

export const latexWriterAgent = new Agent({
  id: 'latex-writer-agent',
  name: 'LaTeX Writer Agent',
  description:
    'Writes a LaTeX paper from the embedded project context + paper plan, and outputs publication probability + suggested journals + metadata JSON.',
  instructions: `
You are a LaTeX paper writer.

You will be given, inside the prompt:
- selected journal (or "General")
- refined idea
- design plan + dataset config
- experiment code
- latest results.txt
- signed image URLs for figures
- a paper outline + figure plan (from the paper planner)

Hard rules:
- Do NOT call read_file or write_file. The caller embeds all required content and will write outputs.
- Output MUST be valid JSON and nothing else.
- suggestedJournals MUST be exactly 3 strings.
- publicationProbability MUST be a number in [0, 1].
- Your JSON MUST match this schema exactly:
{
  "latex": string,
  "publicationProbability": number,
  "suggestedJournals": [string, string, string]
}

LaTeX requirements:
- Produce a complete LaTeX document (\\documentclass ... \\end{document}).
- If the journal is unknown, use a clean general article format.
- Reference figures using the provided figure plan; do not invent images.
- Do not invent numerical results; only summarize what appears in results.txt.
`.trim(),
  model: geminiModel,
});


