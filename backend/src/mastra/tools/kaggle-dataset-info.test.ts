import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { kaggleDatasetInfoTool } from './kaggle-dataset-info';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('kaggleDatasetInfoTool', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = {
      ...originalEnv,
      KAGGLE_USERNAME: 'testuser',
      KAGGLE_KEY: 'testkey123',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('authentication', () => {
    it('returns error when KAGGLE_USERNAME is missing', async () => {
      delete process.env.KAGGLE_USERNAME;

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.exists).toBe(false);
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('KAGGLE_USERNAME');
    });

    it('returns error when KAGGLE_KEY is missing', async () => {
      delete process.env.KAGGLE_KEY;

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.exists).toBe(false);
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('KAGGLE_KEY');
    });
  });

  describe('successful responses', () => {
    it('returns file listing for valid dataset', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          datasetFiles: [
            { name: 'train.csv', totalBytes: 1024 },
            { name: 'test.csv', totalBytes: 512 },
          ],
        }),
      });

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.exists).toBe(true);
      expect(result.accessible).toBe(true);
      expect(result.files).toEqual([
        { name: 'train.csv', size: 1024 },
        { name: 'test.csv', size: 512 },
      ]);
      expect(result.totalSizeBytes).toBe(1536);
      expect(result.dataLayout).toBe('flat');
    });

    it('detects has_subdirs layout when files contain slashes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          datasetFiles: [
            { name: 'train/images/001.png', totalBytes: 1024 },
            { name: 'train/labels.csv', totalBytes: 256 },
            { name: 'test/images/001.png', totalBytes: 1024 },
          ],
        }),
      });

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.exists).toBe(true);
      expect(result.dataLayout).toBe('has_subdirs');
    });

    it('handles empty file list', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          datasetFiles: [],
        }),
      });

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.exists).toBe(true);
      expect(result.accessible).toBe(true);
      expect(result.files).toEqual([]);
      expect(result.dataLayout).toBe('unknown');
    });

    it('handles alternative field names (fileName, size)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          datasetFiles: [
            { fileName: 'data.csv', size: 2048 },
          ],
        }),
      });

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.files).toEqual([
        { name: 'data.csv', size: 2048 },
      ]);
    });
  });

  describe('error responses', () => {
    it('returns exists=false for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not found',
      });

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/nonexistent' }, undefined);

      expect(result.exists).toBe(false);
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns accessible=false for 403 (competition dataset)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/competition-data' }, undefined);

      expect(result.exists).toBe(true);
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('requires competition acceptance');
    });

    it('returns auth error for 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.exists).toBe(false);
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('authentication failed');
    });

    it('handles API error message in response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          errorMessage: 'Dataset has been removed',
        }),
      });

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/removed' }, undefined);

      expect(result.exists).toBe(false);
      expect(result.error).toContain('Dataset has been removed');
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.exists).toBe(false);
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('handles timeout', async () => {
      const abortError = new Error('timeout');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(result.exists).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('input validation', () => {
    it('validates slug format in schema', () => {
      const schema = kaggleDatasetInfoTool.inputSchema;

      // Valid slugs
      expect(schema.safeParse({ slug: 'owner/dataset' }).success).toBe(true);
      expect(schema.safeParse({ slug: 'user123/my-data' }).success).toBe(true);

      // Invalid slugs
      expect(schema.safeParse({ slug: 'nodash' }).success).toBe(false);
      expect(schema.safeParse({ slug: 'too/many/slashes' }).success).toBe(false);
      expect(schema.safeParse({ slug: '' }).success).toBe(false);
    });
  });

  describe('auth header', () => {
    it('sends correct Basic auth header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ datasetFiles: [] }),
      });

      await kaggleDatasetInfoTool.execute({ slug: 'owner/dataset' }, undefined);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/datasets/list/owner/dataset'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        }),
      );
    });
  });
});
