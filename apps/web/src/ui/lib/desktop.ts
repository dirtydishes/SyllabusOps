export function isDesktopShell(): boolean {
  return window.syllabusopsDesktop?.isDesktop === true;
}

export async function openAuthUrl(url: string): Promise<"desktop" | "browser"> {
  if (isDesktopShell()) {
    await window.syllabusopsDesktop?.openExternal(url);
    return "desktop";
  }
  window.location.href = url;
  return "browser";
}
