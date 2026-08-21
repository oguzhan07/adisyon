/**
 * ESC/POS yazici katmani.
 *
 * NEDEN BU DOSYA VAR: Tarayicida calisan bir web uygulamasi termal yaziciya
 * ham bayt gonderemez; Vercel'de barinan bir sayfa da dukkanin yerel agina
 * ulasamaz. Kasa programinin masaustu olmasinin ana sebebi bu dosyadir.
 *
 * IKI BAGLANTI YOLU:
 *
 *   network - Yazicinin Ethernet cikisi. tcp://ip:9100 uzerinden dogrudan ham
 *     ESC/POS. Native modul/surucu gerekmez; en tasinabilir yol (agdaki her PC
 *     ayni IP ile basar).
 *
 *   usb - Windows'ta KURULU bir yaziciya (kuyruk adiyla) ham RAW veri gonderir.
 *     Yontem: Windows spooler API'si (winspool WritePrinter, datatype=RAW), bir
 *     PowerShell kopyasi uzerinden. Bilincli tercihler:
 *       * Paylasim (copy /b \\host\share) KULLANILMAZ - paylasim yonetici izni
 *         ister; winspool RAW izin istemez.
 *       * Native npm modulu (node-printer) KULLANILMAZ - electron-builder
 *         paketlemesinde ve Electron surum yukseltmelerinde surekli sorun cikarir.
 *     Yazicinin RAW datatype ile beslenmesi, "Generic / Text Only" surucusuyle
 *     bile ESC/POS komutlarinin (kesme, cekmece) dogru islenmesini saglar.
 */

import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
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

function createPrinter(settings: PrinterSettings, iface: string): ThermalPrinter {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: iface,
    // Metin asciify edildigi icin kod sayfasi ASCII ciktiyi etkilemez; yine de
    // belirli birseyle acalim.
    characterSet: CharacterSet.PC857_TURKISH,
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

  // Ag modunda interface tcp; USB modunda buffer'i biz gonderdigimiz icin
  // interface degeri kullanilmaz ama construct icin gereklidir.
  const iface =
    settings.connection === 'network' && settings.host
      ? `tcp://${settings.host}:${settings.port}`
      : 'tcp://127.0.0.1:9100';

  const printer = createPrinter(settings, iface);

  build(printer);
  printer.cut();
  if (options.openCashDrawer) {
    printer.openCashDrawer();
  }

  if (settings.connection === 'network') {
    if (!settings.host) throw new PrinterError('Yazıcı IP adresi ayarlardan girilmemiş.');
    try {
      await printer.execute();
    } catch (error) {
      throw new PrinterError(describeNetworkError(error, settings));
    }
    return;
  }

  // USB / Windows kuyrugu
  if (!settings.printerName) {
    throw new PrinterError('Windows yazıcı adı ayarlardan girilmemiş.');
  }
  await sendRawToWindowsPrinter(settings.printerName, printer.getBuffer());
}

/* ------------------------------------------------- winspool RAW (yardimci exe) */

/**
 * HIZ NOTU: Onceki surumde her yazdirmada PowerShell acilip icinde C# kodu
 * Add-Type ile DERLENIYORDU; bu tek basina 2-3 saniye suruyordu ve kasa
 * cekmecesi gec aciliyordu.
 *
 * Simdi bu kod BIR KEZ kucuk bir konsol uygulamasina derlenip kullanici veri
 * klasorunde onbellege aliniyor. Sonraki her yazdirma sadece o exe'yi
 * calistiriyor (~50ms). Ayrica program acilirken onden derleniyor
 * (prewarmPrinterHelper), boylece ilk fis de hizli cikiyor.
 */
const HELPER_CS = String.raw`
using System;
using System.IO;
using System.Runtime.InteropServices;
public class AdisyonRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFO di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static int Main(string[] args) {
    if (args.Length < 2) { Console.Error.Write("ARGS"); return 2; }
    byte[] bytes;
    try { bytes = File.ReadAllBytes(args[1]); } catch { Console.Error.Write("NOFILE"); return 3; }
    IntPtr h;
    if(!OpenPrinter(args[0], out h, IntPtr.Zero)) { Console.Error.Write("NOPRINTER"); return 4; }
    DOCINFO di = new DOCINFO(); di.pDocName="Adisyon"; di.pDataType="RAW"; int w=0; bool ok=false;
    if(StartDocPrinter(h,1,ref di)){ if(StartPagePrinter(h)){ ok=WritePrinter(h,bytes,bytes.Length,out w); EndPagePrinter(h);} EndDocPrinter(h);}
    ClosePrinter(h);
    if(!ok) { Console.Error.Write("WRITEFAIL"); return 5; }
    Console.Out.Write("OK");
    return 0;
  }
}
`;

function helperPath(): string {
  return join(app.getPath('userData'), 'print-helper.exe');
}

let helperReady: Promise<string> | null = null;

