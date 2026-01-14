import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';
import { getAuthedUser, logAuthzDenied } from './ownership';

// Mock the logger
vi.mock('../utils/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

import { logger } from '../utils/logger';

describe('getAuthedUser', () => {
	it('returns user object when valid user is on request', () => {
		const req = {
			user: {
				id: 'user-123',
				email: 'test@example.com',
				role: 'authenticated',
			},
		} as unknown as Request;

		const result = getAuthedUser(req);

		expect(result).toEqual({
			id: 'user-123',
			email: 'test@example.com',
			role: 'authenticated',
		});
	});

	it('returns null when user is not on request', () => {
		const req = {} as Request;

		const result = getAuthedUser(req);

		expect(result).toBeNull();
	});

	it('returns null when user.id is not a string', () => {
		const req = {
			user: { id: 123 },
		} as unknown as Request;

		const result = getAuthedUser(req);

		expect(result).toBeNull();
	});

	it('returns null when user.id is empty string', () => {
		const req = {
			user: { id: '' },
		} as unknown as Request;

		const result = getAuthedUser(req);

		expect(result).toBeNull();
	});

	it('returns null when user.id is whitespace only', () => {
		const req = {
			user: { id: '   ' },
		} as unknown as Request;

		const result = getAuthedUser(req);

		expect(result).toBeNull();
	});

	it('handles missing email and role', () => {
		const req = {
			user: { id: 'user-123' },
		} as unknown as Request;

		const result = getAuthedUser(req);

		expect(result).toEqual({
			id: 'user-123',
			email: null,
			role: null,
		});
	});

	it('handles non-string email and role', () => {
		const req = {
			user: {
				id: 'user-123',
				email: 123,
				role: true,
			},
		} as unknown as Request;

		const result = getAuthedUser(req);

		expect(result).toEqual({
			id: 'user-123',
			email: null,
			role: null,
		});
	});
});

describe('logAuthzDenied', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('logs warning with request details', () => {
		const req = {
			method: 'GET',
			originalUrl: '/api/projects/123',
			url: '/api/projects/123',
			requestId: 'req-abc',
			user: { id: 'user-456' },
		} as unknown as Request;

		logAuthzDenied(req, { resource: 'project', resourceId: '123' });

		expect(logger.warn).toHaveBeenCalledWith('authz.denied', {
			requestId: 'req-abc',
			route: 'GET /api/projects/123',
			userId: 'user-456',
			resource: 'project',
			resourceId: '123',
		});
	});

	it('handles missing requestId', () => {
		const req = {
			method: 'POST',
			originalUrl: '/api/test',
			user: { id: 'user-789' },
		} as unknown as Request;

		logAuthzDenied(req, {});

		expect(logger.warn).toHaveBeenCalledWith('authz.denied', {
			requestId: null,
			route: 'POST /api/test',
			userId: 'user-789',
		});
	});

	it('handles missing user', () => {
		const req = {
			method: 'DELETE',
			url: '/api/delete',
			requestId: 'req-xyz',
		} as unknown as Request;

		logAuthzDenied(req, {});

		expect(logger.warn).toHaveBeenCalledWith('authz.denied', {
			requestId: 'req-xyz',
			route: 'DELETE /api/delete',
			userId: null,
		});
	});

	it('falls back to url when originalUrl is missing', () => {
		const req = {
			method: 'GET',
			url: '/fallback-url',
			requestId: 'req-123',
		} as unknown as Request;

		logAuthzDenied(req, {});

		expect(logger.warn).toHaveBeenCalledWith('authz.denied', {
			requestId: 'req-123',
			route: 'GET /fallback-url',
			userId: null,
		});
	});
});

// Note: getOwnedProject, getOwnedFile, and getOwnedJob are not tested here
// because they require database mocking which would make these integration tests.
// For true unit tests of these functions, we would need to:
// 1. Mock the db module
// 2. Set up mock query builders
// These are better tested as integration tests with a test database.
