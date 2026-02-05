import { z } from "zod";

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "blocked",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobTypeSchema = z.enum([
  "noop",
  "ingest_file",
  "extract_transcript",
  "extract_pptx",
  "extract_pdf",
  "suggest_tasks",
]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JobRecordSchema = z.object({
  id: z.string(),
  job_type: JobTypeSchema,
  status: JobStatusSchema,
  priority: z.number().int(),
  payload_json: z.string(),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  next_run_at: z.string(),
  last_error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const EnqueueJobRequestSchema = z.object({
  jobType: JobTypeSchema,
  priority: z.number().int().min(0).max(4).default(2),
  payload: z.record(z.unknown()).default({}),
});
export type EnqueueJobRequest = z.infer<typeof EnqueueJobRequestSchema>;
