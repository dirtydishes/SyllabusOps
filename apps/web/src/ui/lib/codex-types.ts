export type CodexStatus = {
  ok: true;
  available: boolean;
  requiresOpenaiAuth: boolean;
  connected: boolean;
  accountLabel: string | null;
  lastError: string | null;
};
