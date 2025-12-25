import 'express';

declare global {
	namespace Express {
		interface Request {
			/** Correlation id for logs; returned as response header x-request-id */
			requestId?: string;
			/** Authenticated Supabase user derived from JWT */
			user?: {
				id: string;
				email?: string | null;
				role?: string | null;
			};
		}
	}
}

export {};


