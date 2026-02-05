import { z } from "zod";

export const ApiStatusSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  now: z.string(),
  stateDir: z.string(),
  unifiedDir: z.string(),
});

export type ApiStatus = z.infer<typeof ApiStatusSchema>;

export const FsEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["file", "dir"]),
});

export const FsListResponseSchema = z.object({
  path: z.string(),
  entries: z.array(FsEntrySchema),
});

export const FsReadResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  sha256: z.string(),
});

export const FsWriteRequestSchema = z.object({
  content: z.string(),
  expectedSha256: z.string().optional(),
});

export const FsWriteResponseSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  savedAt: z.string(),
});
