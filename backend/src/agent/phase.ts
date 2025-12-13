import { AgentPhase } from '../db/schema';

export function inMaster1(phase: AgentPhase): boolean {
	return phase === 'refine' || phase === 'check_novelty';
}

export function inMaster2(phase: AgentPhase): boolean {
	return phase === 'implementation_plan' || phase === 'implement';
}

export function sameMaster(a: AgentPhase, b: AgentPhase): boolean {
	return (inMaster1(a) && inMaster1(b)) || (inMaster2(a) && inMaster2(b));
}

export function currentMaster(phase: AgentPhase): 'm1' | 'm2' | null {
	if (inMaster1(phase)) return 'm1';
	if (inMaster2(phase)) return 'm2';
	return null;
}


