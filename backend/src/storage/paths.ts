export function buildResultKey(projectId: string, runId: string, fileName: string): string {
	return `projects/${projectId}/results/${runId}/${sanitizeFileName(fileName)}`;
}

export function buildPaperKey(projectId: string, jobId: string): string {
	return `projects/${projectId}/paper/${jobId}/paper.pdf`;
}

export function sanitizeFileName(name: string): string {
	// Very conservative: letters, numbers, dot, dash, underscore; collapse others to dash
	const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
	return cleaned.length > 128 ? cleaned.slice(0, 128) : cleaned;
}


