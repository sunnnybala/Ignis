import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Track insert calls for seeded files - hoisted for mock access
const { mockInsert, mockSelectResult, mockSelect } = vi.hoisted(() => {
	const mockSelectResult: any[] = [];

	const mockInsert = vi.fn(() => ({
		values: vi.fn(() => Promise.resolve()),
	}));

	const mockSelect = vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve(mockSelectResult)),
		})),
	}));

	return { mockInsert, mockSelectResult, mockSelect };
});

// Mock fs before importing the router (userGuideContent is loaded at module level)
vi.mock('fs', () => ({
	readFileSync: vi.fn(() => '# User Guide Content'),
}));

vi.mock('../utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../authz/ownership', () => ({
	getAuthedUser: vi.fn(),
	logAuthzDenied: vi.fn(),
}));

vi.mock('../db/userProfile', () => ({
	ensureUserProfile: vi.fn(() => Promise.resolve()),
}));

vi.mock('../db/client', () => ({
	db: {
		insert: mockInsert,
		select: mockSelect,
	},
}));

vi.mock('../db/schema', () => ({
	files: { projectId: 'projectId' },
	projects: { id: 'id', userId: 'userId' },
}));

import { projectsRouter } from './projects';
import { getAuthedUser } from '../authz/ownership';

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

function getHandler(method: string, pathPattern: string) {
	const stack = projectsRouter.stack;
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

describe('projects routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSelectResult.length = 0;
	});

	describe('GET /', () => {
		const handler = getHandler('get', '/');

		it('returns 401 when user not authenticated', async () => {
			vi.mocked(getAuthedUser).mockReturnValue(null);

			const req = createMockReq();
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Unauthorized' });
		});

		it('returns projects for authenticated user', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			mockSelectResult.push(
				{ id: 'proj-1', name: 'Project 1', userId: 'user-1' },
				{ id: 'proj-2', name: 'Project 2', userId: 'user-1' },
			);

			const req = createMockReq();
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toHaveLength(2);
			expect(res._json[0].name).toBe('Project 1');
		});
	});

	describe('POST /', () => {
		const handler = getHandler('post', '/');

		it('returns 400 when name is missing', async () => {
			const req = createMockReq({ body: {} });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json).toEqual({ error: 'name is required' });
		});

		it('returns 401 when user not authenticated', async () => {
			vi.mocked(getAuthedUser).mockReturnValue(null);

			const req = createMockReq({ body: { name: 'My Project' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Unauthorized' });
		});

		it('creates project and returns response', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });

			const req = createMockReq({ body: { name: 'My New Project' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(201);
			expect(res._json.name).toBe('My New Project');
			expect(res._json.userId).toBe('user-1');
			expect(res._json.id).toBeDefined();
		});
	});

	describe('GET /:id/files/tree', () => {
		const handler = getHandler('get', '/:id/files/tree');

		it('returns 401 when user not authenticated', async () => {
			vi.mocked(getAuthedUser).mockReturnValue(null);

			const req = createMockReq({ params: { id: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Unauthorized' });
		});

		it('returns 404 when project not owned', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			// First select (project check) returns empty
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([])),
				})),
			});

			const req = createMockReq({ params: { id: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(404);
			expect(res._json).toEqual({ error: 'Project not found' });
		});

		it('returns file tree for owned project', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			// Project exists
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{ id: 'proj-123' }])),
				})),
			});
			// Files with nested paths
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						Promise.resolve([
							{ id: 'f1', path: 'Research/lit_review.md', type: 'md' },
							{ id: 'f2', path: 'Design/design_plan.md', type: 'md' },
						]),
					),
				})),
			});

			const req = createMockReq({ params: { id: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toHaveLength(2);
		});
	});
});
