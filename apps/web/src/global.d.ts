export {};

declare global {
  interface Window {
    syllabusopsDesktop?: {
      isDesktop: true;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
