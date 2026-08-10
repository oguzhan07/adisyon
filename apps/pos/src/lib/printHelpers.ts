import {
  vatFromGross,
  type BillData,
  type KitchenTicketData,
  type PaymentMethod,
} from '@adisyon/shared';
import type { OrderDetail } from './orderData';
import type { SettingsRow } from './settings';
import { toReceiptShopInfo } from './settings';

/** Adisyon detayindan ocak fisi verisi olusturur (yalnizca belirtilen kalemler) */
export function buildKitchenTicket(
  detail: OrderDetail,
  tableLabel: string,
  itemIds: string[] | null,
): KitchenTicketData {
  const items = detail.items
    .filter((i) => i.status !== 'cancelled')
    .filter((i) => (itemIds ? itemIds.includes(i.id) : true))
    .map((i) => ({
      name: i.product_name_snapshot,
      quantity: i.quantity,
      options: i.options.map((o) => o.option_name_snapshot),
      note: i.note,
    }));

  return {
    orderNo: detail.order.order_no,
    tableLabel,
    guestCount: detail.order.guest_count,
    printedAt: new Date().toISOString(),
    items,
    isPartial: itemIds !== null,
  };
}

/** Adisyon detayindan hesap fisi verisi olusturur */
export function buildBill(
  detail: OrderDetail,
  tableLabel: string,
  settings: SettingsRow,
): BillData {
  const items = detail.items
    .filter((i) => i.status !== 'cancelled')
    .map((i) => {
      const optionsTotal = i.options.reduce((s, o) => s + o.price_delta_kurus_snapshot, 0);
      const unit = i.unit_price_kurus_snapshot + optionsTotal;
      return {
        name: i.product_name_snapshot,
        quantity: i.quantity,
        unitPriceKurus: unit,
        lineTotalKurus: unit * i.quantity,
        options: i.options.map((o) => ({
          name: o.option_name_snapshot,
          priceDeltaKurus: o.price_delta_kurus_snapshot,
        })),
        note: i.note,
      };
    });

  return {
    shop: toReceiptShopInfo(settings),
    orderNo: detail.order.order_no,
    tableLabel,
    openedAt: detail.order.opened_at,
    closedAt: detail.order.closed_at ?? new Date().toISOString(),
    printedAt: new Date().toISOString(),
    items,
    subtotalKurus: detail.totals.subtotal_kurus,
    discountKurus: detail.totals.discount_kurus,
    discountReason: detail.order.discount_reason,
    totalKurus: detail.totals.total_kurus,
    payments: detail.payments.map((p) => ({
      method: p.method as PaymentMethod,
      amountKurus: p.amount_kurus,
    })),
    vatPercent: settings.vat_percent,
    vatKurus: vatFromGross(detail.totals.total_kurus, settings.vat_percent),
  };
}
