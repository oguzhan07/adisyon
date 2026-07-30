import type { DesktopApi } from '@adisyon/shared';

declare global {
  interface Window {
    /** preload tarafindan acilan masaustu yetenekleri (bkz. electron/preload.ts) */
    desktop: DesktopApi;
  }
}

export {};
