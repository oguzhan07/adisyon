import type { ZReportData, ZReportTopProduct } from '@adisyon/shared';
import type { DailySummary } from './reportData';
import type { SettingsRow } from './settings';
import { toReceiptShopInfo } from './settings';

/** Gun sonu ozetinden yazici icin Z raporu verisi olusturur */
export function buildZReport(
  summary: DailySummary,
  settings: SettingsRow,
  topProducts: ZReportTopProduct[],
  _startHour: number,
): ZReportData {
  return {
    shop: toReceiptShopInfo(settings),
    businessDay: summary.business_day,
    printedAt: new Date().toISOString(),
    orderCount: summary.order_count,
    grossKurus: summary.gross_kurus,
    discountKurus: summary.discount_kurus,
    netKurus: summary.net_kurus,
    cashKurus: summary.cash_kurus,
    cardKurus: summary.card_kurus,
    vatKurus: summary.vat_kurus,
    vatPercent: settings.vat_percent,
    avgBasketKurus: summary.avg_basket_kurus,
    itemCount: summary.item_count,
    cancelledItemCount: summary.cancelled_item_count,
    cancelledItemKurus: summary.cancelled_item_kurus,
    topProducts,
  };
}
