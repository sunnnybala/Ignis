/**
 * Shared utilities for Mastra tools.
 */

/**
 * Extract userId and projectId from Mastra tool context.
 * Works with both RequestContext (current) and RuntimeContext (legacy).
 */
export function getRuntimeIds(toolContext?: any): { userId: string; projectId: string } {
	const requestContext = toolContext?.requestContext;
	const userId = String(
		requestContext?.get?.('userId') ?? toolContext?.runtimeContext?.get?.('userId') ?? ''
	).trim();
	const projectId = String(
		requestContext?.get?.('projectId') ?? toolContext?.runtimeContext?.get?.('projectId') ?? ''
	).trim();
	if (!userId || !projectId) {
		throw new Error('Missing requestContext userId/projectId');
	}
	return { userId, projectId };
}

/**
 * Compare two version strings (timestamps, runIds).
 * Numeric strings are compared numerically; otherwise lexicographic.
 */
export function compareVersionStrings(a: string, b: string): number {
	const aDigits = /^\d+$/.test(a);
	const bDigits = /^\d+$/.test(b);
	if (aDigits && bDigits) {
		try {
			const ai = BigInt(a);
			const bi = BigInt(b);
			return ai === bi ? 0 : ai > bi ? 1 : -1;
		} catch {
			// fall through to string compare
		}
	}
	// Fallback: lexicographic compare (works for sortable formats like YYYYMMDDHHmmss).
	return a === b ? 0 : a > b ? 1 : -1;
}

/**
 * Wrap a fetch call with a timeout. Combines upstream abort signal with timeout.
 */
export function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error('timeout')), ms);
	const cleanup = () => clearTimeout(timeout);

	if (signal) {
		if (signal.aborted) controller.abort(signal.reason);
		else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
	}

	controller.signal.addEventListener('abort', cleanup, { once: true });
	return controller.signal;
}

/**
 * Check if a file path is a supported image format.
 */
export function isSupportedImagePath(path: string): boolean {
	const lower = path.toLowerCase();
	return (
		lower.endsWith('.png') ||
		lower.endsWith('.jpg') ||
		lower.endsWith('.jpeg') ||
		lower.endsWith('.webp')
	);
}
