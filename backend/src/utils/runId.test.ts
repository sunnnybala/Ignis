import { describe, it, expect } from 'vitest';
import { formatRunIdFromDateUtc } from './runId';

describe('formatRunIdFromDateUtc', () => {
	it('formats date correctly in YYYYMMDD_HHmmss_SSS format', () => {
		const date = new Date(Date.UTC(2025, 11, 28, 17, 45, 12, 37)); // Dec 28, 2025 17:45:12.037 UTC
		expect(formatRunIdFromDateUtc(date)).toBe('20251228_174512_037');
	});

	it('pads single-digit components with zeros', () => {
		const date = new Date(Date.UTC(2025, 0, 5, 3, 7, 9, 5)); // Jan 5, 2025 03:07:09.005 UTC
		expect(formatRunIdFromDateUtc(date)).toBe('20250105_030709_005');
	});

	it('handles midnight correctly', () => {
		const date = new Date(Date.UTC(2025, 5, 15, 0, 0, 0, 0)); // Jun 15, 2025 00:00:00.000 UTC
		expect(formatRunIdFromDateUtc(date)).toBe('20250615_000000_000');
	});

	it('handles end of day correctly', () => {
		const date = new Date(Date.UTC(2025, 5, 15, 23, 59, 59, 999)); // Jun 15, 2025 23:59:59.999 UTC
		expect(formatRunIdFromDateUtc(date)).toBe('20250615_235959_999');
	});

	it('produces lexicographically sortable output', () => {
		const earlier = new Date(Date.UTC(2025, 0, 1, 0, 0, 0, 0));
		const later = new Date(Date.UTC(2025, 0, 1, 0, 0, 0, 1));

		const earlierId = formatRunIdFromDateUtc(earlier);
		const laterId = formatRunIdFromDateUtc(later);

		expect(earlierId < laterId).toBe(true);
	});

	it('orders across different years correctly', () => {
		const y2024 = formatRunIdFromDateUtc(new Date(Date.UTC(2024, 11, 31, 23, 59, 59, 999)));
		const y2025 = formatRunIdFromDateUtc(new Date(Date.UTC(2025, 0, 1, 0, 0, 0, 0)));

		expect(y2024 < y2025).toBe(true);
	});

	it('orders across different months correctly', () => {
		const jan = formatRunIdFromDateUtc(new Date(Date.UTC(2025, 0, 31)));
		const feb = formatRunIdFromDateUtc(new Date(Date.UTC(2025, 1, 1)));

		expect(jan < feb).toBe(true);
	});

	it('uses only safe characters for path segments', () => {
		const runId = formatRunIdFromDateUtc(new Date());
		// Should only contain digits and underscores
		expect(runId).toMatch(/^[0-9_]+$/);
	});

	it('has fixed width output', () => {
		const runId = formatRunIdFromDateUtc(new Date());
		// Format: YYYYMMDD_HHmmss_SSS = 8 + 1 + 6 + 1 + 3 = 19 chars
		expect(runId.length).toBe(19);
	});
});
