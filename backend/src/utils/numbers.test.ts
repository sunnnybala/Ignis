import { describe, it, expect } from 'vitest';
import { clampInt } from './numbers';

describe('clampInt', () => {
	it('returns the number when within bounds', () => {
		expect(clampInt(5, 0, 10)).toBe(5);
		expect(clampInt(0, 0, 10)).toBe(0);
		expect(clampInt(10, 0, 10)).toBe(10);
	});

	it('clamps to min when below range', () => {
		expect(clampInt(-5, 0, 10)).toBe(0);
		expect(clampInt(-100, 0, 10)).toBe(0);
	});

	it('clamps to max when above range', () => {
		expect(clampInt(15, 0, 10)).toBe(10);
		expect(clampInt(1000, 0, 10)).toBe(10);
	});

	it('truncates decimals', () => {
		expect(clampInt(5.9, 0, 10)).toBe(5);
		expect(clampInt(5.1, 0, 10)).toBe(5);
		expect(clampInt(-5.9, -10, 10)).toBe(-5);
	});

	it('returns min for NaN', () => {
		expect(clampInt(NaN, 0, 10)).toBe(0);
		expect(clampInt(NaN, 5, 10)).toBe(5);
	});

	it('returns min for Infinity', () => {
		expect(clampInt(Infinity, 0, 10)).toBe(0);
		expect(clampInt(-Infinity, 0, 10)).toBe(0);
	});

	it('works with negative ranges', () => {
		expect(clampInt(-5, -10, -1)).toBe(-5);
		expect(clampInt(0, -10, -1)).toBe(-1);
		expect(clampInt(-15, -10, -1)).toBe(-10);
	});

	it('works with zero-width range', () => {
		expect(clampInt(0, 5, 5)).toBe(5);
		expect(clampInt(10, 5, 5)).toBe(5);
	});
});
