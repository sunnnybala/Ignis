import { eq } from 'drizzle-orm';
import { db } from './client';
import { users } from './schema';
import { logger } from '../utils/logger';

export type AuthenticatedUser = {
	id: string;
	email?: string | null;
	role?: string | null;
};

/**
 * Ensure there is a local "profile mirror" row for the Supabase user.
 *
 * Why:
 * - Our app DB is the system of record for projects/files/jobs (Railway Postgres).
 * - `projects.user_id` has a FK to `users.id`, so we must have a user row before creating projects.
 * - We do NOT use local passwords; Supabase Auth is the identity provider.
 *
 * Policy:
 * - `users.id` === Supabase JWT `sub`
 * - `users.email` stored for convenience; may be updated if it changes upstream
 * - `users.password_hash` is intentionally ignored (kept only for legacy schema compatibility).
 */
export async function ensureUserProfile(user: AuthenticatedUser): Promise<void> {
	const userId = String(user?.id || '').trim();
	if (!userId) throw new Error('ensureUserProfile: user.id is required');

	const email = typeof user?.email === 'string' ? user.email.trim() : '';
	if (!email) {
		// We keep email NOT NULL at the DB level; treat missing email as a hard error.
		throw new Error('ensureUserProfile: user.email is required');
	}

	const [existing] = await db.select().from(users).where(eq(users.id, userId));
	if (!existing) {
		// passwordHash is legacy and ignored, but schema requires it to be non-null.
		// Use a stable sentinel so we never confuse it with a real password hash.
		await db.insert(users).values({
			id: userId,
			email,
			passwordHash: 'supabase_auth',
		});
		logger.info('user.profile.created', { userId });
		return;
	}

	const patch: Partial<typeof users.$inferInsert> = {};
	const changed: string[] = [];

	if (existing.email !== email) {
		patch.email = email;
		changed.push('email');
	}

	// Optionally: store name/avatar once the frontend sends them or once we add a profile endpoint.
	// We intentionally do not overwrite name/avatar from token right now.

	if (changed.length > 0) {
		patch.updatedAt = new Date();
		await db.update(users).set(patch).where(eq(users.id, userId));
		logger.info('user.profile.updated', { userId, fields: changed });
	}
}


