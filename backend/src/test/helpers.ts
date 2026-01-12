import type { Request, Response, NextFunction } from 'express';
import { vi } from 'vitest';

/**
 * Create a mock Express request object
 */
export function createMockRequest(overrides: Partial<Request> = {}): Partial<Request> {
	return {
		get: vi.fn().mockReturnValue(undefined),
		headers: {},
		method: 'GET',
		url: '/',
		originalUrl: '/',
		...overrides,
	};
}

/**
 * Create a mock Express response object
 */
export function createMockResponse(): Partial<Response> & {
	_headers: Record<string, string>;
	_statusCode: number;
} {
	const res: Partial<Response> & {
		_headers: Record<string, string>;
		_statusCode: number;
	} = {
		_headers: {},
		_statusCode: 200,
		setHeader: vi.fn((name: string, value: string) => {
			res._headers[name.toLowerCase()] = value;
			return res as Response;
		}),
		status: vi.fn((code: number) => {
			res._statusCode = code;
			return res as Response;
		}),
		json: vi.fn().mockReturnThis(),
		send: vi.fn().mockReturnThis(),
		on: vi.fn(),
	};
	return res;
}

/**
 * Create a mock next function
 */
export function createMockNext(): NextFunction {
	return vi.fn();
}
