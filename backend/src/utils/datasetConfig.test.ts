import { describe, it, expect } from 'vitest';
import { parseDatasetConfig } from './datasetConfig';

describe('parseDatasetConfig', () => {
	describe('valid configs', () => {
		it('parses minimal valid config', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.source).toBe('kaggle');
				expect(result.value.kaggle.dataset).toBe('owner/repo');
			}
		});

		it('parses config with all optional fields', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: {
					dataset: 'owner/repo',
					unzip: true,
					files: ['train.csv', 'test.csv'],
				},
				layout: { subdir: 'data' },
				notes: 'Test dataset for experiments',
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.kaggle.unzip).toBe(true);
				expect(result.value.kaggle.files).toEqual(['train.csv', 'test.csv']);
				expect(result.value.layout?.subdir).toBe('data');
				expect(result.value.notes).toBe('Test dataset for experiments');
			}
		});
	});

	describe('error cases', () => {
		it('returns error for empty string', () => {
			const result = parseDatasetConfig('');

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('dataset.json is empty');
			}
		});

		it('returns error for invalid JSON', () => {
			const result = parseDatasetConfig('{invalid json');

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('Invalid JSON');
			}
		});

		it('returns error when root is not an object', () => {
			const result = parseDatasetConfig('[]');

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('dataset.json must be a JSON object');
			}
		});

		it('returns error for unsupported source', () => {
			const input = JSON.stringify({
				source: 'aws',
				kaggle: { dataset: 'owner/repo' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('Unsupported source');
			}
		});

		it('returns error when kaggle.dataset is missing', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: {},
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('kaggle.dataset is required');
			}
		});

		it('returns error for invalid dataset format', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'noslash' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('must look like "owner/dataset"');
			}
		});

		it('returns error for invalid field types', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo', unzip: 'true' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('must be a boolean');
			}
		});
	});

	describe('security - path traversal prevention', () => {
		it('rejects subdir with ".."', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: '../escape' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('unsafe');
			}
		});

		it('rejects subdir with embedded ".."', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: 'safe..path' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('unsafe');
			}
		});

		it('rejects subdir starting with "/"', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: '/absolute' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('unsafe');
			}
		});

		it('rejects subdir starting with "\\"', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: '\\windows' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('unsafe');
			}
		});

		it('rejects subdir containing "/"', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: 'nested/path' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('unsafe');
			}
		});

		it('rejects subdir containing "\\"', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: 'nested\\path' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('unsafe');
			}
		});

		it('rejects subdir containing ":"', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: 'C:drive' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('unsafe');
			}
		});

		it('rejects subdir with special characters not in allowed set', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: 'data@home' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('unsafe');
			}
		});

		it('allows empty subdir (runner derives default)', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: '' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
		});

		it('allows undefined subdir', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: {},
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
		});
	});

	describe('new validation fields', () => {
		it('parses config with verifiedAt timestamp', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: {
					dataset: 'owner/repo',
					verifiedAt: '2025-01-18T12:00:00Z',
				},
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.kaggle.verifiedAt).toBe('2025-01-18T12:00:00Z');
			}
		});

		it('parses config with totalSizeBytes', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: {
					dataset: 'owner/repo',
					totalSizeBytes: 1048576,
				},
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.kaggle.totalSizeBytes).toBe(1048576);
			}
		});

		it('parses config with dataPattern', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { dataPattern: 'has_subdirs' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.layout?.dataPattern).toBe('has_subdirs');
			}
		});

		it('rejects invalid verifiedAt type', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: {
					dataset: 'owner/repo',
					verifiedAt: 12345,
				},
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('verifiedAt');
			}
		});

		it('rejects negative totalSizeBytes', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: {
					dataset: 'owner/repo',
					totalSizeBytes: -100,
				},
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('totalSizeBytes');
			}
		});

		it('rejects invalid dataPattern value', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { dataPattern: 'invalid_pattern' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('dataPattern');
			}
		});

		it('parses config with all new validation fields', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: {
					dataset: 'owner/repo',
					files: ['train.csv', 'test.csv'],
					verifiedAt: '2025-01-18T12:00:00Z',
					totalSizeBytes: 2048,
				},
				layout: {
					subdir: 'data',
					dataPattern: 'flat',
				},
				notes: 'Validated via Kaggle API',
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.kaggle.files).toEqual(['train.csv', 'test.csv']);
				expect(result.value.kaggle.verifiedAt).toBe('2025-01-18T12:00:00Z');
				expect(result.value.kaggle.totalSizeBytes).toBe(2048);
				expect(result.value.layout?.dataPattern).toBe('flat');
			}
		});
	});
});
