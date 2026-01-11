import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { logger } from '../utils/logger';
import { isDev } from '../utils/env';

type AuthedUser = {
	id: string;
	email?: string | null;
	role?: string | null;
};

function requiredEnv(name: string): string {
	const v = String(process.env[name] || '').trim();
	if (!v) throw new Error(`${name} is not set`);
	return v;
}

function getBearerToken(req: Request): string | null {
	const raw = req.get('authorization') || req.get('Authorization') || '';
	const m = /^\s*Bearer\s+(.+)\s*$/i.exec(raw);
	return m?.[1]?.trim() || null;
}

function classifyAuthError(err: unknown): 'missing_token' | 'expired' | 'invalid_token' {
	if (!err) return 'invalid_token';
	const name = String((err as any).name || '');
	// jose throws JWTExpired when token is expired
	if (name === 'JWTExpired') return 'expired';
	// Claim validation can include "exp" but name varies by jose version; keep it conservative
	const msg = String((err as any).message || '');
	if (/exp/i.test(msg) && /expired/i.test(msg)) return 'expired';
	return 'invalid_token';
}

function isPublicRoute(req: Request): boolean {
	const method = req.method.toUpperCase();
	const path = req.path || '';

	// Health should always be public.
	if (method === 'GET' && path === '/health') return true;

	// Modal runner callbacks (auth via job token in request body, NOT user JWT)
	// These must remain public so Modal can call them.
	if (method === 'POST' && /^\/jobs\/[^/]+\/complete$/.test(path)) return true;
	if (method === 'POST' && /^\/jobs\/[^/]+\/artifacts\/presign$/.test(path)) return true;

	return false;
}

const jwksUrl = requiredEnv('SUPABASE_JWKS_URL');
const issuer = requiredEnv('SUPABASE_JWT_ISSUER');
const audience = String(process.env.SUPABASE_JWT_AUD || 'authenticated').trim() || 'authenticated';
 const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
 // Some Supabase gateway deployments require an apikey header for JWKS endpoints (as seen in curl).
 // We use the anon key (public) rather than service role to avoid cross-project mixups.
 const JWKS = createRemoteJWKSet(
 	new URL(jwksUrl),
 	anonKey ? { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } } : undefined,
 );

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
	if (isPublicRoute(req)) return next();

	const requestId = req.requestId || null;
	const token = getBearerToken(req);
	if (!token) {
		logger.warn('auth.failure', { requestId, reason: 'missing_token' });
		return res.status(401).json({ error: 'Missing Authorization bearer token' });
	}

	try {
		const { payload } = await jwtVerify(token, JWKS, {
			issuer,
			audience,
		});

		const sub = typeof payload.sub === 'string' ? payload.sub : '';
		if (!sub) {
			logger.warn('auth.failure', { requestId, reason: 'invalid_token' });
			return res.status(401).json({ error: 'Invalid token (missing sub)' });
		}

		const email =
			typeof (payload as any).email === 'string'
				? String((payload as any).email)
				: typeof (payload as any).user_email === 'string'
					? String((payload as any).user_email)
					: null;
		const role = typeof (payload as any).role === 'string' ? String((payload as any).role) : null;

		const user: AuthedUser = { id: sub, email, role };
		req.user = user;

		logger.debug('auth.success', { requestId, userId: user.id });
		return next();
	} catch (err: unknown) {
		const reason = classifyAuthError(err);
		if (isDev()) {
			// Dev-only: decode token header/payload (WITHOUT trusting it) to diagnose env mismatch.
			// Never log the raw token.
			try {
				const hdr = decodeProtectedHeader(token);
				const jwt = decodeJwt(token);
				logger.debug('auth.failure.detail', {
					requestId,
					reason,
					errName: String((err as any)?.name || ''),
					errMessage: String((err as any)?.message || ''),
					token: {
						kid: typeof (hdr as any)?.kid === 'string' ? (hdr as any).kid : null,
						iss: typeof (jwt as any)?.iss === 'string' ? (jwt as any).iss : null,
						aud: (jwt as any)?.aud ?? null,
						sub: typeof (jwt as any)?.sub === 'string' ? (jwt as any).sub : null,
					},
					expected: { issuer, audience },
				});
			} catch {
				// ignore decode failures
			}
		}
		logger.warn('auth.failure', { requestId, reason });
		return res.status(401).json({ error: reason === 'expired' ? 'Token expired' : 'Invalid token' });
	}
}


