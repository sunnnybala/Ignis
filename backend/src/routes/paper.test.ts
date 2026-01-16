import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Hoisted mocks
const { mockDbSelect, mockCompileLatexToPdf, LatexCompileError } = vi.hoisted(() => {
	class LatexCompileError extends Error {
		log: string;
		constructor(message: string, log: string) {
			super(message);
			this.name = 'LatexCompileError';
			this.log = log;
		}
	}

	const mockDbSelect = vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve([])),
		})),
	}));

	const mockCompileLatexToPdf = vi.fn();

	return { mockDbSelect, mockCompileLatexToPdf, LatexCompileError };
});

vi.mock('../utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../authz/ownership', () => ({
	getAuthedUser: vi.fn(),
	getOwnedProject: vi.fn(),
	logAuthzDenied: vi.fn(),
}));

vi.mock('../db/client', () => ({
	db: {
		select: mockDbSelect,
		insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
	},
}));

vi.mock('../db/schema', () => ({
	files: { projectId: 'projectId', path: 'path', type: 'type', id: 'id' },
}));

vi.mock('../services/latexCompiler', () => ({
	compileLatexToPdf: mockCompileLatexToPdf,
	LatexCompileError: LatexCompileError,
}));

// Mock other dependencies that may be imported but not used in compile
vi.mock('../llm/openai', () => ({
	getOpenAI: vi.fn(),
}));

vi.mock('../utils/sse', () => ({
	initSse: vi.fn(),
}));

vi.mock('../storage/supabaseAdapter', () => ({
	getSignedUrl: vi.fn(),
}));

vi.mock('../utils/numbers', () => ({
	clampInt: vi.fn((n: number, min: number, max: number) => Math.min(Math.max(n, min), max)),
}));

vi.mock('../mastra/tools/tool-utils', () => ({
	isSupportedImagePath: vi.fn(() => true),
}));

import { paperRouter } from './paper';
import { getAuthedUser, getOwnedProject } from '../authz/ownership';

function createMockReq(overrides: Partial<Request> = {}): Partial<Request> {
	return {
		params: {},
		query: {},
		body: {},
		...overrides,
	};
}

function createMockRes(): Partial<Response> & {
	_statusCode: number;
	_json: any;
	_data: Buffer | null;
	_headers: Record<string, string>;
} {
	const res: Partial<Response> & {
		_statusCode: number;
		_json: any;
		_data: Buffer | null;
		_headers: Record<string, string>;
	} = {
		_statusCode: 200,
		_json: null,
		_data: null,
		_headers: {},
		status: vi.fn((code: number) => {
			res._statusCode = code;
			return res as Response;
		}),
		json: vi.fn((data: any) => {
			res._json = data;
			return res as Response;
		}),
		send: vi.fn((data: any) => {
			res._data = data;
			return res as Response;
		}),
		setHeader: vi.fn((name: string, value: string) => {
			res._headers[name.toLowerCase()] = value;
			return res as Response;
		}),
	};
	return res;
}

function getHandler(method: string, pathPattern: string) {
	const stack = paperRouter.stack;
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

describe('paper routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('POST /:projectId/compile', () => {
		const handler = getHandler('post', '/:projectId/compile');

		it('returns 401 when user not authenticated', async () => {
			vi.mocked(getAuthedUser).mockReturnValue(null);

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Unauthorized' });
		});

		it('returns 404 when project not owned', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue(null);

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(404);
			expect(res._json).toEqual({ error: 'Project not found' });
		});

		it('returns 400 when paper.tex does not exist', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			// No files returned
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([])),
				})),
			});

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json).toEqual({ error: 'paper.tex is empty' });
		});

		it('returns 400 when paper.tex is empty', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						Promise.resolve([
							{ path: 'Final_Paper/paper.tex', type: 'tex', content: '   ' },
						]),
					),
				})),
			});

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json).toEqual({ error: 'paper.tex is empty' });
		});

		it('calls compileLatexToPdf with correct content', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			const latexContent = '\\documentclass{article}\\begin{document}Hello\\end{document}';
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						Promise.resolve([
							{ path: 'Final_Paper/paper.tex', type: 'tex', content: latexContent },
						]),
					),
				})),
			});

			const pdfBuffer = Buffer.from('%PDF-1.4 mock pdf content');
			mockCompileLatexToPdf.mockResolvedValue({ pdf: pdfBuffer, log: 'Compilation successful' });

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(mockCompileLatexToPdf).toHaveBeenCalledWith(latexContent);
		});

		it('returns PDF binary with correct content-type on success', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						Promise.resolve([
							{ path: 'Final_Paper/paper.tex', type: 'tex', content: '\\documentclass{article}' },
						]),
					),
				})),
			});

			const pdfBuffer = Buffer.from('%PDF-1.4 mock pdf content');
			mockCompileLatexToPdf.mockResolvedValue({ pdf: pdfBuffer, log: 'Success' });

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._headers['content-type']).toBe('application/pdf');
			expect(res._headers['content-disposition']).toBe('inline; filename="paper.pdf"');
			expect(res._data).toEqual(pdfBuffer);
		});

		it('returns 400 with error details on LaTeX compilation failure', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						Promise.resolve([
							{ path: 'Final_Paper/paper.tex', type: 'tex', content: '\\invalid{latex}' },
						]),
					),
				})),
			});

			const compileError = new LatexCompileError('LaTeX compilation failed', 'Error on line 1: Undefined control sequence');
			mockCompileLatexToPdf.mockRejectedValue(compileError);

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json.error).toBe('LaTeX compilation failed');
			expect(res._json.log).toContain('Undefined control sequence');
		});

		it('returns 500 on unexpected errors', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						Promise.resolve([
							{ path: 'Final_Paper/paper.tex', type: 'tex', content: '\\documentclass{article}' },
						]),
					),
				})),
			});

			mockCompileLatexToPdf.mockRejectedValue(new Error('Unexpected system error'));

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(500);
			expect(res._json.error).toBe('Unexpected system error');
		});
	});
});
