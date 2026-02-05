export type ArtifactMetaV1 = {
  version: 1;
  ingestedAt: string;
  sourcePath: string;
  sha256: string;
  kind: "transcript" | "slides" | "unknown";
  detected: {
    courseShort: string;
    courseSlug: string;
    sessionDate: string;
  };
  resolved?: {
    courseShort: string;
    courseSlug: string;
  };
  pipelineVersion: string;
};
