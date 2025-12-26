import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { normalizeVfsPath, readTextFileByPath } from './vfs-utils';

export const readFileTool = createTool({
  id: 'read_file',
  description:
    "Read a text file from the project's virtual filesystem (DB-backed).",
  inputSchema: z.object({
    path: z.string().min(1).max(500).describe("Project-relative path like 'Lit Review/review.md'")
  }),
  outputSchema: z.object({
    found: z.boolean(),
    path: z.string(),
    type: z.enum(['txt', 'md', 'py', 'tex', 'csv', 'log']).optional(),
    content: z.string().optional(),
    truncated: z.boolean().optional(),
  }),
  execute: async (inputData, toolContext) => {
    const path = normalizeVfsPath(inputData.path);
    const maxChars = 200000

    const res = await readTextFileByPath({ path }, toolContext);
    if (!res.found) {
      return { found: false, path };
    }

    let content = res.content;
    let truncated = false;
    if (typeof maxChars === 'number' && Number.isFinite(maxChars) && maxChars > 0 && content.length > maxChars) {
      content = content.slice(0, maxChars);
      truncated = true;
    }

    return {
      found: true,
      path,
      type: res.type,
      content,
      ...(truncated ? { truncated: true } : {}),
    };
  },
});


