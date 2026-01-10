/**
 * Clamp a number to an integer within the given range.
 * Returns `min` if the number is not finite.
 */
export function clampInt(n: number, min: number, max: number): number {
	if (!Number.isFinite(n)) return min;
	return Math.min(max, Math.max(min, Math.trunc(n)));
}
