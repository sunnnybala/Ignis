type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function envLevel(): LogLevel {
	const raw = String(process.env.LOG_LEVEL || '').trim().toLowerCase();
	if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
	// Default: be quiet in prod, chatty in dev
	return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
}

function shouldLog(level: LogLevel): boolean {
	return LEVEL_ORDER[level] >= LEVEL_ORDER[envLevel()];
}

function safeJson(x: unknown): string {
	try {
		return JSON.stringify(x);
	} catch {
		return '"[unserializable]"';
	}
}

function nowIso(): string {
	return new Date().toISOString();
}

function emit(level: LogLevel, event: string, fields?: Record<string, unknown>) {
	if (!shouldLog(level)) return;
	const payload = {
		ts: nowIso(),
		level,
		event,
		...(fields || {}),
	};
	const line = safeJson(payload);
	// Keep warn/error on their respective streams for infra log routing.
	if (level === 'warn') {
		// eslint-disable-next-line no-console
		console.warn(line);
		return;
	}
	if (level === 'error') {
		// eslint-disable-next-line no-console
		console.error(line);
		return;
	}
	// eslint-disable-next-line no-console
	console.log(line);
}

export const logger = {
	debug(event: string, fields?: Record<string, unknown>) {
		emit('debug', event, fields);
	},
	info(event: string, fields?: Record<string, unknown>) {
		emit('info', event, fields);
	},
	warn(event: string, fields?: Record<string, unknown>) {
		emit('warn', event, fields);
	},
	error(event: string, fields?: Record<string, unknown>) {
		emit('error', event, fields);
	},
};


