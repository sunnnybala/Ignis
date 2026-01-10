import { and, eq, sql } from 'drizzle-orm';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { db } from '../../db/client';
import { files } from '../../db/schema';
import { getOwnedProject } from '../../authz/ownership';
import { getSignedUrl } from '../../storage/supabaseAdapter';
import { getRuntimeIds, compareVersionStrings, isSupportedImagePath } from './tool-utils';
import { clampInt } from '../../utils/numbers';

function extractRunId(path: string): string | null {
  // Supports:
  // - Results/<runId>/results.txt
  // - Results/<runId>/<imageFile>
  const m = /^Results\/([^/]+)\//i.exec(path);
  return m?.[1] ?? null;
}

function getImageUrlExpiresFromEnv(): number {
  // Default: 7 days. Cap at 30 days to avoid absurd values.
  const raw = String(process.env.LATEST_RESULT_IMAGE_URL_EXPIRES_SEC ?? '').trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const fallback = 60 * 60 * 24 * 7; // 7 days
  return clampInt(Number.isFinite(parsed) ? parsed : fallback, 60, 60 * 60 * 24 * 30);
}

export const getLatestResultImagesTool = createTool({
  id: 'get_latest_result_images',
  description:
    "Return signed URLs for image artifacts under the latest Results/<job_timestamp>/ directory (based on greatest <job_timestamp>).",
  inputSchema: z.object({
    maxCount: z.number().int().min(0).max(50).default(20).describe('Max number of images to return.'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    runId: z.string().optional().describe('The selected Results/<runId>/ directory name'),
    images: z
      .array(
        z.object({
          path: z.string(),
          signedUrl: z.string().url(),
          mimeType: z.string().optional(),
        }),
      )
      .default([]),
  }),
  execute: async (inputData, toolContext) => {
    const { userId, projectId } = getRuntimeIds(toolContext);
    const owned = await getOwnedProject(projectId, userId);
    if (!owned) throw new Error('Project not found');

    const expiresInSec = getImageUrlExpiresFromEnv();
    const maxCount = clampInt(inputData.maxCount, 0, 50);
    if (maxCount === 0) return { found: false, images: [] };

    // Determine latest runId based on presence of Results/<runId>/results.txt
    const resultsRows = await db
      .select({ path: files.path })
      .from(files)
      .where(and(eq(files.projectId, projectId), sql`${files.path} ILIKE 'Results/%/results.txt'`));

    const runIds = resultsRows
      .map((r) => extractRunId(String(r.path)))
      .filter((v): v is string => !!v);

    if (runIds.length === 0) return { found: false, images: [] };

    let best = runIds[0]!;
    for (const id of runIds.slice(1)) {
      if (compareVersionStrings(id, best) > 0) best = id;
    }

    // Fetch image artifacts within Results/<best>/
    const imgRows = await db
      .select({
        path: files.path,
        storageKey: files.storageKey,
        mimeType: files.mimeType,
        type: files.type,
      })
      .from(files)
      .where(
        and(
          eq(files.projectId, projectId),
          eq(files.type, 'img' as any),
          sql`${files.path} ILIKE ${`Results/${best}/%`}`,
        ),
      );

    const candidates = imgRows
      .filter((r) => !!r.storageKey)
      .filter((r) => isSupportedImagePath(String(r.path)))
      .sort((a, b) => String(a.path).localeCompare(String(b.path)))
      .slice(0, maxCount);

    const images: Array<{ path: string; signedUrl: string; mimeType?: string }> = [];
    for (const row of candidates) {
      const key = String(row.storageKey ?? '').trim();
      if (!key) continue;
      try {
        const signedUrl = await getSignedUrl(key, expiresInSec);
        images.push({
          path: String(row.path),
          signedUrl,
          mimeType: typeof row.mimeType === 'string' && row.mimeType.trim() ? row.mimeType : undefined,
        });
      } catch {
        // Skip signing failures; keep tool resilient.
      }
    }

    return { found: true, runId: best, images };
  },
});


