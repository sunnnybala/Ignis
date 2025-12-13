CREATE TYPE "public"."agent_phase" AS ENUM('refine', 'check_novelty', 'implementation_plan', 'implement', 'await_experiment', 'finalize_paper');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "phase" "agent_phase" DEFAULT 'refine' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "m1_loop_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "m2_loop_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "m1_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "m2_approved" boolean DEFAULT false NOT NULL;