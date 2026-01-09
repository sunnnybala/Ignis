import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { withTimeout } from './tool-utils';

type ExaResult = {
  title?: string;
  url?: string;
  publishedDate?: string;
  summary?: string;
  highlights?: string[];
};

type ExaSearchResponse = {
  results?: ExaResult[];
  nextCursor?: string;
  cursor?: string;
};

function requiredEnv(name: string): string {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const webSearchTool = createTool({
  id: 'web_search',
  description:
    'General web search . Returns results with URL plus Exa-provided highlights and/or a summary (no full page text).',
  inputSchema: z.object({
    query: z.string().min(1).max(500),
    numResults: z.number().int().min(1).max(10).default(10),
    cursor: z.string().optional(),
    includeDomains: z.array(z.string()).optional(),
    excludeDomains: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string().optional(),
        url: z.string().url(),
        publishedDate: z.string().optional(),
        highlights: z.array(z.string()).optional(),
        summary: z.string().optional(),
        source: z.literal('exa'),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  execute: async (inputData, toolContext) => {
    const apiKey = requiredEnv('EXA_API_KEY');

    const timeoutMs = Number(process.env.EXA_TIMEOUT_MS || 15000);
    const signal = withTimeout(toolContext?.abortSignal, Number.isFinite(timeoutMs) ? timeoutMs : 15000);

    // Exa API is POST JSON. For this MVP, explicitly request highlights + summary only.
    const body: Record<string, unknown> = {
      query: inputData.query,
      numResults: inputData.numResults,
      contents: {
        highlights: {
          query: inputData.query,
          numSentences: 2,
          highlightsPerUrl: 3,
        },
        summary: {
          query: inputData.query,
        },
      },
    };
    if (inputData.cursor) body.cursor = inputData.cursor;
    if (inputData.includeDomains?.length) body.includeDomains = inputData.includeDomains;
    if (inputData.excludeDomains?.length) body.excludeDomains = inputData.excludeDomains;

    const resp = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Exa search failed (${resp.status}): ${text || resp.statusText}`);
    }

    const json = (await resp.json()) as ExaSearchResponse;
    const raw = Array.isArray(json.results) ? json.results : [];

    const candidates = raw
      .filter((r) => typeof r.url === 'string' && r.url.trim().length > 0)
      .slice(0, inputData.numResults);

    const results = candidates.map((r) => {
        const url = String(r.url || '').trim();
        const highlights = Array.isArray(r.highlights) ? r.highlights.filter(Boolean).slice(0, 5).map(String) : undefined;
        const summary = typeof r.summary === 'string' && r.summary.trim().length > 0 ? r.summary : undefined;
        return {
          title: typeof r.title === 'string' ? r.title : undefined,
          url,
          publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : undefined,
          highlights: highlights && highlights.length > 0 ? highlights : undefined,
          summary,
          source: 'exa' as const,
        };
      });

    const nextCursor = typeof json.nextCursor === 'string' ? json.nextCursor : typeof json.cursor === 'string' ? json.cursor : null;

    return { results, nextCursor };
  },
});


