import { z } from "zod";

export const GlossaryItemSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
});

export const ArtifactSlideHighlightSchema = z.object({
  slideNo: z.number().int().positive(),
  bullets: z.array(z.string().min(1)).default([]),
  notes: z.array(z.string().min(1)).default([]),
});

export const ArtifactSummarySchema = z.object({
  version: z.literal(1),
  course: z
    .object({
      courseShort: z.string().min(1),
      courseSlug: z.string().min(1),
    })
    .optional(),
  sessionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  artifact: z.object({
    kind: z.enum(["transcript", "slides", "textbook", "unknown"]),
    sourceName: z.string().optional(),
  }),
  title: z.string().min(1),
  overview: z.string().min(1),
  topics: z.array(z.string().min(1)).default([]),
  keyPoints: z.array(z.string().min(1)).default([]),
  glossary: z.array(GlossaryItemSchema).default([]),
  quotes: z.array(z.string().min(1)).default([]),
  slides: z.array(ArtifactSlideHighlightSchema).default([]),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;

export const TaskSuggestionSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  due: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const SessionSummarySchema = z.object({
  version: z.literal(1),
  course: z.object({
    courseShort: z.string().min(1),
    courseSlug: z.string().min(1),
  }),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  overview: z.string().min(1),
  concepts: z.array(z.string().min(1)).default([]),
  reviewNext: z.array(z.string().min(1)).default([]),
  tasks: z.array(TaskSuggestionSchema).default([]),
  references: z.array(z.string().min(1)).default([]),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
