export {};

declare global {
  interface DesktopApi {
    chooseFolder: () => Promise<string | null>;
  }

  interface Window {
    desktopApi?: DesktopApi;
  }
}
