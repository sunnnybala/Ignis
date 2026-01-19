import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { withTimeout } from './tool-utils';

const KAGGLE_API_BASE = 'https://www.kaggle.com/api/v1';

type KaggleFileInfo = {
  name: string;
  size: number;
  creationDate?: string;
};

type KaggleDatasetFilesResponse = {
  datasetFiles?: Array<{
    name?: string;
    fileName?: string;
    totalBytes?: number;
    size?: number;
    creationDate?: string;
  }>;
  errorMessage?: string;
};

function getKaggleAuth(): { username: string; key: string } | null {
  const username = (process.env.KAGGLE_USERNAME || '').trim();
  const key = (process.env.KAGGLE_KEY || '').trim();
  if (!username || !key) return null;
  return { username, key };
}

export const kaggleDatasetInfoTool = createTool({
  id: 'kaggle_dataset_info',
  description:
    'Validates a Kaggle dataset slug and returns its file listing. ' +
    'Call this AFTER finding a dataset via web_search to verify it exists and is accessible. ' +
    'Returns exists=false if dataset not found, accessible=false if it requires competition acceptance. ' +
    'Output: { exists: boolean, accessible: boolean, error?: string, files?: Array<{name, size}>, totalSizeBytes?: number, dataLayout?: "flat"|"has_subdirs"|"unknown" }',
  inputSchema: z.object({
    slug: z
      .string()
      .regex(/^[^/]+\/[^/]+$/, 'Must be owner/dataset format (e.g. "username/dataset-name")'),
  }),
  execute: async (input, toolContext) => {
    const { slug } = input;
    const [owner, dataset] = slug.split('/');

    const auth = getKaggleAuth();
    if (!auth) {
      return {
        exists: false,
        accessible: false,
        error: 'KAGGLE_USERNAME or KAGGLE_KEY not configured in backend environment',
      };
    }

    const authHeader = 'Basic ' + Buffer.from(`${auth.username}:${auth.key}`).toString('base64');
    const timeoutMs = 15000;
    const signal = withTimeout(toolContext?.abortSignal, timeoutMs);

    try {
      // Kaggle API endpoint to list dataset files
      // This endpoint returns file metadata without downloading
      const filesUrl = `${KAGGLE_API_BASE}/datasets/list/${owner}/${dataset}`;

      const resp = await fetch(filesUrl, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
        signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');

        if (resp.status === 404) {
          return {
            exists: false,
            accessible: false,
            error: `Dataset not found: ${slug}`,
          };
        }

        if (resp.status === 403) {
          return {
            exists: true,
            accessible: false,
            error: `Dataset requires competition acceptance or is private: ${slug}`,
          };
        }

        if (resp.status === 401) {
          return {
            exists: false,
            accessible: false,
            error: 'Kaggle authentication failed - check KAGGLE_USERNAME and KAGGLE_KEY',
          };
        }

        return {
          exists: false,
          accessible: false,
          error: `Kaggle API error (${resp.status}): ${text.slice(0, 200) || resp.statusText}`,
        };
      }

      const data = (await resp.json()) as KaggleDatasetFilesResponse;

      if (data.errorMessage) {
        return {
          exists: false,
          accessible: false,
          error: `Kaggle API error: ${data.errorMessage}`,
        };
      }

      const rawFiles = Array.isArray(data.datasetFiles) ? data.datasetFiles : [];

      const files: KaggleFileInfo[] = rawFiles
        .map((f) => ({
          name: String(f.name || f.fileName || '').trim(),
          size: Number(f.totalBytes || f.size || 0),
        }))
        .filter((f) => f.name.length > 0);

      const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);

      // Detect layout pattern based on file paths
      const hasSubdirs = files.some((f) => f.name.includes('/'));
      const dataLayout: 'flat' | 'has_subdirs' | 'unknown' =
        files.length === 0 ? 'unknown' : hasSubdirs ? 'has_subdirs' : 'flat';

      return {
        exists: true,
        accessible: true,
        files,
        totalSizeBytes,
        dataLayout,
      };
    } catch (err: unknown) {
      const error = err as Error;

      if (error?.name === 'AbortError' || error?.message === 'timeout') {
        return {
          exists: false,
          accessible: false,
          error: 'Request timed out while contacting Kaggle API',
        };
      }

      return {
        exists: false,
        accessible: false,
        error: `Request failed: ${error?.message || String(err)}`,
      };
    }
  },
});