/** Yardimci exe'yi (yoksa) derler; ayni anda birden fazla derleme yapilmaz. */
function ensureHelper(): Promise<string> {
  if (helperReady) return helperReady;

  helperReady = (async () => {
    const target = helperPath();
    try {
      await access(target);
      return target; // zaten derlenmis
    } catch {
      /* yok, derleyecegiz */
    }

    await mkdir(app.getPath('userData'), { recursive: true });

    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
${HELPER_CS}
"@ -OutputAssembly $env:ADISYON_HELPER_OUT -OutputType ConsoleApplication
`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    await runPowerShell(encoded, { ADISYON_HELPER_OUT: target });
    await access(target);
    return target;
  })().catch((error) => {
    helperReady = null; // basarisizsa bir dahaki sefere tekrar denensin
    throw error;
  });

  return helperReady;
}

/**
 * Program acilirken cagrilir: yardimci exe arka planda hazirlanir, boylece
 * ilk yazdirma/kasa acma da hizli olur. Hata olursa sessizce gecilir - gercek
 * hata mesaji yazdirma aninda kullaniciya gosterilir.
 */
export function prewarmPrinterHelper(): void {
  void ensureHelper().catch(() => {
    /* yazdirma aninda tekrar denenecek */
  });
}

async function sendRawToWindowsPrinter(printerName: string, buffer: Buffer): Promise<void> {
  let dir: string | null = null;
  try {
    const helper = await ensureHelper();

    dir = await mkdtemp(join(tmpdir(), 'adisyon-fis-'));
    const file = join(dir, 'fis.bin');
    await writeFile(file, buffer);

    await runHelper(helper, [printerName, file]);
  } catch (error) {
    if (error instanceof PrinterError) throw error;
    throw new PrinterError(
      error instanceof Error ? `Yazdırma hatası: ${error.message}` : 'Bilinmeyen yazdırma hatası.',
    );
  } finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        /* gecici dosya temizligi kritik degil */
      });
    }
  }
}

function runHelper(exe: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });

    let stderr = '';
    child.stderr?.on('data', (c) => (stderr += String(c)));
    child.on('error', (e) => reject(new PrinterError(e.message)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (stderr.includes('NOPRINTER')) {
        reject(
          new PrinterError(
            `"${args[0]}" adlı yazıcı bulunamadı. Ayarlardaki yazıcı adının ` +
              'Windows’taki yazıcı adıyla birebir aynı olduğundan emin olun.',
          ),
        );
        return;
      }
      reject(new PrinterError('Yazıcıya veri gönderilemedi. Yazıcı açık ve bağlı mı?'));
    });
  });
}

function runPowerShell(encodedCommand: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
      { windowsHide: true, env: { ...process.env, ...env } },
    );

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => (stdout += String(c)));
    child.stderr?.on('data', (c) => (stderr += String(c)));
    child.on('error', (e) => reject(new PrinterError(e.message)));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new PrinterError(stderr.trim() || `Komut ${code} koduyla bitti.`));
    });
  });
}

/* ------------------------------------------------------------- ag hatalari */

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
 * Kasa cekmecesini FIS BASMADAN acar.
 *
 * Neden ayri: Nakit odemede para ustu vermek icin cekmece, hesap fisi
 * basilmadan ONCE acilmali. Ayrica bozuk para alip koymak gibi durumlarda
 * kasiyerin satistan bagimsiz cekmeceyi acabilmesi gerekir.
 *
 * Yazicidan gecer (cekmecenin beslemesi yaziciya bagli); sadece darbe
 * komutu gonderilir, hicbir sey yazdirilmaz.
 */
export async function openCashDrawerOnly(settings: PrinterSettings): Promise<void> {
  if (settings.connection === 'disabled') {
    throw new PrinterError('Yazıcı ayarlardan kapatılmış durumda.');
  }

  const iface =
    settings.connection === 'network' && settings.host
      ? `tcp://${settings.host}:${settings.port}`
      : 'tcp://127.0.0.1:9100';

  const printer = createPrinter(settings, iface);
  printer.openCashDrawer();

  if (settings.connection === 'network') {
    if (!settings.host) throw new PrinterError('Yazıcı IP adresi ayarlardan girilmemiş.');
    try {
      await printer.execute();
    } catch (error) {
      throw new PrinterError(describeNetworkError(error, settings));
    }
    return;
  }

  if (!settings.printerName) {
    throw new PrinterError('Windows yazıcı adı ayarlardan girilmemiş.');
  }
  await sendRawToWindowsPrinter(settings.printerName, printer.getBuffer());
}

/**
 * Baglanti testi. Ag modunda TCP erisimini dener; USB modunda Windows kuyrugu
 * var mi diye bakariz (gercek yazdirma testi "Test fişi bas" ile yapilir).
 */
export async function testConnection(settings: PrinterSettings): Promise<boolean> {
  if (settings.connection === 'network' && settings.host) {
    const printer = createPrinter(settings, `tcp://${settings.host}:${settings.port}`);
    try {
      return await printer.isPrinterConnected();
    } catch {
      return false;
    }
  }
  // USB modunda gercek test fisi basmak daha anlamli; burada true doneriz.
  return settings.connection === 'usb' && !!settings.printerName;
}
