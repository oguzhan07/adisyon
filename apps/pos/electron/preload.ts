/**
 * Preload: renderer ile ana surec arasindaki TEK gecis noktasi.
 *
 * contextBridge yalnizca burada listelenen fonksiyonlari arayuze acar.
 * Renderer'da `require`, `process` veya dosya sistemi erisimi YOKTUR - bu
 * bilincli bir kisitlama. Yeni bir masaustu yetenegi gerektiginde buraya
 * acikca eklenmesi gerekir; boylece yuzeyin ne kadar genisledigi gorunur.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  BillData,
  DesktopApi,
  InstalledPrinter,
  KitchenTicketData,
  PreparedImage,
  PrinterSettings,
  PrintOutcome,
  QrLabelData,
  ZReportData,
} from '@adisyon/shared';

const api: DesktopApi = {
  print: {
    kitchen: (settings: PrinterSettings, data: KitchenTicketData): Promise<PrintOutcome> =>
      ipcRenderer.invoke('print:kitchen', settings, data),

    bill: (settings: PrinterSettings, data: BillData): Promise<PrintOutcome> =>
      ipcRenderer.invoke('print:bill', settings, data),

    zreport: (settings: PrinterSettings, data: ZReportData): Promise<PrintOutcome> =>
      ipcRenderer.invoke('print:zreport', settings, data),

    qrLabel: (settings: PrinterSettings, data: QrLabelData): Promise<PrintOutcome> =>
      ipcRenderer.invoke('print:qrLabel', settings, data),

    test: (settings: PrinterSettings, shopName: string): Promise<PrintOutcome> =>
      ipcRenderer.invoke('print:test', settings, shopName),

    testConnection: (settings: PrinterSettings): Promise<boolean> =>
      ipcRenderer.invoke('print:testConnection', settings),

    openDrawer: (settings: PrinterSettings): Promise<PrintOutcome> =>
      ipcRenderer.invoke('print:openDrawer', settings),
  },

  pickImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickImage'),

  prepareImage: (filePath: string): Promise<PreparedImage> =>
    ipcRenderer.invoke('image:prepare', filePath),

  listPrinters: (): Promise<InstalledPrinter[]> => ipcRenderer.invoke('printer:list'),

  publishMenu: (url: string, secret: string): Promise<PrintOutcome> =>
    ipcRenderer.invoke('menu:publish', url, secret),

  secureStore: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('secureStore:get', key),
    set: (key: string, value: string): Promise<void> =>
      ipcRenderer.invoke('secureStore:set', key, value),
    remove: (key: string): Promise<void> => ipcRenderer.invoke('secureStore:remove', key),
  },

  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
};

contextBridge.exposeInMainWorld('desktop', api);
