import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Set env vars before module imports
vi.hoisted(() => {
	process.env.SUPABASE_JWKS_URL = 'https://example.supabase.co/.well-known/jwks.json';
	process.env.SUPABASE_JWT_ISSUER = 'https://example.supabase.co/auth/v1';
	process.env.SUPABASE_JWT_AUD = 'authenticated';
});

vi.mock('jose', () => ({
	createRemoteJWKSet: vi.fn(() => vi.fn()),
	jwtVerify: vi.fn(),
	decodeJwt: vi.fn(),
	decodeProtectedHeader: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/env', () => ({
	isDev: vi.fn(() => false),
}));

import { requireAuth } from './auth';
import { jwtVerify } from 'jose';

describe('requireAuth middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function createMockReq(overrides: Partial<Request> = {}): Partial<Request> {
		return {
			get: vi.fn().mockReturnValue(undefined),
			method: 'GET',
			path: '/api/test',
			requestId: 'test-request-id',
			...overrides,
		};
	}

	function createMockRes(): Partial<Response> & { _statusCode: number; _json: any } {
		const res: Partial<Response> & { _statusCode: number; _json: any } = {
			_statusCode: 200,
			_json: null,
			status: vi.fn((code: number) => {
				res._statusCode = code;
				return res as Response;
			}),
			json: vi.fn((data: any) => {
				res._json = data;
				return res as Response;
			}),
		};
		return res;
	}

	describe('public routes', () => {
		it('allows /health without authentication', async () => {
			const req = createMockReq({ method: 'GET', path: '/health' }) as Request;
			const res = createMockRes() as Response;
			const next = vi.fn();

			await requireAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});

		it('allows job complete callback without authentication', async () => {
			const req = createMockReq({
				method: 'POST',
				path: '/jobs/abc-123/complete',
			}) as Request;
			const res = createMockRes() as Response;
			const next = vi.fn();

			await requireAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});

		it('allows presign callback without authentication', async () => {
			const req = createMockReq({
				method: 'POST',
				path: '/jobs/abc-123/artifacts/presign',
			}) as Request;
			const res = createMockRes() as Response;
			const next = vi.fn();

			await requireAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(res.status).not.toHaveBeenCalled();
		});
	});

	describe('missing token', () => {
		it('returns 401 when Authorization header is missing', async () => {
			const req = createMockReq() as Request;
			const res = createMockRes();
			const next = vi.fn();

			await requireAuth(req, res as Response, next);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Missing Authorization bearer token' });
			expect(next).not.toHaveBeenCalled();
		});

		it('returns 401 when Authorization header is empty', async () => {
			const req = createMockReq({
				get: vi.fn().mockReturnValue(''),
			}) as Request;
			const res = createMockRes();
			const next = vi.fn();

			await requireAuth(req, res as Response, next);

			expect(res._statusCode).toBe(401);
			expect(next).not.toHaveBeenCalled();
		});

		it('returns 401 when Authorization header is not Bearer format', async () => {
			const req = createMockReq({
				get: vi.fn().mockReturnValue('Basic abc123'),
			}) as Request;
			const res = createMockRes();
			const next = vi.fn();

			await requireAuth(req, res as Response, next);

			expect(res._statusCode).toBe(401);
			expect(next).not.toHaveBeenCalled();
		});
	});

	describe('valid token', () => {
		it('attaches user to request when token is valid', async () => {
			const mockPayload = {
				sub: 'user-123',
				email: 'test@example.com',
				role: 'authenticated',
			};

			vi.mocked(jwtVerify).mockResolvedValue({
				payload: mockPayload,
				protectedHeader: { alg: 'RS256' },
			} as any);

			const req = createMockReq({
				get: vi.fn().mockReturnValue('Bearer valid-token'),
			}) as Request;
			const res = createMockRes() as Response;
			const next = vi.fn();

			await requireAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(req.user).toEqual({
				id: 'user-123',
				email: 'test@example.com',
				role: 'authenticated',
			});
		});

		it('handles token with user_email instead of email', async () => {
			const mockPayload = {
				sub: 'user-123',
				user_email: 'alt@example.com',
			};

			vi.mocked(jwtVerify).mockResolvedValue({
				payload: mockPayload,
				protectedHeader: { alg: 'RS256' },
			} as any);

			const req = createMockReq({
				get: vi.fn().mockReturnValue('Bearer valid-token'),
			}) as Request;
			const res = createMockRes() as Response;
			const next = vi.fn();

			await requireAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(req.user?.email).toBe('alt@example.com');
		});

		it('handles token without email or role', async () => {
			const mockPayload = {
				sub: 'user-123',
			};

			vi.mocked(jwtVerify).mockResolvedValue({
				payload: mockPayload,
				protectedHeader: { alg: 'RS256' },
			} as any);

			const req = createMockReq({
				get: vi.fn().mockReturnValue('Bearer valid-token'),
			}) as Request;
			const res = createMockRes() as Response;
			const next = vi.fn();

			await requireAuth(req, res, next);

			expect(next).toHaveBeenCalled();
			expect(req.user).toEqual({
				id: 'user-123',
				email: null,
				role: null,
			});
		});
	});

	describe('invalid token', () => {
		it('returns 401 when token is missing sub claim', async () => {
			const mockPayload = {
				email: 'test@example.com',
			};

			vi.mocked(jwtVerify).mockResolvedValue({
				payload: mockPayload,
				protectedHeader: { alg: 'RS256' },
			} as any);

			const req = createMockReq({
				get: vi.fn().mockReturnValue('Bearer token-without-sub'),
			}) as Request;
			const res = createMockRes();
			const next = vi.fn();

			await requireAuth(req, res as Response, next);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Invalid token (missing sub)' });
			expect(next).not.toHaveBeenCalled();
		});

		it('returns 401 with "Token expired" for expired tokens', async () => {
			const expiredError = new Error('Token has expired');
			(expiredError as any).name = 'JWTExpired';

			vi.mocked(jwtVerify).mockRejectedValue(expiredError);

			const req = createMockReq({
				get: vi.fn().mockReturnValue('Bearer expired-token'),
			}) as Request;
			const res = createMockRes();
			const next = vi.fn();

			await requireAuth(req, res as Response, next);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Token expired' });
			expect(next).not.toHaveBeenCalled();
		});

		it('returns 401 with "Invalid token" for other verification errors', async () => {
			const invalidError = new Error('Invalid signature');

			vi.mocked(jwtVerify).mockRejectedValue(invalidError);

			const req = createMockReq({
				get: vi.fn().mockReturnValue('Bearer invalid-token'),
			}) as Request;
			const res = createMockRes();
			const next = vi.fn();

			await requireAuth(req, res as Response, next);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Invalid token' });
			expect(next).not.toHaveBeenCalled();
		});
	});
});
