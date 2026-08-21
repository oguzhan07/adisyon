/**
 * Electron ana sureci.
 *
 * GUVENLIK: contextIsolation acik, nodeIntegration kapali. Renderer (React)
 * dogrudan Node API'sine, dosya sistemine veya yaziciya ERISEMEZ; yalnizca
 * preload'da tanimlanan dar IPC kanallarini cagirir. Boylece arayuzde bir
 * XSS acigi olsa bile isletim sistemine gecis yolu olusmaz.
 */

import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
import type {
  BillData,
  KitchenTicketData,
  PreparedImage,
  PrinterSettings,
  PrintOutcome,
  QrLabelData,
  ZReportData,
} from '@adisyon/shared';
import {
  PrinterError,
  openCashDrawerOnly,
  prewarmPrinterHelper,
  printReceipt,
  testConnection,
} from './printer/adapter';
import { billReceipt, kitchenTicket, qrLabel, testReceipt, zReport } from './printer/templates';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

/* ------------------------------------------------------------------ pencere */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    // Kasa monitorleri sik sik 1366x768: alt sinir buna gore
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 700,
    show: false,
    backgroundColor: '#fafaf9',
    title: 'Adisyon',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload'da IPC koprusu kuruyoruz
      spellcheck: false,
    },
  });

  // Pencere hazir olana kadar gostermiyoruz: bos beyaz ekran gorunmesin
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    // Kasa bilgisayarinda program tam ekran calissin
    mainWindow?.maximize();
  });

  // Uygulama icinden acilan dis baglantilar sistem tarayicisinda acilsin;
  // Electron penceresinde rastgele site acilmasi guvenlik riskidir
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/* --------------------------------------------------- tek ornek (single instance)
   Kasada programin iki kez acilmasi, ayni masaya iki farkli pencereden kalem
   eklenmesi gibi karisikliklara yol acar. Ikinci calistirma mevcut pencereyi
   one getirir. */
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    registerIpcHandlers();
    // Yazici yardimcisini arka planda hazirla: ilk fis/kasa acma da hizli olsun
    prewarmPrinterHelper();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

/* --------------------------------------------------------------- IPC katmani */

/**
 * Yazdirma cagrilarini tek noktadan sarmalar.
 *
 * Yazici hatasi ASLA istisna olarak renderer'a sizmaz; her zaman
 * { ok: false, error } doner. Sebep: adisyon islemi yazicidan bagimsiz
 * devam etmeli. Kagit bitse bile siparis veritabaninda kayitli olur,
 * kullaniciya yalnizca uyari gosterilir.
 */
