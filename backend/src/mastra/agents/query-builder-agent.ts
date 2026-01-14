import { Agent } from '@mastra/core/agent';

import { geminiModel } from '../model';

export const queryBuilderAgent = new Agent({
  id: 'query-builder-agent',
  name: 'Query Builder Agent',
  description:
    "Turns the user's research idea + conversation context into a high-quality academic paper search query.",
  instructions: `
You generate a single search query string for scholarly paper search (e.g., Semantic Scholar).

You will be called with the user's idea (and potentially additional context from conversation history via memory).

Rules:
- Output MUST be valid JSON and nothing else.
- Output schema:
  {
    "query": string
  }
- The query should be concise but expressive: include key terms, common synonyms, and the core task/domain.
- Avoid overly long queries; prefer 8-20 meaningful terms.
- Do NOT include explanations, markdown, or extra keys.
- Do NOT fabricate citations or paper titles.

Examples (format only):
{"query":"chest x-ray pneumonia detection self-supervised learning domain adaptation label noise robust training"}
{"query":"diffusion models medical imaging segmentation uncertainty calibration active learning"}
`.trim(),
  model: geminiModel,
});


