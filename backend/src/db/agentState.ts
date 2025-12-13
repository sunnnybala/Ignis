import { eq } from 'drizzle-orm';

import { db } from './client';
import { AgentPhase, projects } from './schema';

export interface AgentState {
	projectId: string;
	phase: AgentPhase;
	m1LoopCount: number;
	m2LoopCount: number;
	m1Approved: boolean;
	m2Approved: boolean;
}

export async function getAgentState(projectId: string): Promise<AgentState | null> {
	const rows = await db
		.select({
			projectId: projects.id,
			phase: projects.phase,
			m1LoopCount: projects.m1LoopCount,
			m2LoopCount: projects.m2LoopCount,
			m1Approved: projects.m1Approved,
			m2Approved: projects.m2Approved,
		})
		.from(projects)
		.where(eq(projects.id, projectId));
	const row = rows[0];
	return row ?? null;
}

type AgentStatePatch = Partial<{
	phase: AgentPhase;
	m1LoopCount: number;
	m2LoopCount: number;
	m1Approved: boolean;
	m2Approved: boolean;
}>;

export async function updateAgentState(projectId: string, patch: AgentStatePatch): Promise<void> {
	if (!projectId) throw new Error('projectId is required');
	if (!patch || Object.keys(patch).length === 0) return;
	await db.update(projects).set(patch).where(eq(projects.id, projectId));
}

export async function setPhase(projectId: string, phase: AgentPhase): Promise<void> {
	await updateAgentState(projectId, { phase });
}

export async function incrementLoop(projectId: string, master: 'm1' | 'm2'): Promise<void> {
	// NOTE: Do a read-then-write; for high concurrency you can switch to SQL increment
	const state = await getAgentState(projectId);
	if (!state) throw new Error('project not found');
	if (master === 'm1') {
		await updateAgentState(projectId, { m1LoopCount: state.m1LoopCount + 1 });
	} else {
		await updateAgentState(projectId, { m2LoopCount: state.m2LoopCount + 1 });
	}
}


