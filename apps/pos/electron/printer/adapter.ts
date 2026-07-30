/**
 * ESC/POS yazici katmani.
 *
 * NEDEN BU DOSYA VAR: Tarayicida calisan bir web uygulamasi termal yaziciya
 * ham bayt gonderemez; Vercel'de barinan bir sayfa da dukkanin yerel agina
 * ulasamaz. Kasa programinin masaustu olmasinin ana sebebi bu dosyadir.
 *
 * IKI BAGLANTI YOLU:
 *
 *   network (ONERILEN) - POSA yazicinin Ethernet cikisi var. tcp://ip:9100
 *     uzerinden dogrudan ham ESC/POS gonderiyoruz. Native modul gerekmez,
 *     Windows yazici surucusune ve oturum durumuna bagimli degildir.
 *
 *   usb - Yazici Windows'ta PAYLASILAN bir yazici olarak tanimliysa, olusan
 *     ham bayti gecici dosyaya yazip `copy /b` ile paylasima gonderiyoruz.
 *     Bu yol bilincli olarak native modul (node-printer) KULLANMAZ: native
 *     modul electron-builder paketlemesinde ve Electron surum yukseltmelerinde
 *     surekli sorun cikarir.
 *
 * TURKCE KARAKTER: characterSet PC857 (Turkish) ve removeSpecialCharacters
 * kapali. Bu ikili olmadan fiste "ş ğ ı İ ç ö ü" bozuk cikar. Yazici modeline
 * gore codepage oynamasi gerekebilir - bu yuzden ayarlardan degistirilebilir
 * ve "Test fişi" dugmesi ilk gun calistirilmalidir.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CharacterSet, PrinterTypes, ThermalPrinter } from 'node-thermal-printer';
import type { PrinterSettings } from '@adisyon/shared';

export class PrinterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrinterError';
  }
}

/** Fis icerigini olusturan geri cagirma; sablonlar bunu doldurur. */
export type ReceiptBuilder = (p: ThermalPrinter) => void;

/** Ayarlardaki codepage secenekleri. PC857 Turkce icin dogru olan. */
const CHARACTER_SETS: Record<string, CharacterSet> = {
  PC857_TURKISH: CharacterSet.PC857_TURKISH,
  PC852_LATIN2: CharacterSet.PC852_LATIN2,
  WPC1254_TURKISH: CharacterSet.WPC1254_TURKISH,
  PC437_USA: CharacterSet.PC437_USA,
};

function createPrinter(settings: PrinterSettings, iface: string): ThermalPrinter {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON, // POSA dahil cogu 80mm yazici EPSON ESC/POS uyumlu
    interface: iface,
    characterSet: CHARACTER_SETS.PC857_TURKISH,
    // true olsaydi Turkce karakterler sessizce ASCII'ye duserdi ("sogansiz")
    removeSpecialCharacters: false,
    lineCharacter: '-',
    width: settings.charactersPerLine,
    options: { timeout: 5000 },
  });
}

/**
 * Fisi olusturur ve yaziciya gonderir.
 *
 * Hatalar PrinterError olarak firlatilir; cagiran taraf (IPC katmani) bunu
 * kullaniciya Turkce mesaj olarak gosterir. ADISYON ISLEMI BU HATADAN
 * ETKILENMEZ: siparis zaten veritabanina yazilmis olur, fis sonra basilir.
 */
export async function printReceipt(
  settings: PrinterSettings,
  build: ReceiptBuilder,
  options: { openCashDrawer?: boolean } = {},
): Promise<void> {
  if (settings.connection === 'disabled') {
    throw new PrinterError('Yazıcı ayarlardan kapatılmış durumda.');
  }

  if (settings.connection === 'network') {
    await printOverNetwork(settings, build, options);
    return;
  }

  await printOverWindowsShare(settings, build, options);
}

