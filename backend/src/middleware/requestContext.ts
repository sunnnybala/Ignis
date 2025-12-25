import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';

function headerName(): string {
	// optional override; defaults to the common proxy header
	const raw = String(process.env.REQUEST_ID_HEADER || 'x-request-id').trim().toLowerCase();
	return raw || 'x-request-id';
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
	const start = Date.now();
	const ridHeader = headerName();
	const fromHeader = req.get(ridHeader);
	const requestId = (fromHeader && fromHeader.trim()) || crypto.randomUUID();

	req.requestId = requestId;
	res.setHeader('x-request-id', requestId);

	// Log request start (debug) as requested. userId may not exist yet (auth runs after this).
	logger.debug('http.request.start', {
		requestId,
		method: req.method,
		path: req.originalUrl || req.url,
		origin: req.get('origin') || '',
		userId: req.user?.id || null,
	});

	res.on('finish', () => {
		logger.debug('http.request.end', {
			requestId,
			method: req.method,
			path: req.originalUrl || req.url,
			statusCode: res.statusCode,
			durationMs: Date.now() - start,
			userId: req.user?.id || null,
		});
	});

	next();
}


