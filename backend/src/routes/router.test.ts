import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Hoisted mocks
const { mockDbSelect, mockSseWrite, mockSseClose, mockMastraGetAgent } = vi.hoisted(() => {
	const mockDbSelect = vi.fn();
	const mockSseWrite = vi.fn();
	const mockSseClose = vi.fn();
	const mockMastraGetAgent = vi.fn();

	return { mockDbSelect, mockSseWrite, mockSseClose, mockMastraGetAgent };
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
	},
}));

vi.mock('../db/schema', () => ({
	files: { projectId: 'projectId', path: 'path', content: 'content' },
}));

vi.mock('../utils/sse', () => ({
	initSse: vi.fn(() => ({
		write: mockSseWrite,
		close: mockSseClose,
	})),
}));

vi.mock('../mastra', () => ({
	mastra: {
		getAgent: mockMastraGetAgent,
	},
}));

import { routerRouter } from './router';
import { getAuthedUser, getOwnedProject } from '../authz/ownership';

function createMockReq(overrides: Partial<Request> = {}): Partial<Request> {
	return {
		params: {},
		query: {},
		body: {},
		...overrides,
	};
}

function createMockRes(): Partial<Response> {
	return {};
}

function getHandler(method: string, pathPattern: string) {
	const stack = routerRouter.stack;
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

// Helper to mock files with specific non-empty states
function mockFilesNonEmpty(fileStates: Record<string, boolean>) {
	const rows = Object.entries(fileStates)
		.filter(([, isNonEmpty]) => isNonEmpty)
		.map(([path]) => ({ path, content: 'non-empty content' }));

	mockDbSelect.mockReturnValue({
		from: vi.fn(() => ({
			where: vi.fn(() => Promise.resolve(rows)),
		})),
	});
}

// Create a mock agent that resolves immediately
function createMockAgent(resultText = 'Agent response') {
	return {
		network: vi.fn(() => ({
			[Symbol.asyncIterator]: async function* () {
				yield { type: 'network-execution-event-step-finish', payload: { result: { text: resultText } } };
			},
		})),
	};
}

describe('router routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('POST /:projectId/chat', () => {
		const handler = getHandler('post', '/:projectId/chat');

		describe('authentication', () => {
			it('returns error when user not authenticated', async () => {
				vi.mocked(getAuthedUser).mockReturnValue(null);

				const req = createMockReq({ params: { projectId: 'proj-123' } });
				const res = createMockRes();

				await handler(req as Request, res as Response);

				expect(mockSseWrite).toHaveBeenCalledWith({ type: 'error', message: 'Unauthorized' });
				expect(mockSseClose).toHaveBeenCalled();
			});

			it('returns error when project not owned', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue(null);

				const req = createMockReq({ params: { projectId: 'proj-123' } });
				const res = createMockRes();

				await handler(req as Request, res as Response);

				expect(mockSseWrite).toHaveBeenCalledWith({ type: 'error', message: 'Project not found' });
				expect(mockSseClose).toHaveBeenCalled();
			});
		});

		describe('file state computation', () => {
			it('detects research phase incomplete (no files)', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				mockFilesNonEmpty({});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({ params: { projectId: 'proj-123' }, body: { message: 'hello' } });
				const res = createMockRes();

				await handler(req as Request, res as Response);

				// Verify agent was called with allowed primitives including noveltyRefineWorkflow
				expect(mockAgent.network).toHaveBeenCalled();
				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				expect(routerStatus.allowedPrimitiveIds).toContain('noveltyRefineWorkflow');
				expect(routerStatus.booleans.research_files_ready).toBe(false);
			});

			it('detects research phase complete (3 research files non-empty)', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				mockFilesNonEmpty({
					'Research/lit_review.md': true,
					'Research/novelty_assessment.md': true,
					'Research/refined_idea.md': true,
				});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({ params: { projectId: 'proj-123' }, body: { message: 'hello' } });
				const res = createMockRes();

				await handler(req as Request, res as Response);

				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				expect(routerStatus.booleans.research_files_ready).toBe(true);
				expect(routerStatus.allowedPrimitiveIds).toContain('planImplementWorkflow');
				expect(routerStatus.allowedPrimitiveIds).toContain('researchAgent');
			});

			it('detects implementation phase complete (3 impl files non-empty)', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				mockFilesNonEmpty({
					'Research/lit_review.md': true,
					'Research/novelty_assessment.md': true,
					'Research/refined_idea.md': true,
					'Design/design_plan.md': true,
					'Design/dataset.json': true,
					'Experimentation/experiment.py': true,
				});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({ params: { projectId: 'proj-123' }, body: { message: 'hello' } });
				const res = createMockRes();

				await handler(req as Request, res as Response);

				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				expect(routerStatus.booleans.implementation_files_ready).toBe(true);
				expect(routerStatus.allowedPrimitiveIds).toContain('paperPlanWriteWorkflow');
				expect(routerStatus.allowedPrimitiveIds).toContain('planImplementAgent');
			});

			it('detects paper phase complete (paper.tex exists)', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				mockFilesNonEmpty({
					'Research/lit_review.md': true,
					'Research/novelty_assessment.md': true,
					'Research/refined_idea.md': true,
					'Design/design_plan.md': true,
					'Design/dataset.json': true,
					'Experimentation/experiment.py': true,
					'Final_Paper/paper.tex': true,
				});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({ params: { projectId: 'proj-123' }, body: { message: 'hello' } });
				const res = createMockRes();

				await handler(req as Request, res as Response);

				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				expect(routerStatus.booleans.paper_files_ready).toBe(true);
				expect(routerStatus.allowedPrimitiveIds).toContain('paperWritingAgent');
			});
		});

		describe('overwrite confirmation', () => {
			it('parses "CONFIRM OVERWRITE noveltyRefineWorkflow" correctly', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				mockFilesNonEmpty({
					'Research/lit_review.md': true,
					'Research/novelty_assessment.md': true,
					'Research/refined_idea.md': true,
				});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({
					params: { projectId: 'proj-123' },
					body: { message: 'CONFIRM OVERWRITE noveltyRefineWorkflow' },
				});
				const res = createMockRes();

				await handler(req as Request, res as Response);

				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				// When confirmed, only that workflow is allowed
				expect(routerStatus.allowedPrimitiveIds).toEqual(['noveltyRefineWorkflow']);
			});

			it('parses "CONFIRM OVERWRITE planImplementWorkflow" correctly when research is complete', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				mockFilesNonEmpty({
					'Research/lit_review.md': true,
					'Research/novelty_assessment.md': true,
					'Research/refined_idea.md': true,
					'Design/design_plan.md': true,
					'Design/dataset.json': true,
					'Experimentation/experiment.py': true,
				});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({
					params: { projectId: 'proj-123' },
					body: { message: 'CONFIRM OVERWRITE planImplementWorkflow' },
				});
				const res = createMockRes();

				await handler(req as Request, res as Response);

				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				expect(routerStatus.allowedPrimitiveIds).toEqual(['planImplementWorkflow']);
			});
		});

		describe('phase gating', () => {
			it('blocks implementation without completed research', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				// Only partial research files
				mockFilesNonEmpty({
					'Research/lit_review.md': true,
					// novelty and refined_idea are missing
				});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({ params: { projectId: 'proj-123' }, body: { message: 'hello' } });
				const res = createMockRes();

				await handler(req as Request, res as Response);

				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				// planImplementWorkflow should NOT be allowed since research isn't complete
				expect(routerStatus.allowedPrimitiveIds).not.toContain('planImplementWorkflow');
				expect(routerStatus.allowedPrimitiveIds).toContain('noveltyRefineWorkflow');
				// Since research has run once, researchAgent is available for edits
				expect(routerStatus.allowedPrimitiveIds).toContain('researchAgent');
			});

			it('blocks paper without completed implementation', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				mockFilesNonEmpty({
					'Research/lit_review.md': true,
					'Research/novelty_assessment.md': true,
					'Research/refined_idea.md': true,
					'Design/design_plan.md': true,
					// dataset and experiment are missing
				});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({ params: { projectId: 'proj-123' }, body: { message: 'hello' } });
				const res = createMockRes();

				await handler(req as Request, res as Response);

				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				// paperPlanWriteWorkflow should NOT be allowed
				expect(routerStatus.allowedPrimitiveIds).not.toContain('paperPlanWriteWorkflow');
				// planImplementWorkflow should be allowed (research complete, impl not complete)
				expect(routerStatus.allowedPrimitiveIds).toContain('planImplementWorkflow');
			});

			it('blocks implementation overwrite confirmation without completed research', async () => {
				vi.mocked(getAuthedUser).mockReturnValue({ id: 'user-1', email: null, role: null });
				vi.mocked(getOwnedProject).mockResolvedValue({ id: 'proj-123' });
				// Research not complete
				mockFilesNonEmpty({
					'Research/lit_review.md': true,
				});

				const mockAgent = createMockAgent();
				mockMastraGetAgent.mockReturnValue(mockAgent);

				const req = createMockReq({
					params: { projectId: 'proj-123' },
					body: { message: 'CONFIRM OVERWRITE planImplementWorkflow' },
				});
				const res = createMockRes();

				await handler(req as Request, res as Response);

				const networkCall = mockAgent.network.mock.calls[0];
				const requestContext = networkCall[1].requestContext;
				const routerStatus = requestContext.get('routerStatus');

				// Even with confirmation, can't skip phase gates
				expect(routerStatus.allowedPrimitiveIds).toEqual([]);
			});
		});
	});
});
