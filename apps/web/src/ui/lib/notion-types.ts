export type NotionStatus = {
  ok: true;
  tokenSet: boolean;
  reachable: boolean;
  workspaceName: string | null;
  botName: string | null;
  error: string | null;
};
