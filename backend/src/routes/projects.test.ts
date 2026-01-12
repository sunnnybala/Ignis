import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Track insert calls for seeded files - hoisted for mock access
const { insertedValues, mockInsert, mockSelectResult, mockSelect } = vi.hoisted(() => {
	const insertedValues: any[] = [];
	const mockSelectResult: any[] = [];

	const mockInsert = vi.fn(() => ({
		values: vi.fn((val) => {
			insertedValues.push(val);
			return Promise.resolve();
		}),
	}));

	const mockSelect = vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve(mockSelectResult)),
		})),
	}));

	return { insertedValues, mockInsert, mockSelectResult, mockSelect };
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
		insertedValues.length = 0;
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

		it('returns empty array when user has no projects', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			mockSelectResult.length = 0;

			const req = createMockReq();
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual([]);
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

		it('returns 400 when name is empty string', async () => {
			const req = createMockReq({ body: { name: '' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json).toEqual({ error: 'name is required' });
		});

		it('returns 400 when name is whitespace only', async () => {
			const req = createMockReq({ body: { name: '   ' } });
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

		it('creates project and seeds 11 canonical files', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });

			const req = createMockReq({ body: { name: 'My New Project' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(201);
			expect(res._json.name).toBe('My New Project');
			expect(res._json.userId).toBe('user-1');
			expect(res._json.id).toBeDefined();

			// 1 project insert + 11 file inserts = 12 total inserts
			expect(mockInsert).toHaveBeenCalledTimes(12);

			// Verify the seeded file paths
			const filePaths = insertedValues.slice(1).map((v) => v.path);
			expect(filePaths).toContain('USER_GUIDE.md');
			expect(filePaths).toContain('Research/lit_review.txt');
			expect(filePaths).toContain('Research/novelty_assessment.txt');
			expect(filePaths).toContain('Research/refined_idea.txt');
			expect(filePaths).toContain('Results/results.txt');
			expect(filePaths).toContain('Design/design_plan.md');
			expect(filePaths).toContain('Design/dataset.json');
			expect(filePaths).toContain('Experimentation/experiment.py');
			expect(filePaths).toContain('Experimentation/requirements.txt');
			expect(filePaths).toContain('Final_Paper/paper.tex');
			expect(filePaths).toContain('Final_Paper/paper_metadata.json');
		});

		it('returns project object with id, name, and userId', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: 'test@test.com', role: 'admin' });

			const req = createMockReq({ body: { name: 'Test Project' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(201);
			expect(res._json).toHaveProperty('id');
			expect(res._json).toHaveProperty('name', 'Test Project');
			expect(res._json).toHaveProperty('userId', 'user-1');
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

		it('returns empty array for project with no files', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			// Project exists
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{ id: 'proj-123' }])),
				})),
			});
			// No files
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([])),
				})),
			});

			const req = createMockReq({ params: { id: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual([]);
		});

		it('builds correct tree structure for nested paths', async () => {
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
							{ id: 'f1', path: 'Research/lit_review.txt', type: 'txt' },
							{ id: 'f2', path: 'Research/novelty_assessment.txt', type: 'txt' },
							{ id: 'f3', path: 'Design/design_plan.md', type: 'md' },
						]),
					),
				})),
			});

			const req = createMockReq({ params: { id: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);

			// Should have 2 top-level directories: Research and Design
			expect(res._json).toHaveLength(2);

			const research = res._json.find((n: any) => n.name === 'Research');
			const design = res._json.find((n: any) => n.name === 'Design');

			expect(research).toBeDefined();
			expect(research.kind).toBe('dir');
			expect(research.children).toHaveLength(2);

			expect(design).toBeDefined();
			expect(design.kind).toBe('dir');
			expect(design.children).toHaveLength(1);
		});

		it('includes fileId and type for file nodes', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{ id: 'proj-123' }])),
				})),
			});
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						Promise.resolve([{ id: 'file-abc', path: 'test.py', type: 'py' }]),
					),
				})),
			});

			const req = createMockReq({ params: { id: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toHaveLength(1);
			expect(res._json[0]).toEqual({
				kind: 'file',
				name: 'test.py',
				path: 'test.py',
				fileId: 'file-abc',
				type: 'py',
			});
		});

		it('handles deeply nested paths', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{ id: 'proj-123' }])),
				})),
			});
			mockSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						Promise.resolve([
							{ id: 'f1', path: 'a/b/c/deep.txt', type: 'txt' },
						]),
					),
				})),
			});

			const req = createMockReq({ params: { id: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toHaveLength(1);
			expect(res._json[0].name).toBe('a');
			expect(res._json[0].kind).toBe('dir');
			expect(res._json[0].children[0].name).toBe('b');
			expect(res._json[0].children[0].children[0].name).toBe('c');
			expect(res._json[0].children[0].children[0].children[0].name).toBe('deep.txt');
		});
	});
});
