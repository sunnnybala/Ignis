import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { files } from '../db/schema';
import { getSignedUrl } from '../storage/supabaseAdapter';
import { getAuthedUser, getOwnedFile, logAuthzDenied } from '../authz/ownership';

export const filesRouter = Router();

// GET /files/:id -> metadata + content (for text types)
filesRouter.get('/:id', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const id = String(req.params.id);
		const file = await getOwnedFile(id, user.id);
		if (!file) {
			logAuthzDenied(req, { fileId: id });
			return res.status(404).json({ error: 'File not found' });
		}
		return res.status(200).json(file);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to fetch file';
		return res.status(500).json({ error: message });
	}
});

// GET /files/:id/url?expires=300
filesRouter.get('/:id/url', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const expires = Math.min(parseInt(String(req.query.expires ?? '300'), 10) || 300, 3600);
		const id = String(req.params.id);
		const file = await getOwnedFile(id, user.id);
		if (!file) {
			logAuthzDenied(req, { fileId: id });
			return res.status(404).json({ error: 'File not found' });
		}

		if (!file.storageKey) {
			return res.status(400).json({ error: 'File is not stored in object storage' });
		}

		const signedUrl = await getSignedUrl(file.storageKey, expires);
		return res.status(200).json({ signedUrl, expires });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to sign URL';
		return res.status(500).json({ error: message });
	}
});

// PUT /files/:id -> update text content (txt, md, py, tex)
filesRouter.put('/:id', async (req, res) => {
	try {
		const user = getAuthedUser(req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const id = String(req.params.id);
		const file = await getOwnedFile(id, user.id);
		if (!file) {
			logAuthzDenied(req, { fileId: id });
			return res.status(404).json({ error: 'File not found' });
		}
		if (!['txt', 'md', 'py', 'tex'].includes(file.type)) {
			return res.status(400).json({ error: 'Editing only allowed for text-based files' });
		}
		const content = String(req.body?.content ?? '');
		await db
			.update(files)
			.set({ content })
			.where(eq(files.id, id));
		return res.status(200).json({ ok: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Failed to update file';
		return res.status(500).json({ error: message });
	}
});


