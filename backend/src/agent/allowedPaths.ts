import { AgentPhase } from '../db/schema';

type FileType = 'txt' | 'md' | 'py' | 'tex';

type AllowedEntry = { path: string; type: FileType };

const MASTER1: AllowedEntry[] = [
	{ path: 'Lit Review/papers.txt', type: 'txt' },
	{ path: 'Lit Review/review.md', type: 'md' },
];

const MASTER2: AllowedEntry[] = [
	{ path: 'Design/design_plan.md', type: 'md' },
	// Stored as type=txt in DB for MVP (path ends with .json)
	{ path: 'Design/dataset.json', type: 'txt' },
	{ path: 'Experimentation/experiment.py', type: 'py' },
];

const FINALIZE: AllowedEntry[] = [{ path: 'Final Paper/paper.tex', type: 'tex' }];

export function getAllowedByPhase(phase: AgentPhase): AllowedEntry[] {
	if (phase === 'refine' || phase === 'check_novelty') return MASTER1;
	if (phase === 'implementation_plan' || phase === 'implement') return MASTER2;
	if (phase === 'finalize_paper') return FINALIZE;
	// await_experiment or any other: no agent-side writes allowed
	return [];
}

export function isAllowedWrite(
	phase: AgentPhase,
	path: string,
	inferredType: FileType,
): { ok: true } | { ok: false; reason: string } {
	const allowed = getAllowedByPhase(phase);
	const match = allowed.find((a) => a.path === path);
	if (!match) return { ok: false, reason: `Writes to '${path}' are not allowed in phase '${phase}'` };
	if (match.type !== inferredType)
		return { ok: false, reason: `Type mismatch for '${path}': expected ${match.type}, got ${inferredType}` };
	return { ok: true };
}


