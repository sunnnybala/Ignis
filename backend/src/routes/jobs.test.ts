import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Hoisted mocks for database operations
const { mockJobsData, mockFilesData, mockDbInsert, mockDbSelect, mockDbUpdate, mockFetch, mockGetSignedUploadUrl } = vi.hoisted(() => {
	const mockJobsData: any[] = [];
	const mockFilesData: any[] = [];

	const mockDbInsert = vi.fn(() => ({
		values: vi.fn(() => ({
			returning: vi.fn(() => Promise.resolve([{ createdAt: new Date() }])),
		})),
	}));

	const mockDbSelect = vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve(mockJobsData)),
		})),
	}));

	const mockDbUpdate = vi.fn(() => ({
		set: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(() => Promise.resolve([{ id: 'job-1' }])),
			})),
		})),
	}));

	const mockFetch = vi.fn();
	const mockGetSignedUploadUrl = vi.fn();

	return { mockJobsData, mockFilesData, mockDbInsert, mockDbSelect, mockDbUpdate, mockFetch, mockGetSignedUploadUrl };
});

// Set env vars before module imports
vi.hoisted(() => {
	process.env.MODAL_RUNNER_URL = 'https://modal.example.com/run';
	process.env.PUBLIC_BASE_URL = 'https://api.example.com';
});

vi.mock('../utils/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../authz/ownership', () => ({
	getAuthedUser: vi.fn(),
	getOwnedProject: vi.fn(),
	getOwnedJob: vi.fn(),
	logAuthzDenied: vi.fn(),
}));

vi.mock('../db/client', () => ({
	db: {
		insert: mockDbInsert,
		select: mockDbSelect,
		update: mockDbUpdate,
	},
}));

vi.mock('../db/schema', () => ({
	jobs: { id: 'id', projectId: 'projectId', status: 'status', createdAt: 'createdAt' },
	files: { id: 'id', projectId: 'projectId', path: 'path' },
}));

vi.mock('../storage/supabaseAdapter', () => ({
	getSignedUploadUrl: mockGetSignedUploadUrl,
}));

vi.mock('undici', () => ({
	fetch: mockFetch,
}));

import { jobsRouter } from './jobs';
import { getAuthedUser, getOwnedProject, getOwnedJob } from '../authz/ownership';

