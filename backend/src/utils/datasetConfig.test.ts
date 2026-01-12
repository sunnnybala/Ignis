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

		it('trims whitespace from dataset', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: '  owner/repo  ' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.kaggle.dataset).toBe('owner/repo');
			}
		});

		it('trims whitespace from layout.subdir', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: '  data  ' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.layout?.subdir).toBe('data');
			}
		});

		it('accepts valid subdir characters [a-zA-Z0-9._-]', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: 'my_data-v1.0' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.layout?.subdir).toBe('my_data-v1.0');
			}
		});

		it('trims whitespace from kaggle.files entries', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: {
					dataset: 'owner/repo',
					files: ['  train.csv  ', 'test.csv'],
				},
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.kaggle.files).toEqual(['train.csv', 'test.csv']);
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

		it('returns error for whitespace-only string', () => {
			const result = parseDatasetConfig('   \n\t  ');

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

		it('returns error when root is an array', () => {
			const result = parseDatasetConfig('[]');

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('dataset.json must be a JSON object');
			}
		});

		it('returns error when root is a string', () => {
			const result = parseDatasetConfig('"just a string"');

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('dataset.json must be a JSON object');
			}
		});

		it('returns error when root is null', () => {
			const result = parseDatasetConfig('null');

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

		it('returns error for missing source field', () => {
			const input = JSON.stringify({
				kaggle: { dataset: 'owner/repo' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('Unsupported source');
			}
		});

		it('returns error when kaggle is not an object', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: 'invalid',
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('kaggle must be an object');
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

		it('returns error when kaggle.dataset is empty', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: '' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('kaggle.dataset is required');
			}
		});

		it('returns error when kaggle.dataset is whitespace only', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: '   ' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('kaggle.dataset is required');
			}
		});

		it('returns error for invalid dataset format (no slash)', () => {
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

		it('returns error for invalid dataset format (multiple slashes)', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo/extra' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('must look like "owner/dataset"');
			}
		});

		it('returns error when kaggle.unzip is not boolean', () => {
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

		it('returns error when kaggle.files is not an array', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo', files: 'file.csv' },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('must be an array');
			}
		});

		it('returns error when kaggle.files contains empty strings', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo', files: ['valid.csv', ''] },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('non-empty strings');
			}
		});

		it('returns error when kaggle.files contains non-strings', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo', files: ['valid.csv', 123] },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('non-empty strings');
			}
		});

		it('returns error when layout is not an object', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: 'invalid',
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('layout must be an object if provided');
			}
		});

		it('returns error when layout.subdir is not a string', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				layout: { subdir: 123 },
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('must be a string');
			}
		});

		it('returns error when notes is not a string', () => {
			const input = JSON.stringify({
				source: 'kaggle',
				kaggle: { dataset: 'owner/repo' },
				notes: 123,
			});

			const result = parseDatasetConfig(input);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('must be a string');
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
