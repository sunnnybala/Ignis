import { AgentPhase } from '../db/schema';

export type ChatDeltaEvent = {
	type: 'delta';
	text: string;
};

export type ChatFileUpdateEvent = {
	type: 'file_update';
	path: string;
	op: 'append' | 'replace';
	content: string;
};

export type ChatPhaseEvent = {
	type: 'phase';
	phase: AgentPhase;
};

export type ChatProposedPhaseEvent = {
	type: 'proposed_phase';
	phase: AgentPhase;
	rationale: string;
};

export type ChatAwaitUserEvent = {
	type: 'await_user';
	questions?: string[];
	prompt?: string;
	choices?: string[];
};

export type ChatActionRequestEvent = {
	type: 'action_request';
	action: 'run_experiment' | 'generate_paper';
	rationale: string;
};

export type ChatSseEvent =
	| ChatDeltaEvent
	| ChatFileUpdateEvent
	| ChatPhaseEvent
	| ChatProposedPhaseEvent
	| ChatAwaitUserEvent
	| ChatActionRequestEvent;