function createMockReq(overrides: Partial<Request> = {}): Partial<Request> {
	return {
		params: {},
		query: {},
		body: {},
		requestId: 'test-req-id',
		get: vi.fn(() => 'localhost:4000'),
		protocol: 'http',
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
	const stack = jobsRouter.stack;
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

describe('jobs routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockJobsData.length = 0;
		mockFilesData.length = 0;
	});

	describe('POST /experiment/:projectId/run', () => {
		const handler = getHandler('post', '/experiment/:projectId/run');

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

		// Note: MODAL_RUNNER_URL is read at module load time, so this test is skipped.
		// The check exists in the code (lines 115-117) but cannot be unit tested without module reset.

		it('returns 400 when experiment.py is empty', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			// Mock db.select for files - no experiment.py content
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([
						{ path: 'Experimentation/experiment.py', type: 'py', content: '' },
						{ path: 'Design/dataset.json', type: 'txt', content: '{"kaggle":{}}' },
					])),
				})),
			});

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json.error).toBe('Experimentation/experiment.py is empty');
		});

		it('returns 400 when dataset.json is empty', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([
						{ path: 'Experimentation/experiment.py', type: 'py', content: 'print("hello")' },
						{ path: 'Design/dataset.json', type: 'txt', content: '' },
					])),
				})),
			});

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json.error).toBe('Design/dataset.json is empty');
		});

		it('calls Modal runner and returns jobId on success', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([
						{ path: 'Experimentation/experiment.py', type: 'py', content: 'print("hello")' },
						{ path: 'Design/dataset.json', type: 'txt', content: '{"kaggle":{"dataset":"test"}}' },
						{ path: 'Experimentation/requirements.txt', type: 'txt', content: '' },
					])),
				})),
			});

			mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json.jobId).toBeDefined();
			expect(res._json.runId).toBeDefined();
			expect(mockFetch).toHaveBeenCalled();
		});

		it('returns 502 when Modal runner fails', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([
						{ path: 'Experimentation/experiment.py', type: 'py', content: 'print("hello")' },
						{ path: 'Design/dataset.json', type: 'txt', content: '{"kaggle":{"dataset":"test"}}' },
					])),
				})),
			});

			mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('Internal Error') });

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(502);
			expect(res._json.error).toBe('Modal runner rejected');
		});
	});

	describe('POST /paper/:projectId/compile', () => {
		const handler = getHandler('post', '/paper/:projectId/compile');

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

		it('creates job with type paper_compile', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json.jobId).toBeDefined();
			expect(mockDbInsert).toHaveBeenCalled();
		});
	});

	describe('POST /:jobId/artifacts/presign', () => {
		const handler = getHandler('post', '/:jobId/artifacts/presign');

		it('returns 404 when job not found', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([])),
				})),
			});

			const req = createMockReq({ params: { jobId: 'job-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(404);
			expect(res._json).toEqual({ error: 'Job not found' });
		});

		it('returns 401 when job token is invalid', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{
						id: 'job-123',
						projectId: 'proj-1',
						type: 'experiment_run',
						metadata: { jobToken: 'secret-token' },
					}])),
				})),
			});

			const req = createMockReq({
				params: { jobId: 'job-123' },
				body: { token: 'wrong-token', items: [{ fileName: 'test.png' }] },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Invalid token' });
		});

		it('returns 400 when no items provided', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{
						id: 'job-123',
						projectId: 'proj-1',
						type: 'experiment_run',
						metadata: { jobToken: 'secret-token', runId: 'run-123' },
						createdAt: new Date(),
					}])),
				})),
			});

			const req = createMockReq({
				params: { jobId: 'job-123' },
				body: { token: 'secret-token', items: [] },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json).toEqual({ error: 'No items provided' });
		});

		it('returns 400 for disallowed file extensions', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{
						id: 'job-123',
						projectId: 'proj-1',
						type: 'experiment_run',
						metadata: { jobToken: 'secret-token', runId: 'run-123' },
						createdAt: new Date(),
					}])),
				})),
			});

			const req = createMockReq({
				params: { jobId: 'job-123' },
				body: { token: 'secret-token', items: [{ fileName: 'malware.exe' }] },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(400);
			expect(res._json.error).toContain('Disallowed artifact extension');
		});

		it('allows .png and .csv for experiment jobs', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{
						id: 'job-123',
						projectId: 'proj-1',
						type: 'experiment_run',
						metadata: { jobToken: 'secret-token', runId: 'run-123' },
						createdAt: new Date(),
					}])),
				})),
			});

			mockGetSignedUploadUrl.mockResolvedValue({ key: 'key', signedUrl: 'https://signed.url', token: 'tok' });

			const req = createMockReq({
				params: { jobId: 'job-123' },
				body: {
					token: 'secret-token',
					items: [
						{ fileName: 'plot.png', mimeType: 'image/png' },
						{ fileName: 'data.csv', mimeType: 'text/csv' },
					],
				},
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json.uploads).toHaveLength(2);
		});
	});

	describe('POST /:jobId/complete', () => {
		const handler = getHandler('post', '/:jobId/complete');

		it('returns 404 when job not found', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([])),
				})),
			});

			const req = createMockReq({ params: { jobId: 'job-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(404);
			expect(res._json).toEqual({ error: 'Job not found' });
		});

		it('returns 401 when job token is invalid', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{
						id: 'job-123',
						projectId: 'proj-1',
						type: 'experiment_run',
						metadata: { jobToken: 'secret-token', runId: 'run-123' },
						createdAt: new Date(),
					}])),
				})),
			});

			const req = createMockReq({
				params: { jobId: 'job-123' },
				body: { token: 'wrong-token', exitCode: 0, resultsText: '' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Invalid token' });
		});

		it('updates job status to completed for exitCode=0', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{
						id: 'job-123',
						projectId: 'proj-1',
						type: 'experiment_run',
						metadata: { jobToken: 'secret-token', runId: 'run-123' },
						createdAt: new Date(),
					}])),
				})),
			});

			// Mock select for upsert check
			mockDbSelect.mockReturnValue({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([])),
				})),
			});

			const req = createMockReq({
				params: { jobId: 'job-123' },
				body: { token: 'secret-token', exitCode: 0, resultsText: 'Success!' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ ok: true });
		});

		it('updates job status to failed for exitCode!=0', async () => {
			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([{
						id: 'job-123',
						projectId: 'proj-1',
						type: 'experiment_run',
						metadata: { jobToken: 'secret-token', runId: 'run-123' },
						createdAt: new Date(),
					}])),
				})),
			});

			mockDbSelect.mockReturnValue({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([])),
				})),
			});

			const req = createMockReq({
				params: { jobId: 'job-123' },
				body: { token: 'secret-token', exitCode: 1, resultsText: 'Error occurred' },
			});
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ ok: true });
		});
	});

	describe('GET /:jobId', () => {
		const handler = getHandler('get', '/:jobId');

		it('returns 401 when user not authenticated', async () => {
			vi.mocked(getAuthedUser).mockReturnValue(null);

			const req = createMockReq({ params: { jobId: 'job-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(401);
			expect(res._json).toEqual({ error: 'Unauthorized' });
		});

		it('returns 404 when job not found', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedJob).mockResolvedValue(null);

			const req = createMockReq({ params: { jobId: 'job-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(404);
			expect(res._json).toEqual({ error: 'Job not found' });
		});

		it('returns job metadata', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedJob).mockResolvedValue({
				id: 'job-123',
				projectId: 'proj-1',
				type: 'experiment_run',
				status: 'completed',
			});

			const req = createMockReq({ params: { jobId: 'job-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json.id).toBe('job-123');
			expect(res._json.status).toBe('completed');
		});
	});

	describe('POST /paper/:projectId/generate', () => {
		const handler = getHandler('post', '/paper/:projectId/generate');

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

		it('calls external service and upserts paper.tex on success', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([
						{ path: 'Design/design_plan.md', type: 'md', content: '# Design' },
						{ path: 'Experimentation/experiment.py', type: 'py', content: 'print("test")' },
						{ path: 'Results/run-1/results.txt', type: 'txt', content: 'Results here' },
					])),
				})),
			});

			mockFetch.mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('\\documentclass{article}'),
			});

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(200);
			expect(res._json).toEqual({ ok: true });
			expect(mockFetch).toHaveBeenCalledWith(
				'https://scientist.up.railway.app/create_paper',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('returns 502 when external service fails', async () => {
			vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
			vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });

			mockDbSelect.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: vi.fn(() => Promise.resolve([
						{ path: 'Design/design_plan.md', type: 'md', content: '# Design' },
						{ path: 'Experimentation/experiment.py', type: 'py', content: 'print("test")' },
					])),
				})),
			});

			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				text: () => Promise.resolve('Service error'),
			});

			const req = createMockReq({ params: { projectId: 'proj-123' } });
			const res = createMockRes();

			await handler(req as Request, res as Response);

			expect(res._statusCode).toBe(502);
			expect(res._json.error).toBe('Paper generation failed');
		});
	});
});
