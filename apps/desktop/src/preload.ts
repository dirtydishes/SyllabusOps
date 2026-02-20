import { contextBridge, shell } from "electron";

function assertSafeExternalUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed.");
  }
  return parsed.toString();
}

contextBridge.exposeInMainWorld("syllabusopsDesktop", {
  isDesktop: true as const,
  openExternal: async (url: string) => {
    await shell.openExternal(assertSafeExternalUrl(url));
  },
});
