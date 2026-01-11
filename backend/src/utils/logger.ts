/**
 * Unified logging module using Mastra's PinoLogger.
 *
 * Log levels:
 * - debug: Verbose dev-only info (inputs, deltas, intermediate state)
 * - info:  Business events, step boundaries (start/finish of operations)
 * - warn:  Recoverable issues (fallbacks, auth failures, soft errors)
 * - error: Failures requiring attention (exceptions, data corruption)
 *
 * Event naming convention: {subsystem}.{operation}.{event}
 * Examples: jobs.run.start, workflow.novelty_refine.build_query.finish, auth.failure
 */

import { PinoLogger } from '@mastra/loggers';
import { getLogLevel } from './env';

// Singleton PinoLogger instance - matches Mastra's configuration
const pinoLogger = new PinoLogger({
	name: 'Ignis',
	level: getLogLevel(),
});

/**
 * Structured logger with consistent API.
 * Use event names following the convention: subsystem.operation.event
 */
export const logger = {
	/**
	 * Debug-level logs. Only visible when LOG_LEVEL=debug (default in dev).
	 * Use for: intermediate state, inputs/outputs, deltas, verbose tracing.
	 */
	debug(event: string, data?: Record<string, unknown>) {
		pinoLogger.debug(event, data);
	},

	/**
	 * Info-level logs. Always visible in production.
	 * Use for: business events, step boundaries (start/finish), completions.
	 */
	info(event: string, data?: Record<string, unknown>) {
		pinoLogger.info(event, data);
	},

	/**
	 * Warn-level logs. For recoverable issues.
	 * Use for: fallback triggered, auth failure, validation soft-fail, timeouts.
	 */
	warn(event: string, data?: Record<string, unknown>) {
		pinoLogger.warn(event, data);
	},

	/**
	 * Error-level logs. For failures requiring attention.
	 * Use for: uncaught exceptions, data corruption, external service down.
	 */
	error(event: string, data?: Record<string, unknown>) {
		pinoLogger.error(event, data);
	},
};

// Export raw instance for cases needing direct Pino access
export { pinoLogger };
