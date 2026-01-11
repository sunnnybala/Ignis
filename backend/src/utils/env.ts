/**
 * Centralized environment utilities.
 * Single source of truth for environment detection and configuration.
 */

export function isDev(): boolean {
	return process.env.NODE_ENV === 'development';
}

export function isProd(): boolean {
	return process.env.NODE_ENV === 'production';
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function getLogLevel(): LogLevel {
	const raw = String(process.env.LOG_LEVEL || '').trim().toLowerCase();
	if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
		return raw;
	}
	// Default: debug in dev for full visibility, info in prod to reduce noise
	return isDev() ? 'debug' : 'info';
}
