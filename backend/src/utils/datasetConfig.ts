export type DatasetConfig = {
	source: 'kaggle';
	kaggle: {
		dataset: string; // "owner/dataset"
		unzip?: boolean;
		files?: string[];
		verifiedAt?: string; // ISO timestamp when validation occurred
		totalSizeBytes?: number; // total dataset size from validation
	};
	layout?: {
		subdir?: string;
		dataPattern?: 'flat' | 'has_subdirs' | 'unknown'; // detected layout pattern
	};
	notes?: string;
};

export type DatasetConfigParseResult =
	| { ok: true; value: DatasetConfig }
	| { ok: false; error: string };

function isPlainObject(x: unknown): x is Record<string, unknown> {
	return !!x && typeof x === 'object' && !Array.isArray(x);
}

function safeSubdir(s: string): boolean {
	// MVP: keep it very safe (no path separators, no traversal, no drive letters)
	if (!s) return true; // allow empty -> runner can derive default
	if (s.includes('..')) return false;
	if (s.startsWith('/') || s.startsWith('\\')) return false;
	if (s.includes('/') || s.includes('\\')) return false;
	if (s.includes(':')) return false; // windows drive letters etc.
	return /^[a-zA-Z0-9._-]+$/.test(s);
}

export function parseDatasetConfig(raw: string): DatasetConfigParseResult {
	const text = typeof raw === 'string' ? raw.trim() : '';
	if (!text) return { ok: false, error: 'dataset.json is empty' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e: any) {
		return { ok: false, error: `Invalid JSON: ${String(e?.message || e)}` };
	}
	if (!isPlainObject(parsed)) return { ok: false, error: 'dataset.json must be a JSON object' };

	const source = parsed.source;
	if (source !== 'kaggle') return { ok: false, error: `Unsupported source: ${String(source)}` };

	const kaggle = parsed.kaggle;
	if (!isPlainObject(kaggle)) return { ok: false, error: 'kaggle must be an object' };
	const dataset = kaggle.dataset;
	if (typeof dataset !== 'string' || dataset.trim().length === 0) {
		return { ok: false, error: 'kaggle.dataset is required (e.g. "owner/dataset")' };
	}
	// lightweight format check
	if (!/^[^/]+\/[^/]+$/.test(dataset.trim())) {
		return { ok: false, error: 'kaggle.dataset must look like "owner/dataset"' };
	}

	const unzipRaw = kaggle.unzip;
	if (unzipRaw !== undefined && typeof unzipRaw !== 'boolean') {
		return { ok: false, error: 'kaggle.unzip must be a boolean if provided' };
	}

	const layout = parsed.layout;
	if (layout !== undefined && !isPlainObject(layout)) {
		return { ok: false, error: 'layout must be an object if provided' };
	}
	const subdirRaw = isPlainObject(layout) ? layout.subdir : undefined;
	if (subdirRaw !== undefined && typeof subdirRaw !== 'string') {
		return { ok: false, error: 'layout.subdir must be a string if provided' };
	}
	const subdir = typeof subdirRaw === 'string' ? subdirRaw.trim() : undefined;
	if (subdir !== undefined && !safeSubdir(subdir)) {
		return { ok: false, error: 'layout.subdir is unsafe (only [a-zA-Z0-9._-], no slashes, no "..")' };
	}

	const notes = parsed.notes;
	if (notes !== undefined && typeof notes !== 'string') {
		return { ok: false, error: 'notes must be a string if provided' };
	}

	const files = kaggle.files;
	if (files !== undefined) {
		if (!Array.isArray(files) || files.some((f) => typeof f !== 'string' || !f.trim())) {
			return { ok: false, error: 'kaggle.files must be an array of non-empty strings if provided' };
		}
	}

	// New optional fields from validation tool
	const verifiedAt = kaggle.verifiedAt;
	if (verifiedAt !== undefined && typeof verifiedAt !== 'string') {
		return { ok: false, error: 'kaggle.verifiedAt must be a string (ISO timestamp) if provided' };
	}

	const totalSizeBytes = kaggle.totalSizeBytes;
	if (totalSizeBytes !== undefined && (typeof totalSizeBytes !== 'number' || totalSizeBytes < 0)) {
		return { ok: false, error: 'kaggle.totalSizeBytes must be a non-negative number if provided' };
	}

	const dataPattern = isPlainObject(layout) ? layout.dataPattern : undefined;
	if (dataPattern !== undefined && !['flat', 'has_subdirs', 'unknown'].includes(dataPattern as string)) {
		return { ok: false, error: 'layout.dataPattern must be "flat", "has_subdirs", or "unknown" if provided' };
	}

	const value: DatasetConfig = {
		source: 'kaggle',
		kaggle: {
			dataset: dataset.trim(),
			unzip: typeof unzipRaw === 'boolean' ? unzipRaw : undefined,
			files: Array.isArray(files) ? (files as string[]).map((f) => f.trim()) : undefined,
			verifiedAt: typeof verifiedAt === 'string' ? verifiedAt : undefined,
			totalSizeBytes: typeof totalSizeBytes === 'number' ? totalSizeBytes : undefined,
		},
		layout: {
			subdir: subdir,
			dataPattern: dataPattern as 'flat' | 'has_subdirs' | 'unknown' | undefined,
		},
		notes: typeof notes === 'string' ? notes : undefined,
	};

	return { ok: true, value };
}