async function guardedPrint(action: () => Promise<void>): Promise<PrintOutcome> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    if (error instanceof PrinterError) {
      return { ok: false, error: error.message };
    }
    console.error('Beklenmeyen yazdırma hatası:', error);
    return {
      ok: false,
      error: 'Yazdırma sırasında beklenmeyen bir hata oluştu. Ayarlardan yazıcıyı sınayın.',
    };
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(
    'print:kitchen',
    (_event, settings: PrinterSettings, data: KitchenTicketData): Promise<PrintOutcome> =>
      guardedPrint(() => printReceipt(settings, kitchenTicket(data))),
  );

  ipcMain.handle(
    'print:bill',
    (_event, settings: PrinterSettings, data: BillData): Promise<PrintOutcome> =>
      guardedPrint(() =>
        printReceipt(settings, billReceipt(data), {
          // Cekmece yalnizca hesap fisinde acilir; ocak fisinde anlamsiz
          openCashDrawer: settings.openCashDrawerOnClose,
        }),
      ),
  );

  ipcMain.handle(
    'print:zreport',
    (_event, settings: PrinterSettings, data: ZReportData): Promise<PrintOutcome> =>
      guardedPrint(() => printReceipt(settings, zReport(data))),
  );

  ipcMain.handle(
    'print:qrLabel',
    (_event, settings: PrinterSettings, data: QrLabelData): Promise<PrintOutcome> =>
      guardedPrint(() => printReceipt(settings, qrLabel(data))),
  );

  ipcMain.handle(
    'print:test',
    (_event, settings: PrinterSettings, shopName: string): Promise<PrintOutcome> =>
      guardedPrint(() =>
        printReceipt(settings, testReceipt(shopName), {
          // Test fisi cekmeceyi de sinar
          openCashDrawer: settings.openCashDrawerOnClose,
        }),
      ),
  );

  ipcMain.handle('print:testConnection', (_event, settings: PrinterSettings): Promise<boolean> =>
    testConnection(settings),
  );

  // Fis basmadan cekmeceyi ac (nakit odemede para ustu icin)
  ipcMain.handle('print:openDrawer', (_event, settings: PrinterSettings): Promise<PrintOutcome> =>
    guardedPrint(() => openCashDrawerOnly(settings)),
  );

  /* ------------------------------------------------------------- gorseller */

  ipcMain.handle('dialog:pickImage', async (): Promise<string | null> => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Ürün fotoğrafı seç',
      properties: ['openFile'],
      filters: [{ name: 'Görseller', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic'] }],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  /**
   * Urun gorselini menuye uygun hale getirir.
   *
   * Neden burada: telefon fotograflari 4-6 MB gelir. Boyutlandirmadan
   * yuklemek QR menuyu belirgin sekilde yavaslatir ve Storage kotasini
   * gereksiz doldurur. 640px genislik ve WebP, menu satirindaki kucuk gorsel
   * icin fazlasiyla yeterli.
   */
  ipcMain.handle('image:prepare', async (_event, filePath: string): Promise<PreparedImage> => {
    const output = await sharp(filePath)
      .rotate() // EXIF yonlendirmesini uygula: yan yatmis fotograflar duzelsin
      .resize({ width: 640, height: 640, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });

    return {
      base64: output.data.toString('base64'),
      width: output.info.width,
      height: output.info.height,
      byteLength: output.data.byteLength,
    };
  });

  /* --------------------------------------------------- menuyu yayinla */

  /**
   * QR menu sitesinin onbellegini tazeler. Renderer'dan cagrilamaz (CSP
   * yalnizca Supabase'e izin veriyor), bu yuzden istek burada atilir.
   */
  ipcMain.handle(
    'menu:publish',
    async (_event, url: string, secret: string): Promise<PrintOutcome> => {
      if (!url || !secret) {
        return {
          ok: false,
          error: 'Menü adresi veya yayın anahtarı tanımlı değil (.env dosyasını kontrol edin).',
        };
      }

      try {
        const response = await fetch(`${url.replace(/\/$/, '')}/api/revalidate`, {
          method: 'POST',
          headers: { 'x-revalidate-secret': secret },
          signal: AbortSignal.timeout(15_000),
        });

        if (response.status === 401) {
          return { ok: false, error: 'Yayın anahtarı hatalı (Vercel’deki değerle eşleşmiyor).' };
        }
        if (!response.ok) {
          return { ok: false, error: `Yayınlama başarısız (HTTP ${response.status}).` };
        }
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: /timeout|abort/i.test(message)
            ? 'Menü sitesine ulaşılamadı (zaman aşımı). İnternet bağlantısını kontrol edin.'
            : `Menü sitesine ulaşılamadı: ${message}`,
        };
      }
    },
  );

  /* ------------------------------------------------- guvenli oturum deposu */

  ipcMain.handle('secureStore:get', (_event, key: string) => secureStoreGet(key));
  ipcMain.handle('secureStore:set', (_event, key: string, value: string) =>
    secureStoreSet(key, value),
  );
  ipcMain.handle('secureStore:remove', (_event, key: string) => secureStoreSet(key, null));

  ipcMain.handle('app:version', () => app.getVersion());
}

/**
 * Oturum jetonlarini isletim sisteminin sifreleme servisiyle saklar.
 *
 * Neden localStorage yerine bu: localStorage diskte SIFRESIZ durur. Kasa
 * bilgisayarina fiziksel erisen biri jetonu okuyup veritabanina baglanabilir.
 * safeStorage, Windows'ta DPAPI kullanir - jeton yalnizca ayni kullanici
 * hesabinda cozulebilir.
 */
function storePath(): string {
  return join(app.getPath('userData'), 'secure-store.json');
}

async function readStore(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(storePath(), 'utf8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function secureStoreGet(key: string): Promise<string | null> {
  const store = await readStore();
  const encrypted = store[key];
  if (!encrypted) return null;

  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    // Sifre cozulemiyorsa (baska kullanici/makine) oturum yok kabul edilir
    return null;
  }
}

async function secureStoreSet(key: string, value: string | null): Promise<void> {
  const store = await readStore();

  if (value === null) {
    delete store[key];
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      // Sifreleme yoksa jetonu duz metin yazmaktansa hic yazmiyoruz;
      // kullanici her acilista giris yapar.
      return;
    }
    store[key] = safeStorage.encryptString(value).toString('base64');
  }

  await mkdir(dirname(storePath()), { recursive: true });
  await writeFile(storePath(), JSON.stringify(store), 'utf8');
}
