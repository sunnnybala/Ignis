import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

type S2Author = { name?: string };
type S2Paper = {
  title?: string;
  abstract?: string;
  year?: number;
  venue?: string;
  authors?: S2Author[];
  url?: string;
  externalIds?: { DOI?: string; doi?: string };
};
type S2SearchResponse = {
  data?: S2Paper[];
  total?: number;
  offset?: number;
  next?: number;
};

function optionalEnv(name: string): string | null {
  const v = String(process.env[name] || '').trim();
  return v || null;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), ms);
  const cleanup = () => clearTimeout(timeout);

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  controller.signal.addEventListener('abort', cleanup, { once: true });
  return controller.signal;
}

function toOffsetCursor(cursor?: string): number {
  const n = cursor ? parseInt(cursor, 10) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export const searchPapersTool = createTool({
  id: 'search_papers',
  description:
    'Search scholarly papers (MVP: Semantic Scholar). Returns normalized results (title/authors/year/venue/abstract/url/doi) and an optional nextCursor.',
  inputSchema: z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(10).default(10),
    cursor: z.string().optional().describe('Pagination cursor (MVP: numeric offset as string)'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        title: z.string(),
        authors: z.array(z.string()).default([]),
        year: z.number().int().optional(),
        venue: z.string().optional(),
        abstract: z.string().optional(),
        url: z.string().url().optional(),
        doi: z.string().optional(),
        source: z.literal('semantic_scholar'),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  execute: async (inputData, toolContext) => {
    const offset = toOffsetCursor(inputData.cursor);
    const limit = inputData.limit;

    const fields = ['title', 'authors', 'year', 'venue', 'abstract', 'url', 'externalIds'].join(',');
    const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
    url.searchParams.set('query', inputData.query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('fields', fields);

    const headers: Record<string, string> = {};
    const apiKey = optionalEnv('SEMANTIC_SCHOLAR_API_KEY');
    if (apiKey) headers['x-api-key'] = apiKey;

    const timeoutMs = Number(process.env.SEMANTIC_SCHOLAR_TIMEOUT_MS || 15000);
    const signal = withTimeout(toolContext?.abortSignal, Number.isFinite(timeoutMs) ? timeoutMs : 15000);

    const resp = await fetch(url.toString(), { method: 'GET', headers, signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Semantic Scholar search failed (${resp.status}): ${text || resp.statusText}`);
    }

    const json = (await resp.json()) as S2SearchResponse;
    const raw = Array.isArray(json.data) ? json.data : [];

    const candidates = raw
      .filter((p) => typeof p.title === 'string' && p.title.trim().length > 0)
      .slice(0, limit);

    const results = candidates.map((p) => {
        const title = typeof p.title === 'string' ? p.title.trim() : '';
        const authors = Array.isArray(p.authors)
          ? p.authors
              .map((a) => (typeof a?.name === 'string' ? a.name.trim() : ''))
              .filter((s) => s.length > 0)
          : [];
        const doiRaw = (p.externalIds?.DOI || p.externalIds?.doi || '').trim();
        return {
          title,
          authors,
          year: typeof p.year === 'number' && Number.isFinite(p.year) ? Math.trunc(p.year) : undefined,
          venue: typeof p.venue === 'string' && p.venue.trim() ? p.venue.trim() : undefined,
          abstract: typeof p.abstract === 'string' && p.abstract.trim() ? p.abstract.trim() : undefined,
          url: typeof p.url === 'string' && p.url.trim() ? p.url.trim() : undefined,
          doi: doiRaw ? doiRaw : undefined,
          source: 'semantic_scholar' as const,
        };
      });

    // Normalize nextCursor:
    // - Prefer explicit `next` if present
    // - Else compute from total/offset/limit if total is present
    const next =
      typeof json.next === 'number' && Number.isFinite(json.next)
        ? String(Math.max(0, Math.trunc(json.next)))
        : typeof json.total === 'number' && Number.isFinite(json.total) && offset + limit < json.total
          ? String(offset + limit)
          : null;

    return { results, nextCursor: next };
  },
});


