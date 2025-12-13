export type Phase = 'refine' | 'literature' | 'experiment_generate' | 'paper_generate';

export type JobType = 'experiment_run' | 'paper_compile';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type InlineSseEvent =
  | { type: 'phase'; phase: Phase }
  | { type: 'delta'; text: string }
  | { type: 'file_update'; path: string; op: 'append' | 'replace'; content: string }
  | { type: 'completed' }
  | { type: 'error'; message: string };

export type JobSseEvent =
  | { type: 'log'; jobId: string; text: string }
  | { type: 'artifact'; jobId: string; path: string; presignedUrl: string }
  | { type: 'job_status'; jobId: string; status: JobStatus }
  | { type: 'error'; jobId: string; message: string };


