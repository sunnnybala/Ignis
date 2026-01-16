import { randomUUID } from 'node:crypto';
import {
	pgEnum,
	pgTable,
	text,
	timestamp,
	integer,
	boolean,
	jsonb,
	uuid,
	index,
	uniqueIndex,
} from 'drizzle-orm/pg-core';

// Enums
export const fileTypeEnum = pgEnum('file_type', [
	'txt',
	'md',
	'py',
	'tex',
	'pdf',
	'img',
	'csv',
	'log',
	'other',
]);

export const fileOriginEnum = pgEnum('file_origin', ['user', 'agent', 'job']);

export const jobTypeEnum = pgEnum('job_type', ['experiment_run', 'paper_compile']);

export const jobStatusEnum = pgEnum('job_status', ['queued', 'running', 'completed', 'failed']);

export const ledgerReasonEnum = pgEnum('ledger_reason', [
	'llm',
	'experiment',
	'pdf_compile',
	'refund',
	'manual_adjustment',
]);

// Agent phases for the conversational controller
export const agentPhaseEnum = pgEnum('agent_phase', [
	'refine',
	'check_novelty',
	'implementation_plan',
	'implement',
	'await_experiment',
	'finalize_paper',
]);
export type AgentPhase = (typeof agentPhaseEnum.enumValues)[number];

// users
export const users = pgTable(
	'users',
	{
		id: uuid('id')
			.$defaultFn(() => randomUUID())
			.primaryKey(),
		name: text('name'),
		email: text('email').notNull().unique(),
		passwordHash: text('password_hash').notNull(),
		avatarUrl: text('avatar_url'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
);

// projects
export const projects = pgTable(
	'projects',
	{
		id: uuid('id')
			.$defaultFn(() => randomUUID())
			.primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		// Agent state (hybrid controller)
		phase: agentPhaseEnum('phase').default('refine').notNull(),
		m1LoopCount: integer('m1_loop_count').default(0).notNull(),
		m2LoopCount: integer('m2_loop_count').default(0).notNull(),
		m1Approved: boolean('m1_approved').default(false).notNull(),
		m2Approved: boolean('m2_approved').default(false).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(p) => ({
		byUserCreatedAt: index('projects_user_created_at_idx').on(p.userId, p.createdAt),
	}),
);

// jobs (Modal-only tasks)
export const jobs = pgTable(
	'jobs',
	{
		id: uuid('id')
			.$defaultFn(() => randomUUID())
			.primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		type: jobTypeEnum('type').notNull(),
		status: jobStatusEnum('status').notNull(),
		attempts: integer('attempts').default(0).notNull(),
		maxAttempts: integer('max_attempts').default(3).notNull(),
		output: text('output'),
		errorCode: text('error_code'),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		startedAt: timestamp('started_at', { withTimezone: true }),
		endedAt: timestamp('ended_at', { withTimezone: true }),
	},
	(j) => ({
		byProjectCreatedAt: index('jobs_project_created_at_idx').on(j.projectId, j.createdAt),
		byStatus: index('jobs_status_idx').on(j.status),
		byType: index('jobs_type_idx').on(j.type),
	}),
);

// files (single table for UI-visible tree, including job outputs)
export const files = pgTable(
	'files',
	{
		id: uuid('id')
			.$defaultFn(() => randomUUID())
			.primaryKey(),
		projectId: uuid('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		// Example paths:
		//   'Lit Review/review.md'
		//   'Results/<jobId>/plot-1.png'
		//   'Final_Paper/<jobId>/paper.pdf'
		path: text('path').notNull(),
		type: fileTypeEnum('type').notNull(),
		content: text('content'),
		storageKey: text('storage_key'),
		mimeType: text('mime_type'),
		sizeBytes: integer('size_bytes'),
		sha256: text('sha256'),
		origin: fileOriginEnum('origin').default('user').notNull(),
		jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(f) => ({
		projectPathUnique: uniqueIndex('files_project_path_unique').on(f.projectId, f.path),
		byProjectType: index('files_project_type_idx').on(f.projectId, f.type),
		byJobId: index('files_job_id_idx').on(f.jobId),
	}),
);

// credits_ledger (append-only)
export const creditsLedger = pgTable(
	'credits_ledger',
	{
		id: uuid('id')
			.$defaultFn(() => randomUUID())
			.primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		delta: integer('delta').notNull(),
		reason: ledgerReasonEnum('reason').notNull(),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(l) => ({
		byUserCreatedAt: index('ledger_user_created_at_idx').on(l.userId, l.createdAt),
		byJobId: index('ledger_job_id_idx').on(l.jobId),
	}),
);


