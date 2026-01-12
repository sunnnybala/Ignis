import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isDev, isProd, getLogLevel } from './env';

describe('env utilities', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('isDev', () => {
		it('returns true when NODE_ENV is development', () => {
			process.env.NODE_ENV = 'development';
			expect(isDev()).toBe(true);
		});

		it('returns false when NODE_ENV is production', () => {
			process.env.NODE_ENV = 'production';
			expect(isDev()).toBe(false);
		});

		it('returns false when NODE_ENV is undefined', () => {
			delete process.env.NODE_ENV;
			expect(isDev()).toBe(false);
		});

		it('returns false when NODE_ENV is test', () => {
			process.env.NODE_ENV = 'test';
			expect(isDev()).toBe(false);
		});
	});

	describe('isProd', () => {
		it('returns true when NODE_ENV is production', () => {
			process.env.NODE_ENV = 'production';
			expect(isProd()).toBe(true);
		});

		it('returns false when NODE_ENV is development', () => {
			process.env.NODE_ENV = 'development';
			expect(isProd()).toBe(false);
		});

		it('returns false when NODE_ENV is undefined', () => {
			delete process.env.NODE_ENV;
			expect(isProd()).toBe(false);
		});
	});

	describe('getLogLevel', () => {
		it('returns debug when LOG_LEVEL is debug', () => {
			process.env.LOG_LEVEL = 'debug';
			expect(getLogLevel()).toBe('debug');
		});

		it('returns info when LOG_LEVEL is info', () => {
			process.env.LOG_LEVEL = 'info';
			expect(getLogLevel()).toBe('info');
		});

		it('returns warn when LOG_LEVEL is warn', () => {
			process.env.LOG_LEVEL = 'warn';
			expect(getLogLevel()).toBe('warn');
		});

		it('returns error when LOG_LEVEL is error', () => {
			process.env.LOG_LEVEL = 'error';
			expect(getLogLevel()).toBe('error');
		});

		it('is case-insensitive', () => {
			process.env.LOG_LEVEL = 'DEBUG';
			expect(getLogLevel()).toBe('debug');

			process.env.LOG_LEVEL = 'Info';
			expect(getLogLevel()).toBe('info');
		});

		it('trims whitespace', () => {
			process.env.LOG_LEVEL = '  debug  ';
			expect(getLogLevel()).toBe('debug');
		});

		it('defaults to debug in development', () => {
			delete process.env.LOG_LEVEL;
			process.env.NODE_ENV = 'development';
			expect(getLogLevel()).toBe('debug');
		});

		it('defaults to info in production', () => {
			delete process.env.LOG_LEVEL;
			process.env.NODE_ENV = 'production';
			expect(getLogLevel()).toBe('info');
		});

		it('defaults to info for invalid LOG_LEVEL in production', () => {
			process.env.LOG_LEVEL = 'invalid';
			process.env.NODE_ENV = 'production';
			expect(getLogLevel()).toBe('info');
		});
	});
});
