/**
 * Build a human-readable, lexicographically sortable runId from a Date.
 *
 * Format (UTC): YYYYMMDD_HHmmss_SSS
 * Example:      20251228_174512_037
 *
 * Notes:
 * - Uses only digits + underscores so it's safe as a path segment across platforms.
 * - Fixed-width => simple string comparison matches chronological order.
 */
function pad(n: number, width: number): string {
	const s = String(Math.trunc(n));
	return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

export function formatRunIdFromDateUtc(d: Date): string {
	const yyyy = d.getUTCFullYear();
	const mm = pad(d.getUTCMonth() + 1, 2);
	const dd = pad(d.getUTCDate(), 2);
	const hh = pad(d.getUTCHours(), 2);
	const mi = pad(d.getUTCMinutes(), 2);
	const ss = pad(d.getUTCSeconds(), 2);
	const ms = pad(d.getUTCMilliseconds(), 3);
	return `${yyyy}${mm}${dd}_${hh}${mi}${ss}_${ms}`;
}


