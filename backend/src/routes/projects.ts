import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';

import { db } from '../db/client';
import { files, projects } from '../db/schema';
import { ensureUserProfile } from '../db/userProfile';
import { getAuthedUser, logAuthzDenied } from '../authz/ownership';
import { logger } from '../utils/logger';

// Load user guide content at startup for seeding new projects
const USER_GUIDE_PATH = join(__dirname, '../assets/USER_GUIDE.md');
const userGuideContent = readFileSync(USER_GUIDE_PATH, 'utf-8');

export const projectsRouter = Router();

// GET /projects -> list projects for current authenticated user
projectsRouter.get('/', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		await ensureUserProfile(user);
		const rows = await db.select().from(projects).where(eq(projects.userId, user.id));
		return res.status(200).json(rows);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to list projects';
		return res.status(500).json({ error: message });
	}
});

// POST /projects { name }
projectsRouter.post('/', async (req, res) => {
	try {
		const traceId = crypto.randomUUID();
		const name = String(req.body?.name || '').trim();
		if (!name) return res.status(400).json({ error: 'name is required' });

		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		await ensureUserProfile(user);
		const projectId = crypto.randomUUID();
		await db.insert(projects).values({ id: projectId, userId: user.id, name });

		// Seed default tree
		// IMPORTANT: Artifact files must be empty on creation (no default templates).
		// These paths are the canonical Ignis artifact structure used by the Mastra router/workflows.
		// USER_GUIDE.md is the exception - it contains onboarding documentation.
		const seed: Array<{ path: string; type: typeof files.$inferInsert.type; content: string }> = [
			{ path: 'USER_GUIDE.md', type: 'md', content: userGuideContent },
			{ path: 'Research/lit_review.md', type: 'md', content: '' },
			{ path: 'Research/novelty_assessment.md', type: 'md', content: '' },
			{ path: 'Research/refined_idea.md', type: 'md', content: '' },
			{ path: 'Results/results.txt', type: 'txt', content: '' },
			{ path: 'Design/design_plan.md', type: 'md', content: '' },
			// Stored as 'txt' in DB (text file semantics); content must be empty.
			{ path: 'Design/dataset.json', type: 'txt', content: '' },
			{ path: 'Experimentation/experiment.py', type: 'py', content: '' },
			{ path: 'Experimentation/requirements.txt', type: 'txt', content: '' },
			{ path: 'Final_Paper/paper.tex', type: 'tex', content: '' },
			{ path: 'Final_Paper/paper_metadata.json', type: 'txt', content: '' },
		];
		logger.info('projects.create.seed_start', {
			traceId,
			projectId,
			seedPaths: seed.map((s) => s.path),
		});
		for (const f of seed) {
			await db
				.insert(files)
				.values({ projectId, path: f.path, type: f.type, content: f.content });
		}
		logger.info('projects.create.seed_complete', { traceId, projectId });

		return res.status(201).json({ id: projectId, name, userId: user.id });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to create project';
		return res.status(500).json({ error: message });
	}
});

// GET /projects/:id/files/tree
projectsRouter.get('/:id/files/tree', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const projectId = String(req.params.id);

		// Minimal AuthZ: ensure the project belongs to the requesting user.
		// (This prevents cross-user file tree leakage now that auth is enabled globally.)
		const [proj] = await db
			.select({ id: projects.id })
			.from(projects)
			.where(and(eq(projects.id, projectId), eq(projects.userId, user.id)));
		if (!proj) {
			logAuthzDenied(req, { projectId });
			return res.status(404).json({ error: 'Project not found' });
		}

		const rows = await db.select().from(files).where(eq(files.projectId, projectId));
		// Build a simple tree
		type TreeNode = { kind: 'dir' | 'file'; name: string; path: string; children?: TreeNode[]; fileId?: string; type?: string };
		const root: TreeNode = { name: '', kind: 'dir', path: '', children: [] };
		for (const row of rows) {
			const parts = row.path.split('/');
			let node = root;
			let currentPath = '';
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				if (i === parts.length - 1) {
					node.children!.push({
						kind: 'file',
						name: part,
						path: currentPath,
						fileId: row.id,
						type: row.type,
					});
				} else {
					let next = node.children!.find((c) => c.kind === 'dir' && c.name === part) as TreeNode | undefined;
					if (!next) {
						next = { kind: 'dir', name: part, path: currentPath, children: [] };
						node.children!.push(next);
					}
					node = next;
				}
			}
		}
		return res.status(200).json(root.children);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to fetch tree';
		return res.status(500).json({ error: message });
	}
});


