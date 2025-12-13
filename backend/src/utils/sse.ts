import { Response } from 'express';

export interface SseConnection {
	write: (event: unknown) => void;
	close: () => void;
	/** force a heartbeat immediately */
	ping: () => void;
}

export function initSse(res: Response, heartbeatMs = 15000): SseConnection {
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache, no-transform');
	res.setHeader('Connection', 'keep-alive');
	// CORS handled globally; keep here minimal
	res.flushHeaders?.();

	const write = (event: unknown) => {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	};

	// Send heartbeat as SSE comment, not a data event
	const ping = () => {
		res.write(`: ping ${Date.now()}\n\n`);
	};

	const interval = setInterval(ping, heartbeatMs);
	const close = () => {
		clearInterval(interval);
		try {
			res.end();
		} catch {
			// ignore
		}
	};

	// send initial heartbeat so clients register stream
	ping();

	res.on('close', () => close());

	return { write, close, ping };
}


