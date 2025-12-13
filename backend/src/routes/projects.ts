import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { files, projects, users } from '../db/schema';

export const projectsRouter = Router();

async function ensureDevUser() {
	const devEmail = 'dev@ignis.local';
	const [u] = await db.select().from(users).where(eq(users.email, devEmail));
	if (u) return u;
	const id = crypto.randomUUID();
	await db.insert(users).values({ id, email: devEmail, passwordHash: 'dev', name: 'Dev User' });
	const [user] = await db.select().from(users).where(eq(users.id, id));
	return user;
}

// GET /projects -> list projects for current user (dev user for now)
projectsRouter.get('/', async (_req, res) => {
	try {
		const user = await ensureDevUser();
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
		const name = String(req.body?.name || '').trim();
		if (!name) return res.status(400).json({ error: 'name is required' });

		// TODO: replace dev user with authenticated user
		const user = await ensureDevUser();
		const projectId = crypto.randomUUID();
		await db.insert(projects).values({ id: projectId, userId: user.id, name });

		// Seed default tree
		const seed: Array<{ path: string; type: typeof files.$inferInsert.type; content?: string }>= [
			{ path: 'Lit Review/papers.txt', type: 'txt', content: '' },
			{ path: 'Lit Review/review.md', type: 'md', content: '' },
			{ path: 'Design/design_plan.md', type: 'md', content: '' },
			{ path: 'Experimentation/experiment.py', type: 'py', content: '' },
			{ path: 'Results/results.txt', type: 'txt', content: '' },
			{ path: 'Final Paper/paper.tex', type: 'tex', content: '' },
		];
		for (const f of seed) {
			await db
				.insert(files)
				.values({ projectId, path: f.path, type: f.type, content: f.content ?? '' });
		}

		return res.status(201).json({ id: projectId, name, userId: user.id });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to create project';
		return res.status(500).json({ error: message });
	}
});

// GET /projects/:id/files/tree
projectsRouter.get('/:id/files/tree', async (req, res) => {
	try {
		const projectId = String(req.params.id);
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


