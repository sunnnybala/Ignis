import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { withTimeout } from './tool-utils';
import { logger } from '../../utils/logger';

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

type ExaPaperResult = {
  title?: string;
  url?: string;
  publishedDate?: string;
  author?: string;
  summary?: string;
};
type ExaPaperSearchResponse = {
  results?: ExaPaperResult[];
  nextCursor?: string;
  cursor?: string;
};

function optionalEnv(name: string): string | null {
  const v = String(process.env[name] || '').trim();
  return v || null;
}

function toOffsetCursor(cursor?: string): number {
  // We support opaque cursors for other providers (e.g. "exa:<token>").
  // If cursor doesn't look like a numeric offset, treat it as "no cursor" for Semantic Scholar.
  if (cursor && cursor.startsWith('exa:')) return 0;
  const n = cursor ? parseInt(cursor, 10) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function exaCursorFromCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  if (!cursor.startsWith('exa:')) return undefined;
  const token = cursor.slice('exa:'.length).trim();
  return token ? token : undefined;
}

export const searchPapersTool = createTool({
  id: 'search_papers',
  description:
    'Search scholarly papers (Semantic Scholar with Exa fallback). Returns normalized results (title/authors/year/venue/abstract/url/doi) and an optional nextCursor.',
  inputSchema: z.object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(10).default(10),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor. For Semantic Scholar it's a numeric offset string; for Exa it is opaque and prefixed as 'exa:<token>'."),
  }),
  outputSchema: z.object({
    ok: z.boolean().describe('Whether the tool call succeeded. If false, results will be empty and error will be set.'),
    errorMessage: z.string().optional().describe('Error message if ok=false'),
    results: z.array(
      z.object({
        title: z.string(),
        authors: z.array(z.string()).default([]),
        year: z.number().int().optional(),
        venue: z.string().optional(),
        abstract: z.string().optional(),
        url: z.string().url().optional(),
        doi: z.string().optional(),
        source: z.enum(['semantic_scholar', 'exa']),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  execute: async (inputData, toolContext) => {
    const limit = inputData.limit;

    // -------------------------
    // Primary: Semantic Scholar
    // -------------------------
    const offset = toOffsetCursor(inputData.cursor);
    const fields = ['title', 'authors', 'year', 'venue', 'abstract', 'url', 'externalIds'].join(',');
    const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
    url.searchParams.set('query', inputData.query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('fields', fields);

    const s2Headers: Record<string, string> = {};
    const s2ApiKey = optionalEnv('SEMANTIC_SCHOLAR_API_KEY');
    if (s2ApiKey) s2Headers['x-api-key'] = s2ApiKey;

    const s2TimeoutMs = Number(process.env.SEMANTIC_SCHOLAR_TIMEOUT_MS || 15000);
    const s2Signal = withTimeout(toolContext?.abortSignal, Number.isFinite(s2TimeoutMs) ? s2TimeoutMs : 15000);

    try {
      const resp = await fetch(url.toString(), { method: 'GET', headers: s2Headers, signal: s2Signal });
      if (resp.ok) {
        const json = (await resp.json()) as S2SearchResponse;
        const jsonSafe = json ?? {};
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
          typeof jsonSafe.next === 'number' && Number.isFinite(jsonSafe.next)
            ? String(Math.max(0, Math.trunc(jsonSafe.next)))
            : typeof jsonSafe.total === 'number' && Number.isFinite(jsonSafe.total) && offset + limit < jsonSafe.total
              ? String(offset + limit)
              : null;

        return { ok: true, results, nextCursor: next };
      }

      // Semantic Scholar error -> fall back to Exa
      const text = await resp.text().catch(() => '');
      const s2Err = `Semantic Scholar search failed (${resp.status}): ${text || resp.statusText}`;
      logger.warn('tool.search_papers.semantic_scholar_failed', {
        status: resp.status,
        query: inputData.query,
        offset,
        limit,
        hasApiKey: Boolean(s2ApiKey),
        message: s2Err,
      });

      return await searchExaFallback(inputData, toolContext, s2Err);
    } catch (err: unknown) {
      const s2Err = err instanceof Error ? err.message : String(err);
      logger.warn('tool.search_papers.semantic_scholar_failed', {
        query: inputData.query,
        offset,
        limit,
        hasApiKey: Boolean(s2ApiKey),
        message: s2Err,
      });
      return await searchExaFallback(inputData, toolContext, s2Err);
    }
  },
});

async function searchExaFallback(
  inputData: { query: string; limit: number; cursor?: string },
  toolContext: any,
  semanticScholarError: string,
) {
  const apiKey = optionalEnv('EXA_API_KEY');
  if (!apiKey) {
    return {
      ok: false as const,
      errorMessage: `${semanticScholarError} (and EXA_API_KEY is not set for fallback)`,
      results: [],
      nextCursor: null,
    };
  }

  const timeoutMs = Number(process.env.EXA_TIMEOUT_MS || 15000);
  const signal = withTimeout(toolContext?.abortSignal, Number.isFinite(timeoutMs) ? timeoutMs : 15000);

  // Custom LLM summary prompt for novelty judgment (basic summary + methodology + implementation details).
  // This is used as `abstract` in our normalized output.
  const summaryQuery = [
    'Summarize this research paper.',
    'Include:',
    '1) Problem + main contribution',
    '2) Methodology/approach (key ideas, model/algorithm)',
    '3) Implementation details (datasets, training/eval setup, key hyperparams if mentioned)',
    '4) Key results/findings (metrics + baselines if stated)',
    'Keep it concise but information-dense.',
  ].join('\n');

  const body: Record<string, unknown> = {
    query: inputData.query,
    type: 'auto',
    category: 'research paper',
    numResults: inputData.limit,
    contents: {
      summary: {
        query: summaryQuery,
      },
    },
  };

  const exaCursor = exaCursorFromCursor(inputData.cursor);
  if (exaCursor) body.cursor = exaCursor;

  try {
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
      const exaErr = `Exa search failed (${resp.status}): ${text || resp.statusText}`;
      logger.warn('tool.search_papers.exa_fallback_failed', { message: exaErr, query: inputData.query });
      return { ok: false as const, errorMessage: `${semanticScholarError} | ${exaErr}`, results: [], nextCursor: null };
    }

    const json = (await resp.json()) as ExaPaperSearchResponse;
    const raw = Array.isArray(json.results) ? json.results : [];
    const candidates = raw
      .filter((r) => typeof r.title === 'string' && r.title.trim().length > 0)
      .slice(0, inputData.limit);

    const results = candidates.map((r) => {
      const title = typeof r.title === 'string' ? r.title.trim() : '';
      const url = typeof r.url === 'string' && r.url.trim() ? r.url.trim() : undefined;
      const author = typeof r.author === 'string' && r.author.trim() ? r.author.trim() : '';
      const publishedDate = typeof r.publishedDate === 'string' ? r.publishedDate : '';
      const yearMaybe = publishedDate ? new Date(publishedDate).getUTCFullYear() : NaN;
      const year = Number.isFinite(yearMaybe) ? yearMaybe : undefined;
      const summary = typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim() : undefined;
      return {
        title,
        authors: author ? [author] : [],
        year,
        venue: undefined,
        abstract: summary,
        url,
        doi: undefined,
        source: 'exa' as const,
      };
    });

    const nextCursorRaw =
      typeof json.nextCursor === 'string' ? json.nextCursor : typeof json.cursor === 'string' ? json.cursor : null;
    const nextCursor = nextCursorRaw ? `exa:${nextCursorRaw}` : null;

    return { ok: true as const, results, nextCursor };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('tool.search_papers.exa_fallback_failed', { message: msg, query: inputData.query });
    return { ok: false as const, errorMessage: `${semanticScholarError} | Exa fallback error: ${msg}`, results: [], nextCursor: null };
  }
}


