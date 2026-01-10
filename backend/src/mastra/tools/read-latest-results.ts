import { and, eq, sql } from 'drizzle-orm';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { db } from '../../db/client';
import { files } from '../../db/schema';
import { getOwnedProject } from '../../authz/ownership';
import { getRuntimeIds, compareVersionStrings } from './tool-utils';

function extractTimestamp(path: string): string | null {
  // Expected: Results/<job_timestamp>/results.txt
  const m = /^Results\/([^/]+)\/results\.txt$/i.exec(path);
  return m?.[1] ?? null;
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
      const cmp = compareVersionStrings(String(c.ts), String(best.ts));
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


