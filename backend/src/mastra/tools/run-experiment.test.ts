import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to create the mock function before vi.mock hoisting
const mockFetch = vi.hoisted(() => vi.fn());

// Mock logger to suppress output during tests
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock undici fetch
vi.mock('undici', () => ({
  fetch: mockFetch,
}));

// Now import after mocks are set up
import { runExperimentTool, classifyError, generateSuggestion } from './run-experiment';

// Store the original env
const originalEnv = { ...process.env };

describe('run-experiment tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set the env var before each test (read at runtime now)
    process.env.MODAL_RUNNER_SYNC_URL = 'https://test-modal-runner.modal.run';
  });

  afterEach(() => {
    // Restore env after each test
    process.env = { ...originalEnv };
  });

  describe('classifyError', () => {
    it('returns none for successful execution', () => {
      const result = classifyError('', 'Success!', 0);
      expect(result.type).toBe('none');
      expect(result.retryable).toBe(false);
    });

    it('classifies ModuleNotFoundError as import_error', () => {
      const stderr = "ModuleNotFoundError: No module named 'pandas'";
      const result = classifyError(stderr, '', 1);
      expect(result.type).toBe('import_error');
      expect(result.retryable).toBe(true);
    });

    it('classifies FileNotFoundError as file_not_found', () => {
      const stderr = "FileNotFoundError: [Errno 2] No such file or directory: 'train.csv'";
      const result = classifyError(stderr, '', 1);
      expect(result.type).toBe('file_not_found');
      expect(result.retryable).toBe(true);
    });

    it('classifies OOM errors as memory_error', () => {
      const stderr = 'RuntimeError: CUDA out of memory';
      const result = classifyError(stderr, '', 1);
      expect(result.type).toBe('memory_error');
      expect(result.retryable).toBe(true);
    });

    it('classifies timeout errors', () => {
      const stderr = 'Process timed out after 30 minutes';
      const result = classifyError(stderr, '', 1);
      expect(result.type).toBe('timeout');
      expect(result.retryable).toBe(true);
    });

    it('classifies kaggle download errors as non-retryable', () => {
      const stderr = 'Error: Kaggle dataset download failed: 404';
      const result = classifyError(stderr, '', 1);
      expect(result.type).toBe('dataset_download');
      expect(result.retryable).toBe(false);
    });

    it('defaults to runtime_error for unknown errors', () => {
      const stderr = 'SomeRandomError: unexpected thing happened';
      const result = classifyError(stderr, '', 1);
      expect(result.type).toBe('runtime_error');
      expect(result.retryable).toBe(true);
    });
  });

  describe('generateSuggestion', () => {
    it('suggests adding missing package for import errors', () => {
      const suggestion = generateSuggestion(
        { type: 'import_error', retryable: true },
        "ModuleNotFoundError: No module named 'sklearn'"
      );
      expect(suggestion).toContain('sklearn');
      expect(suggestion).toContain('requirements.txt');
    });

    it('suggests checking file paths for file_not_found', () => {
      const suggestion = generateSuggestion(
        { type: 'file_not_found', retryable: true },
        'FileNotFoundError: train.csv'
      );
      expect(suggestion).toContain('VERIFIED DATASET FILES');
      expect(suggestion).toContain('os.listdir');
    });

    it('suggests reducing batch size for memory errors', () => {
      const suggestion = generateSuggestion(
        { type: 'memory_error', retryable: true },
        'CUDA out of memory'
      );
      expect(suggestion).toContain('batch_size');
    });

    it('suggests reducing epochs for timeout', () => {
      const suggestion = generateSuggestion({ type: 'timeout', retryable: true }, 'timed out');
      expect(suggestion).toContain('epochs');
    });

    it('returns undefined for non-retryable errors', () => {
      const suggestion = generateSuggestion({ type: 'dataset_download', retryable: false }, 'error');
      expect(suggestion).toBeUndefined();
    });
  });

  describe('runExperimentTool.execute', () => {
    const validInput = {
      experimentPy: 'print("hello")',
      requirementsTxt: 'numpy',
      datasetSlug: 'owner/dataset',
    };

    it('returns error when MODAL_RUNNER_SYNC_URL is not configured', async () => {
      delete process.env.MODAL_RUNNER_SYNC_URL;

      const result = await runExperimentTool.execute(validInput, { requestContext: undefined } as any);

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('MODAL_RUNNER_SYNC_URL not configured');
      expect(result.retryable).toBe(false);
    });

    it('returns success result when Modal returns exitCode 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          exitCode: 0,
          stdout: 'Experiment completed successfully!',
          stderr: '',
          artifacts: [{ name: 'results.csv', type: 'csv' }],
        }),
      } as any);

      const result = await runExperimentTool.execute(validInput, { requestContext: undefined } as any);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.errorType).toBe('none');
      expect(result.retryable).toBe(false);
      expect(result.artifacts).toEqual([{ name: 'results.csv', type: 'csv' }]);
    });

    it('classifies errors and suggests fixes for failed execution', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          exitCode: 1,
          stdout: '',
          stderr: "ModuleNotFoundError: No module named 'torch'",
          artifacts: [],
        }),
      } as any);

      const result = await runExperimentTool.execute(validInput, { requestContext: undefined } as any);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.errorType).toBe('import_error');
      expect(result.retryable).toBe(true);
      expect(result.suggestion).toContain('torch');
    });

    it('handles Modal HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as any);

      const result = await runExperimentTool.execute(validInput, { requestContext: undefined } as any);

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('HTTP 500');
      expect(result.retryable).toBe(false);
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await runExperimentTool.execute(validInput, { requestContext: undefined } as any);

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Connection refused');
      expect(result.retryable).toBe(false);
    });

    it('sends correct payload to Modal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ exitCode: 0, stdout: '', stderr: '', artifacts: [] }),
      } as any);

      await runExperimentTool.execute(
        {
          experimentPy: 'code here',
          requirementsTxt: 'numpy\npandas',
          datasetSlug: 'test/data',
          datasetSubdir: 'train',
        },
        { requestContext: undefined } as any
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-modal-runner.modal.run',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse((call[1] as any).body);
      expect(body.experimentPy).toBe('code here');
      expect(body.requirementsTxt).toBe('numpy\npandas');
      expect(body.datasetJson).toContain('test/data');
      expect(body.datasetJson).toContain('train');
    });

    it('truncates long stdout/stderr', async () => {
      const longOutput = 'x'.repeat(100000);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          exitCode: 0,
          stdout: longOutput,
          stderr: longOutput,
          artifacts: [],
        }),
      } as any);

      const result = await runExperimentTool.execute(validInput, { requestContext: undefined } as any);

      expect(result.stdout.length).toBeLessThanOrEqual(50000);
      expect(result.stderr.length).toBeLessThanOrEqual(50000);
    });

    it('handles attemptNumber parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ exitCode: 0, stdout: '', stderr: '', artifacts: [] }),
      } as any);

      await runExperimentTool.execute(
        { ...validInput, attemptNumber: 2 },
        { requestContext: undefined } as any
      );

      // Just verify it doesn't throw - the attemptNumber is used for logging
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('input validation', () => {
    it('validates dataset slug format', () => {
      const schema = runExperimentTool.inputSchema;

      // Valid slugs
      expect(schema.safeParse({ experimentPy: 'x', requirementsTxt: '', datasetSlug: 'owner/dataset' }).success).toBe(
        true
      );

      // Invalid slugs
      expect(schema.safeParse({ experimentPy: 'x', requirementsTxt: '', datasetSlug: 'nodash' }).success).toBe(false);
      expect(
        schema.safeParse({ experimentPy: 'x', requirementsTxt: '', datasetSlug: 'too/many/slashes' }).success
      ).toBe(false);
    });

    it('requires non-empty experimentPy', () => {
      const schema = runExperimentTool.inputSchema;
      expect(schema.safeParse({ experimentPy: '', requirementsTxt: '', datasetSlug: 'owner/dataset' }).success).toBe(
        false
      );
    });

    it('validates attemptNumber range', () => {
      const schema = runExperimentTool.inputSchema;
      expect(
        schema.safeParse({ experimentPy: 'x', requirementsTxt: '', datasetSlug: 'o/d', attemptNumber: 0 }).success
      ).toBe(false);
      expect(
        schema.safeParse({ experimentPy: 'x', requirementsTxt: '', datasetSlug: 'o/d', attemptNumber: 4 }).success
      ).toBe(false);
      expect(
        schema.safeParse({ experimentPy: 'x', requirementsTxt: '', datasetSlug: 'o/d', attemptNumber: 3 }).success
      ).toBe(true);
    });
  });
});
