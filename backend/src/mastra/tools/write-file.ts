import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { inferTextTypeFromPath, normalizeVfsPath, readTextFileByPath, upsertTextFileByPath } from './vfs-utils';

export const writeFileTool = createTool({
  id: 'write_file',
  description:
    "Upsert a text file in the project's virtual filesystem (DB-backed)..",
  inputSchema: z.object({
    path: z.string().min(1).max(500).describe("Project-relative path like 'Lit Review/review.md'"),
    op: z.enum(['append', 'replace']).default('replace').describe("append to the file or replace the file"),
    content: z.string().max(200_000).describe("The content of the file"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    path: z.string(),
    type: z.enum(['txt', 'md', 'py', 'tex', 'csv', 'log']),
    bytesWritten: z.number().int().nonnegative(),
  }),
  execute: async (inputData, toolContext) => {
    const path = normalizeVfsPath(inputData.path);
    const op = inputData.op;
    const content = String(inputData.content ?? '');

    const type = inferTextTypeFromPath(path);

    let finalContent = content;
    if (op === 'append') {
      const existing = await readTextFileByPath({ path }, toolContext);
      if (existing.found) {
        finalContent = (existing.content ?? '') + content;
      }
    }

    await upsertTextFileByPath({ path, type, content: finalContent }, toolContext);

    return {
      ok: true,
      path,
      type,
      bytesWritten: Buffer.byteLength(finalContent, 'utf8'),
    };
  },
});


