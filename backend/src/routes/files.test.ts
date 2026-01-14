import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock dependencies before importing the router
vi.mock('../utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../authz/ownership', () => ({
	getAuthedUser: vi.fn(),
	getOwnedFile: vi.fn(),
	logAuthzDenied: vi.fn(),
}));

vi.mock('../storage/supabaseAdapter', () => ({
	getSignedUrl: vi.fn(),
}));

vi.mock('../db/client', () => ({
	db: {
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => Promise.resolve()),
			})),
		})),
	},
}));

vi.mock('../db/schema', () => ({
	files: { id: 'id' },
}));

import { filesRouter } from './files';
import { getAuthedUser, getOwnedFile } from '../authz/ownership';
import { getSignedUrl } from '../storage/supabaseAdapter';

function createMockReq(overrides: Partial<Request> = {}): Partial<Request> {
	return {
		params: {},
		query: {},
		body: {},
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

// Helper to get route handler by method and path pattern
function getHandler(method: string, pathPattern: string) {
	const stack = filesRouter.stack;
	for (const layer of stack) {
		if (layer.route) {
			const routePath = layer.route.path;
			const routeMethod = Object.keys(layer.route.methods)[0];
			if (routeMethod === method && routePath === pathPattern) {
				return layer.route.stack[0].handle;
			}
		}
	}
	throw new Error(`Handler not found: ${method} ${pathPattern}`);
}

describe('files routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /:id', () => {
		const handler = getHandler('get', '/:id');

		it('returns 401 when user not authenticated', async () => {
			vi.mocked(getAuthedUser).mockReturnValue(null);

			const req = createMockReq({ params: { id: 'file-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Unauthorized' });
		});

		it('returns 404 when file not found or not owned', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue(null);

			const req = createMockReq({ params: { id: 'file-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(404);
			expect(res._json).toEqual({ error: 'File not found' });
		});

		it('returns file metadata and content when found', async () => {
			const mockFile = {
				id: 'file-123',
				projectId: 'proj-1',
				path: 'test.txt',
				type: 'txt',
				content: 'Hello world',
			};
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue(mockFile);

			const req = createMockReq({ params: { id: 'file-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual(mockFile);
		});
	});

	describe('GET /:id/url', () => {
		const handler = getHandler('get', '/:id/url');

		it('returns 401 when user not authenticated', async () => {
			vi.mocked(getAuthedUser).mockReturnValue(null);

			const req = createMockReq({ params: { id: 'file-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Unauthorized' });
		});

		it('returns 404 when file not found', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue(null);

			const req = createMockReq({ params: { id: 'file-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(404);
			expect(res._json).toEqual({ error: 'File not found' });
		});

		it('returns 400 when file has no storageKey', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				storageKey: null,
				type: 'txt',
			});

			const req = createMockReq({ params: { id: 'file-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json).toEqual({ error: 'File is not stored in object storage' });
		});

		it('defaults expires to 300 seconds', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				storageKey: 'projects/p1/files/f1.png',
				type: 'img',
			});
			vi.mocked(getSignedUrl).mockResolvedValue('https://signed.url');

			const req = createMockReq({ params: { id: 'file-123' }, query: {} });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ signedUrl: 'https://signed.url', expires: 300 });
		});

		it('clamps expires to maximum 3600 seconds', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				storageKey: 'projects/p1/files/f1.png',
				type: 'img',
			});
			vi.mocked(getSignedUrl).mockResolvedValue('https://signed.url');

			const req = createMockReq({ params: { id: 'file-123' }, query: { expires: '9999' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json.expires).toBe(3600);
			expect(getSignedUrl).toHaveBeenCalledWith('projects/p1/files/f1.png', 3600);
		});

		it('returns signed URL with requested TTL', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				storageKey: 'projects/p1/files/f1.png',
				type: 'img',
			});
			vi.mocked(getSignedUrl).mockResolvedValue('https://signed.url');

			const req = createMockReq({ params: { id: 'file-123' }, query: { expires: '600' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ signedUrl: 'https://signed.url', expires: 600 });
			expect(getSignedUrl).toHaveBeenCalledWith('projects/p1/files/f1.png', 600);
		});
	});

	describe('PUT /:id', () => {
		const handler = getHandler('put', '/:id');

		it('returns 401 when user not authenticated', async () => {
			vi.mocked(getAuthedUser).mockReturnValue(null);

			const req = createMockReq({ params: { id: 'file-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Unauthorized' });
		});

		it('returns 404 when file not found', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue(null);

			const req = createMockReq({ params: { id: 'file-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(404);
			expect(res._json).toEqual({ error: 'File not found' });
		});

		it('returns 400 for non-text file types (img)', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				type: 'img',
			});

			const req = createMockReq({
				params: { id: 'file-123' },
				body: { content: 'new content' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json).toEqual({ error: 'Editing only allowed for text-based files' });
		});

		it('returns 400 for non-text file types (csv)', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				type: 'csv',
			});

			const req = createMockReq({
				params: { id: 'file-123' },
				body: { content: 'new content' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json).toEqual({ error: 'Editing only allowed for text-based files' });
		});

		it('updates content for txt files', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				type: 'txt',
			});

			const req = createMockReq({
				params: { id: 'file-123' },
				body: { content: 'updated content' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ ok: true });
		});

		it('updates content for md files', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				type: 'md',
			});

			const req = createMockReq({
				params: { id: 'file-123' },
				body: { content: '# Markdown' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ ok: true });
		});

		it('updates content for py files', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				type: 'py',
			});

			const req = createMockReq({
				params: { id: 'file-123' },
				body: { content: 'print("hello")' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ ok: true });
		});

		it('updates content for tex files', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedFile).mockResolvedValue({
				id: 'file-123',
				type: 'tex',
			});

			const req = createMockReq({
				params: { id: 'file-123' },
				body: { content: '\\documentclass{article}' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ ok: true });
		});
	});
});
