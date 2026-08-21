/**
 * Fis veri sozlesmeleri.
 *
 * Bu tipler renderer (React) ile Electron main sureci arasindaki IPC
 * sinirinda kullanilir. Sablonlar bu veriyi bicimler; veriyi TOPLAMAK
 * renderer'in, BASMAK main surecin isidir.
 */

import type { PaymentMethod, PrinterSettings } from './types';

export interface ReceiptShopInfo {
  shopName: string;
  address: string | null;
  phone: string | null;
  header: string | null;
  footer: string | null;
}

/* -------------------------------------------------------------- ocak fisi */

export interface KitchenTicketItem {
  name: string;
  quantity: number;
  /** Secili varyant/ekstralarin adlari ("Acılı", "Bol Kimyon") */
  options: string[];
  note: string | null;
}

/**
 * Ocak fisi. FIYAT ICERMEZ - ocakta calisan kisiye tutar bilgisi gerekmez,
 * fisi kisa tutmak okunurlugu artirir.
 */
export interface KitchenTicketData {
  orderNo: number;
  tableLabel: string;
  guestCount: number | null;
  printedAt: string;
  items: KitchenTicketItem[];
  /** Adisyonun tamami mi, yoksa yeni eklenen kalemler mi basiliyor */
  isPartial: boolean;
}

/* ------------------------------------------------------------- hesap fisi */

export interface BillItemOption {
  name: string;
  priceDeltaKurus: number;
}

export interface BillItem {
  name: string;
  quantity: number;
  unitPriceKurus: number;
  lineTotalKurus: number;
  options: BillItemOption[];
  note: string | null;
}

export interface BillPayment {
  method: PaymentMethod;
  amountKurus: number;
}

export interface BillData {
  shop: ReceiptShopInfo;
  orderNo: number;
  tableLabel: string;
  openedAt: string;
  closedAt: string;
  /** Fisin fiziksel olarak basildigi an (kagitta gorunur) */
  printedAt: string;
  items: BillItem[];
  subtotalKurus: number;
  discountKurus: number;
  discountReason: string | null;
  totalKurus: number;
  payments: BillPayment[];
  vatPercent: number;
  vatKurus: number;
}

/* ---------------------------------------------------------- gun sonu fisi */

export interface ZReportTopProduct {
  name: string;
  quantity: number;
  revenueKurus: number;
}

export interface ZReportData {
  shop: ReceiptShopInfo;
  businessDay: string;
  printedAt: string;
  orderCount: number;
  grossKurus: number;
  discountKurus: number;
  netKurus: number;
  cashKurus: number;
  cardKurus: number;
  vatKurus: number;
  vatPercent: number;
  avgBasketKurus: number;
  itemCount: number;
  cancelledItemCount: number;
  cancelledItemKurus: number;
  topProducts: ZReportTopProduct[];
}

/* -------------------------------------------------------------- QR etiketi */

export interface QrLabelData {
  shopName: string;
  url: string;
  /** QR kodunun PNG data URI hali (renderer uretir) */
  pngDataUrl: string;
}

/* ------------------------------------------------------------- IPC yuzeyi */

/**
 * Yazici ayarlari her cagriyla gonderilir.
 *
 * Neden main surecinde saklanmiyor: ayarlar veritabaninda duruyor ve
 * kullanici bunlari arayuzden degistiriyor. Ayni ayari iki yerde tutmak
 * (DB + yerel dosya) senkron kalmama riski dogurur; tek kaynak DB olsun,
 * main sureci sadece verilen ayarla bassin.
 */
export interface PrintApi {
  kitchen(settings: PrinterSettings, data: KitchenTicketData): Promise<PrintOutcome>;
  bill(settings: PrinterSettings, data: BillData): Promise<PrintOutcome>;
  zreport(settings: PrinterSettings, data: ZReportData): Promise<PrintOutcome>;
  qrLabel(settings: PrinterSettings, data: QrLabelData): Promise<PrintOutcome>;
  test(settings: PrinterSettings, shopName: string): Promise<PrintOutcome>;
  testConnection(settings: PrinterSettings): Promise<boolean>;
  /** Fis basmadan yalnizca kasa cekmecesini acar (para ustu vermek icin) */
  openDrawer(settings: PrinterSettings): Promise<PrintOutcome>;
}

export interface PrintOutcome {
  ok: boolean;
  /** Kullaniciya gosterilecek Turkce hata mesaji */
  error?: string;
}

/** Windows'ta kurulu bir yazici (ayarlardaki acilir menu icin) */
export interface InstalledPrinter {
  /** Yazdirma icin kullanilan gercek ad - ayarlara bu yazilir */
  name: string;
  /** Kullaniciya gosterilecek ad (cogunlukla name ile ayni) */
  displayName: string;
  /** Surucu/tip aciklamasi - dogru yaziciyi ayirt etmeye yardim eder */
  description: string;
}

/** Urun gorseli hazirlama sonucu (Electron main surecinde sharp ile) */
export interface PreparedImage {
  /** WebP'ye cevrilmis, boyutlandirilmis gorsel - base64 */
  base64: string;
  width: number;
  height: number;
  byteLength: number;
}

/** Renderer'a acilan tum masaustu yetenekleri */
export interface DesktopApi {
  print: PrintApi;
  /** Dosya secme diyalogu; iptal edilirse null */
  pickImage(): Promise<string | null>;
  /** Secilen gorseli menuye uygun boyuta getirir ve WebP'ye cevirir */
  prepareImage(filePath: string): Promise<PreparedImage>;
  /**
   * Windows'ta kurulu yazicilari listeler.
   *
   * Ayarlar ekraninda acilir menu doldurmak icin: yazici adini elle yazmak
   * tek harf hatasinda "yazici bulunamadi" demek oluyordu.
   */
  listPrinters(): Promise<InstalledPrinter[]>;
  /**
   * QR menu sitesinin onbellegini tazeler ("Menüyü yayınla").
   *
   * Neden renderer'dan degil ana surecten: renderer'in CSP'si yalnizca
   * Supabase'e baglanti izni veriyor; menu sitesi baska bir alan adinda
   * oldugu icin oradan yapilan istek engellenir. Ana surecte CSP yoktur,
   * ayrica ileride ozel alan adina gecilse de kod degismez.
   */
  publishMenu(url: string, secret: string): Promise<PrintOutcome>;
  /** Oturum jetonu icin isletim sistemi sifrelemeli depo (safeStorage) */
  secureStore: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  appVersion(): Promise<string>;
}