async function printOverNetwork(
  settings: PrinterSettings,
  build: ReceiptBuilder,
  options: { openCashDrawer?: boolean },
): Promise<void> {
  if (!settings.host) {
    throw new PrinterError('Yazıcı IP adresi ayarlardan girilmemiş.');
  }

  const printer = createPrinter(settings, `tcp://${settings.host}:${settings.port}`);

  build(printer);
  printer.cut();

  if (options.openCashDrawer) {
    printer.openCashDrawer();
  }

  try {
    await printer.execute();
  } catch (error) {
    throw new PrinterError(describeNetworkError(error, settings));
  }
}

/**
 * Windows'ta paylasilan yaziciya ham ESC/POS gonderir.
 *
 * node-thermal-printer'in kendi 'printer:' arayuzu native modul ister; onun
 * yerine bayti kendimiz uretip `copy /b` ile paylasima yaziyoruz. Yazicinin
 * "Yazdirma islerini bicimlendirme" yapmamasi icin ham (RAW) veri gitmesi
 * gerekir - paylasim uzerinden gonderim bunu sagliyor.
 */
async function printOverWindowsShare(
  settings: PrinterSettings,
  build: ReceiptBuilder,
  options: { openCashDrawer?: boolean },
): Promise<void> {
  if (!settings.printerName) {
    throw new PrinterError('Windows yazıcı paylaşım adı ayarlardan girilmemiş.');
  }

  // interface bos birakilamiyor; buffer uretiminde kullanilmiyor
  const printer = createPrinter(settings, 'tcp://127.0.0.1:9100');

  build(printer);
  printer.cut();
  if (options.openCashDrawer) {
    printer.openCashDrawer();
  }

  const buffer = printer.getBuffer();
  let dir: string | null = null;

  try {
    dir = await mkdtemp(join(tmpdir(), 'adisyon-fis-'));
    const file = join(dir, 'fis.bin');
    await writeFile(file, buffer);

    const target = `\\\\localhost\\${settings.printerName}`;
    await runCommand('cmd', ['/c', 'copy', '/b', file, target]);
  } catch (error) {
    if (error instanceof PrinterError) throw error;
    throw new PrinterError(
      `Yazıcıya gönderilemedi ("${settings.printerName}"). ` +
        'Yazıcının Windows’ta paylaşıma açık olduğundan ve paylaşım adının ' +
        'doğru yazıldığından emin olun.',
    );
  } finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        /* gecici dosya temizligi basarisiz olursa islemi bozmuyoruz */
      });
    }
  }
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => reject(new PrinterError(error.message)));

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new PrinterError(stderr.trim() || `Yazdırma komutu ${code} koduyla bitti.`));
    });
  });
}

/** Ag hatalarini kullanicinin anlayacagi Turkce mesaja cevirir */
function describeNetworkError(error: unknown, settings: PrinterSettings): string {
  const raw = error instanceof Error ? error.message : String(error);
  const address = `${settings.host}:${settings.port}`;

  if (/ECONNREFUSED/i.test(raw)) {
    return `Yazıcı bağlantıyı reddetti (${address}). Yazıcı açık mı ve port doğru mu?`;
  }
  if (/ETIMEDOUT|timeout/i.test(raw)) {
    return `Yazıcıya ulaşılamadı (${address}). Ağ kablosu takılı ve yazıcı açık mı?`;
  }
  if (/EHOSTUNREACH|ENETUNREACH/i.test(raw)) {
    return `Yazıcının bulunduğu ağa erişilemiyor (${address}). IP adresi doğru mu?`;
  }
  return `Yazıcı hatası (${address}): ${raw}`;
}

/**
 * Baglanti testi: fis basmadan yaziciya ulasilabildigini kontrol eder.
 * Ayarlar ekranindaki "Bağlantıyı sına" dugmesi bunu kullanir.
 */
export async function testConnection(settings: PrinterSettings): Promise<boolean> {
  if (settings.connection !== 'network' || !settings.host) return false;

  const printer = createPrinter(settings, `tcp://${settings.host}:${settings.port}`);
  try {
    return await printer.isPrinterConnected();
  } catch {
    return false;
  }
}
