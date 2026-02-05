export type OpenAiStatus = {
  ok: true;
  configured: boolean;
  oauthConnected: boolean;
  apiKeySet: boolean;
  mode: "oauth" | "api_key" | "none";
  lastError: string | null;
};
