import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requestContext } from './requestContext';

vi.mock('../utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('requestContext middleware', () => {

	function createMockReq(headers: Record<string, string> = {}): Partial<Request> {
		return {
			get: vi.fn((name: string) => headers[name.toLowerCase()]) as unknown as Request['get'],
			headers,
			method: 'GET',
			url: '/test',
			originalUrl: '/test',
			user: undefined,
		};
	}

	function createMockRes(): Partial<Response> & { _headers: Record<string, string> } {
		const res: Partial<Response> & { _headers: Record<string, string> } = {
			_headers: {},
			setHeader: vi.fn((name: string, value: string) => {
				res._headers[name.toLowerCase()] = value;
				return res as Response;
			}),
			on: vi.fn(),
		};
		return res;
	}

	it('generates a UUID request ID when no header is present', () => {
		const req = createMockReq() as Request;
		const res = createMockRes() as Response;
		const next = vi.fn();

		requestContext(req, res, next);

		expect(req.requestId).toBeDefined();
		expect(req.requestId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
		expect(next).toHaveBeenCalled();
	});

	it('uses existing X-Request-ID header when present', () => {
		const existingId = 'existing-request-id-123';
		const req = createMockReq({ 'x-request-id': existingId }) as Request;
		const res = createMockRes() as Response;
		const next = vi.fn();

		requestContext(req, res, next);

		expect(req.requestId).toBe(existingId);
	});

	it('sets x-request-id response header', () => {
		const req = createMockReq() as Request;
		const res = createMockRes();
		const next = vi.fn();

		requestContext(req, res as Response, next);

		expect(res.setHeader).toHaveBeenCalledWith('x-request-id', expect.any(String));
		expect(res._headers['x-request-id']).toBe(req.requestId);
	});

	it('calls next() to continue middleware chain', () => {
		const req = createMockReq() as Request;
		const res = createMockRes() as Response;
		const next = vi.fn();

		requestContext(req, res, next);

		expect(next).toHaveBeenCalledTimes(1);
		expect(next).toHaveBeenCalledWith();
	});

	it('respects custom REQUEST_ID_HEADER env var', () => {
		const originalHeader = process.env.REQUEST_ID_HEADER;
		process.env.REQUEST_ID_HEADER = 'x-correlation-id';

		try {
			const customId = 'custom-correlation-123';
			const req = createMockReq({ 'x-correlation-id': customId }) as Request;
			const res = createMockRes() as Response;
			const next = vi.fn();

			requestContext(req, res, next);

			expect(req.requestId).toBe(customId);
		} finally {
			if (originalHeader === undefined) {
				delete process.env.REQUEST_ID_HEADER;
			} else {
				process.env.REQUEST_ID_HEADER = originalHeader;
			}
		}
	});

	it('trims whitespace from existing request ID header', () => {
		const req = createMockReq({ 'x-request-id': '  trimmed-id  ' }) as Request;
		const res = createMockRes() as Response;
		const next = vi.fn();

		requestContext(req, res, next);

		expect(req.requestId).toBe('trimmed-id');
	});

	it('generates new ID if header is empty string', () => {
		const req = createMockReq({ 'x-request-id': '' }) as Request;
		const res = createMockRes() as Response;
		const next = vi.fn();

		requestContext(req, res, next);

		expect(req.requestId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
	});

	it('generates new ID if header is whitespace only', () => {
		const req = createMockReq({ 'x-request-id': '   ' }) as Request;
		const res = createMockRes() as Response;
		const next = vi.fn();

		requestContext(req, res, next);

		expect(req.requestId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
	});

	it('registers finish event handler for logging', () => {
		const req = createMockReq() as Request;
		const res = createMockRes();
		const next = vi.fn();

		requestContext(req, res as Response, next);

		expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
	});
});
