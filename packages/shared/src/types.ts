/**
 * Alan (domain) tipleri.
 *
 * Veritabanindan uretilen tipler `database.types.ts` icinde durur
 * (`npm run db:types`). Bu dosya ise iki uygulamanin ortak kullandigi
 * anlamsal tipleri ve sabit listeleri tutar.
 */

import type { BaseUnit, PurchaseUnit } from './units';

/* ---------------------------------------------------------------- Adisyon */

export const ORDER_STATUSES = ['open', 'closed', 'cancelled', 'merged'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_ITEM_STATUSES = ['new', 'preparing', 'ready', 'cancelled'] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

export const ORDER_ITEM_STATUS_LABELS: Record<OrderItemStatus, string> = {
  new: 'Bekliyor',
  preparing: 'Hazırlanıyor',
  ready: 'Hazır',
  cancelled: 'İptal',
};

/** Ocak ekranindaki ileri yonlu akis. 'cancelled' ayri bir islemdir. */
export const KITCHEN_FLOW: readonly OrderItemStatus[] = ['new', 'preparing', 'ready'];

export function nextKitchenStatus(current: OrderItemStatus): OrderItemStatus | null {
  const index = KITCHEN_FLOW.indexOf(current);
  if (index < 0 || index === KITCHEN_FLOW.length - 1) return null;
  return KITCHEN_FLOW[index + 1];
}

/* ----------------------------------------------------------------- Odeme */

export const PAYMENT_METHODS = ['cash', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Nakit',
  card: 'Kart',
};

/* ------------------------------------------------------------------ Stok */

export const MOVEMENT_TYPES = [
  'opening', // acilis stogu (ilk kurulumda girilen mevcut mal)
  'purchase', // mal kabul
  'sale', // satistan otomatik dusum (recete uzerinden)
  'waste', // zayi / fire
  'count_adjust', // sayim sonrasi duzeltme
  'manual', // elle duzeltme (sebep zorunlu)
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  opening: 'Açılış stoğu',
  purchase: 'Mal kabul',
  sale: 'Satış tüketimi',
  waste: 'Zayi',
  count_adjust: 'Sayım düzeltmesi',
  manual: 'Elle düzeltme',
};

export const STOCK_COUNT_STATUSES = ['draft', 'applied'] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];

/* --------------------------------------------------------------- Ayarlar */

export interface PrinterSettings {
  /** Ag baglantisi kararlidir; USB sadece ag mumkun degilse kullanilir. */
  connection: 'network' | 'usb' | 'disabled';
  /** connection === 'network' icin */
  host: string | null;
  port: number;
  /** connection === 'usb' icin: Windows'ta paylasilan yazici adi */
  printerName: string | null;
  /** POSA 80mm: 48 karakter. 58mm yazicida 32'ye dusurulur. */
  charactersPerLine: number;
  /** Hesap kapaninca kasa cekmecesini ac (ESC p) */
  openCashDrawerOnClose: boolean;
  /** Adisyona urun eklenince ocak fisini otomatik bas */
  autoPrintKitchenTicket: boolean;
}

export interface ShopSettings {
  shopName: string;
  address: string | null;
  phone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  /** KDV orani, yuzde. Fiyatlar KDV DAHIL girilir. */
  vatPercent: number;
  /** Is gunu baslangic saati (0-23). Gece kapanislari icin kritik. */
  businessDayStartHour: number;
  /** Stok raporunda bu yuzdeyi asan fark isaretlenir */
  stockVarianceThresholdPercent: number;
  printer: PrinterSettings;
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  connection: 'network',
  host: null,
  port: 9100,
  printerName: null,
  charactersPerLine: 48,
  openCashDrawerOnClose: true,
  autoPrintKitchenTicket: true,
};

/* ------------------------------------------------------- Yazdirma islemi */

export type ReceiptKind = 'kitchen' | 'bill' | 'zreport' | 'test' | 'qr';

export interface PrintResult {
  ok: boolean;
  /** Kullaniciya gosterilecek Turkce hata mesaji */
  error?: string;
}

/* --------------------------------------------------- Stok raporu satiri */

/**
 * `rpc_stock_report` ciktisinin bir satiri.
 * Planin cekirdek istegi: teorik kalan ile fiili sayimin kiyaslanmasi.
 */
export interface StockReportRow {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: BaseUnit;
  /** Donem basi devir */
  opening_qty: number;
  /** Mal kabul girisleri */
  purchased_qty: number;
  /** Satilan urunlerin receteleri uzerinden hesaplanan tuketim */
  sold_qty: number;
  /** Zayi / fire */
  waste_qty: number;
  /** Sayim duzeltmeleri ve elle duzeltmeler */
  adjustment_qty: number;
  /** devir + giren - satis - zayi ± duzeltme */
  theoretical_qty: number;
  /** Donem icindeki son sayimda okunan fiili miktar (sayim yoksa null) */
  counted_qty: number | null;
  /** counted - theoretical. Negatif = beklenenden fazla harcanmis. */
  variance_qty: number | null;
  variance_percent: number | null;
  /** variance x agirlikli ortalama birim maliyet */
  variance_cost_kurus: number | null;
  avg_cost_kurus: number;
  min_stock: number | null;
  is_below_min: boolean;
}

export interface PurchaseLineInput {
  ingredient_id: string;
  purchase_unit: PurchaseUnit;
  purchase_quantity: number;
  unit_cost_kurus: number;
}
