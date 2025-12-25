import { and, eq } from 'drizzle-orm';
import type { Request } from 'express';

import { db } from '../db/client';
import { files, jobs, projects } from '../db/schema';
import { logger } from '../utils/logger';

export type AuthedUser = { id: string; email?: string | null; role?: string | null };

export function getAuthedUser(req: Request): AuthedUser | null {
	const u: any = (req as any).user;
	if (!u || typeof u.id !== 'string' || !u.id.trim()) return null;
	return {
		id: String(u.id),
		email: typeof u.email === 'string' ? u.email : null,
		role: typeof u.role === 'string' ? u.role : null,
	};
}

export function logAuthzDenied(req: Request, details: Record<string, unknown>) {
	logger.warn('authz.denied', {
		requestId: (req as any).requestId || null,
		route: `${req.method.toUpperCase()} ${(req as any).originalUrl || req.url || ''}`,
		userId: (req as any).user?.id || null,
		...details,
	});
}

/**
 * Returns the project row if owned by user, else null.
 */
export async function getOwnedProject(projectId: string, userId: string) {
	const [proj] = await db
		.select()
		.from(projects)
		.where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
	return proj ?? null;
}

/**
 * Returns the file row if it belongs to a project owned by user, else null.
 */
export async function getOwnedFile(fileId: string, userId: string) {
	const [row] = await db
		.select({ file: files })
		.from(files)
		.innerJoin(projects, eq(files.projectId, projects.id))
		.where(and(eq(files.id, fileId), eq(projects.userId, userId)));
	return row?.file ?? null;
}

/**
 * Returns the job row if it belongs to a project owned by user, else null.
 */
export async function getOwnedJob(jobId: string, userId: string) {
	const [row] = await db
		.select({ job: jobs })
		.from(jobs)
		.innerJoin(projects, eq(jobs.projectId, projects.id))
		.where(and(eq(jobs.id, jobId), eq(projects.userId, userId)));
	return row?.job ?? null;
}


