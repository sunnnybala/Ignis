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
});
