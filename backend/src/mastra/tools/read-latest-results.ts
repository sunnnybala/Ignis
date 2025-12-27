import { and, eq, sql } from 'drizzle-orm';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { db } from '../../db/client';
import { files } from '../../db/schema';
import { getOwnedProject } from '../../authz/ownership';

function getRuntimeIds(toolContext?: any): { userId: string; projectId: string } {
  // Matches the rest of this repo: tools run with RequestContext (not RuntimeContext).
  const requestContext = toolContext?.requestContext;
  const userId = String(requestContext?.get?.('userId') ?? toolContext?.runtimeContext?.get?.('userId') ?? '').trim();
  const projectId = String(requestContext?.get?.('projectId') ?? toolContext?.runtimeContext?.get?.('projectId') ?? '').trim();
  if (!userId || !projectId) throw new Error('Missing requestContext userId/projectId');
  return { userId, projectId };
}

function extractTimestamp(path: string): string | null {
  // Expected: Results/<job_timestamp>/results.txt
  const m = /^Results\/([^/]+)\/results\.txt$/i.exec(path);
  return m?.[1] ?? null;
}

function compareTimestamps(a: string, b: string): number {
  const aDigits = /^\d+$/.test(a);
  const bDigits = /^\d+$/.test(b);
  if (aDigits && bDigits) {
    try {
      const ai = BigInt(a);
      const bi = BigInt(b);
      return ai === bi ? 0 : ai > bi ? 1 : -1;
    } catch {
      // fall through to string compare
    }
  }
  // Fallback: lexicographic compare (works for sortable formats like YYYYMMDDHHmmss).
  return a === b ? 0 : a > b ? 1 : -1;
}

export const readLatestResultsTool = createTool({
  id: 'read_latest_results',
  description:
    "Read the newest Results/<job_timestamp>/results.txt from the project's VFS (DB-backed). Picks the greatest <job_timestamp>.",
  inputSchema: z.object({
    maxChars: z.number().int().min(1).max(200_000).default(200_000).optional(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    path: z.string().optional(),
    timestamp: z.string().optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
  }),
  execute: async (inputData, toolContext) => {
    const { userId, projectId } = getRuntimeIds(toolContext);
    const owned = await getOwnedProject(projectId, userId);
    if (!owned) throw new Error('Project not found');

    const rows = await db
      .select({
        path: files.path,
        type: files.type,
        content: files.content,
        storageKey: files.storageKey,
      })
      .from(files)
      .where(and(eq(files.projectId, projectId), sql`${files.path} ILIKE 'Results/%/results.txt'`));

    const candidates = rows
      .map((r) => {
        const ts = extractTimestamp(String(r.path));
        return { ...r, ts };
      })
      .filter((r) => !!r.ts)
      // Only support text-like results stored inline.
      .filter((r) => !r.storageKey)
      .filter((r) => String(r.type) === 'txt' || String(r.type) === 'log' || String(r.type) === 'md');

    if (candidates.length === 0) return { found: false };

    let best = candidates[0]!;
    for (const c of candidates.slice(1)) {
      const cmp = compareTimestamps(String(c.ts), String(best.ts));
      if (cmp > 0) best = c;
    }

    const maxChars = typeof inputData?.maxChars === 'number' ? inputData.maxChars : 200_000;
    let content = String(best.content ?? '');
    let truncated = false;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
      truncated = true;
    }

    return {
      found: true,
      path: String(best.path),
      timestamp: String(best.ts),
      content,
      ...(truncated ? { truncated: true } : {}),
    };
  },
});


