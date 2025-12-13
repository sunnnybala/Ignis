import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { jobs } from '../db/schema';
import { initSse } from '../utils/sse';

export const streamRouter = Router();

// GET /stream/jobs/:jobId (stub)
streamRouter.get('/jobs/:jobId', async (req, res) => {
	const sse = initSse(res);
	try {
		const jobId = String(req.params.jobId);
		const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
		if (!job) {
			sse.write({ type: 'error', jobId, message: 'Job not found' });
			return sse.close();
		}
		sse.write({ type: 'job_status', jobId, status: job.status });
		sse.write({ type: 'log', jobId, text: 'Starting...' });
		await new Promise((r) => setTimeout(r, 300));
		sse.write({ type: 'log', jobId, text: 'Processing...' });
		await new Promise((r) => setTimeout(r, 300));
		sse.write({ type: 'job_status', jobId, status: 'completed' });
	} catch (err: unknown) {
		sse.write({ type: 'error', jobId: String(req.params.jobId), message: err instanceof Error ? err.message : 'Failed' });
	} finally {
		sse.close();
	}
});


