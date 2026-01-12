import { describe, it, expect } from 'vitest';
import { buildResultKey, buildPaperKey, sanitizeFileName } from './paths';

describe('sanitizeFileName', () => {
	it('keeps safe characters unchanged', () => {
		expect(sanitizeFileName('file.txt')).toBe('file.txt');
		expect(sanitizeFileName('my-file_v2.py')).toBe('my-file_v2.py');
		expect(sanitizeFileName('test123.json')).toBe('test123.json');
	});

	it('replaces unsafe characters with dashes', () => {
		expect(sanitizeFileName('file name.txt')).toBe('file-name.txt');
		expect(sanitizeFileName('file@name.txt')).toBe('file-name.txt');
		expect(sanitizeFileName('file#name!.txt')).toBe('file-name-.txt');
	});

	it('collapses multiple dashes into one', () => {
		expect(sanitizeFileName('file   name.txt')).toBe('file-name.txt');
		expect(sanitizeFileName('file@#$name.txt')).toBe('file-name.txt');
	});

	it('handles unicode characters', () => {
		expect(sanitizeFileName('filé.txt')).toBe('fil-.txt');
		expect(sanitizeFileName('文件.txt')).toBe('-.txt');
	});

	it('truncates long filenames to 128 characters', () => {
		const longName = 'a'.repeat(200) + '.txt';
		const result = sanitizeFileName(longName);
		expect(result.length).toBe(128);
	});

	it('handles empty string', () => {
		expect(sanitizeFileName('')).toBe('');
	});

	it('handles string with only unsafe characters', () => {
		expect(sanitizeFileName('@#$%')).toBe('-');
	});
});

describe('buildResultKey', () => {
	it('builds correct S3 path for result files', () => {
		const key = buildResultKey('proj-123', 'run-456', 'output.csv');
		expect(key).toBe('projects/proj-123/results/run-456/output.csv');
	});

	it('sanitizes the filename', () => {
		const key = buildResultKey('proj-123', 'run-456', 'my file.csv');
		expect(key).toBe('projects/proj-123/results/run-456/my-file.csv');
	});

	it('handles complex filenames', () => {
		const key = buildResultKey('proj-123', 'run-456', 'result@2025#v1.json');
		expect(key).toBe('projects/proj-123/results/run-456/result-2025-v1.json');
	});
});

describe('buildPaperKey', () => {
	it('builds correct S3 path for paper PDFs', () => {
		const key = buildPaperKey('proj-123', 'job-789');
		expect(key).toBe('projects/proj-123/paper/job-789/paper.pdf');
	});
});
