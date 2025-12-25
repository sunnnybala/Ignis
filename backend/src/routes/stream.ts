import { Router } from 'express';

import { db } from '../db/client';
import { jobs } from '../db/schema';
import { initSse } from '../utils/sse';
import { getAuthedUser, getOwnedJob, logAuthzDenied } from '../authz/ownership';

export const streamRouter = Router();

// GET /stream/jobs/:jobId (stub)
streamRouter.get('/jobs/:jobId', async (req, res) => {
	const sse = initSse(res);
	try {
		const user = getAuthedUser(req);
		if (!user) {
			sse.write({ type: 'error', jobId: String(req.params.jobId), message: 'Unauthorized' });
			return sse.close();
		}
		const jobId = String(req.params.jobId);
		const ownedJob = await getOwnedJob(jobId, user.id);
		if (!ownedJob) {
			logAuthzDenied(req, { jobId });
			sse.write({ type: 'error', jobId, message: 'Job not found' });
			return sse.close();
		}
		sse.write({ type: 'job_status', jobId, status: ownedJob.status });
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


