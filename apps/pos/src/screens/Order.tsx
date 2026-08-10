import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  formatTRY,
  needsOptionModal,
  type SelectedOption,
} from '@adisyon/shared';
import {
  useCategories,
  useOptionGroups,
  useProducts,
  type OptionGroupWithOptions,
  type ProductWithGroups,
} from '../lib/menuData';
import {
  useOpenOrders,
  useOrderDetail,
  useOrderMutations,
  usePaymentMutations,
  useTables,
  type OrderItemFull,
} from '../lib/orderData';
import { useSettings } from '../lib/settings';
import { buildKitchenTicket } from '../lib/printHelpers';
import { describeError, isDesktop } from '../lib/supabase';
import { Button } from '../ui/Button';
import { useFeedback } from '../ui/feedback';
import { OptionPicker } from './order/OptionPicker';
import { MoveMergeModal } from './order/MoveMergeModal';

/**
 * Adisyon ekrani - sistemin en cok kullanilan yeri.
 *
 * Sol: kategori sekmeleri + urun izgarasi (dokunmatik dostu buyuk butonlar).
 * Sag: adisyon dokumu + anlik toplam + islemler.
 *
 * Toplam HER ZAMAN ekranda (sag panel sabit); urun eklemek varyantsiz urunde
 * tek dokunus, varyantli urunde secim modali acar.
 */
export function Order() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const feedback = useFeedback();

  const categories = useCategories();
  const products = useProducts();
  const optionGroups = useOptionGroups();
  const tables = useTables();
  const settings = useSettings();
  const detail = useOrderDetail(orderId ?? null);
  const {
    addItem,
    changeQuantity,
    cancelItem,
    markKitchenPrinted,
    cancelOrder,
    moveTable,
    mergeOrders,
  } = useOrderMutations();
  const { closeOrder } = usePaymentMutations();
  const openOrders = useOpenOrders();

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [picker, setPicker] = useState<ProductWithGroups | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  const groupsById = useMemo(() => {
    const map = new Map<string, OptionGroupWithOptions>();
    for (const g of optionGroups.data ?? []) map.set(g.id, g);
    return map;
  }, [optionGroups.data]);

  const currentCategory = activeCategory ?? categories.data?.[0]?.id ?? null;
  const visibleProducts = (products.data ?? []).filter(
    (p) => p.category_id === currentCategory,
  );

  const tableName = useMemo(() => {
    const tableId = detail.data?.order.table_id;
    const table = (tables.data ?? []).find((t) => t.id === tableId);
    return table ? `Masa ${table.name}` : 'Paket / Tezgah';
  }, [detail.data, tables.data]);

  /** Urun butonuna dokununca: varyant varsa modal, yoksa dogrudan ekle */
  function handleProductTap(product: ProductWithGroups) {
    if (!orderId) return;
    const groups = product.option_group_ids
      .map((id) => groupsById.get(id))
      .filter((g): g is NonNullable<typeof g> => !!g);

    if (needsOptionModal(groups)) {
      setPicker(product);
      return;
    }
    // Varyantsiz: tek dokunusla ekle
    void quickAdd(product, [], 1, null);
  }

  async function quickAdd(
    product: ProductWithGroups,
    selected: SelectedOption[],
    quantity: number,
    note: string | null,
  ) {
    if (!orderId) return;
    try {
      await addItem.mutateAsync({
        orderId,
        productId: product.id,
        productName: product.name,
        unitPriceKurus: product.price_kurus,
        quantity,
        note,
        selected,
      });
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  async function handleCancelItem(item: OrderItemFull) {
    if (!orderId) return;
    const result = await feedback.confirm({
      title: 'Ürünü iptal et',
      message: `"${item.product_name_snapshot}" adisyondan çıkarılacak.`,
      confirmLabel: 'İptal et',
      danger: true,
      requireReason: true,
      reasonLabel: 'İptal sebebi',
    });
    if (!result.ok) return;
    try {
      await cancelItem.mutateAsync({ itemId: item.id, orderId, reason: result.reason ?? '' });
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  async function handleChangeQty(item: OrderItemFull, delta: number) {
    if (!orderId) return;
    const next = item.quantity + delta;
    if (next < 1) {
      await handleCancelItem(item);
      return;
    }
    try {
      await changeQuantity.mutateAsync({ itemId: item.id, orderId, quantity: next });
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  /** Ocak fisi bas: yalnizca daha once basilmamis kalemler */
  async function printKitchen() {
    if (!orderId || !detail.data || !settings.data) return;
    const unprinted = detail.data.items.filter(
      (i) => i.status !== 'cancelled' && !i.kitchen_printed_at,
    );
    if (unprinted.length === 0) {
      feedback.toast('Basılacak yeni ürün yok.', 'info');
      return;
    }

    const ticket = buildKitchenTicket(detail.data, tableName, unprinted.map((i) => i.id));
    const result = await window.desktop.print.kitchen(settings.data.printer, ticket);

    if (result.ok) {
      await markKitchenPrinted.mutateAsync({ orderId, itemIds: unprinted.map((i) => i.id) });
      feedback.toast('Ocak fişi basıldı.', 'ok');
    } else {
      // Yazici hatasi adisyonu bloke etmez; sadece uyariyoruz
      feedback.toast(result.error ?? 'Ocak fişi basılamadı.', 'error');
    }
  }

  /**
   * Siparisi kaydedip masa planina doner. Kalemler eklenirken zaten anlik
   * kaydediliyor; bu buton garsona "kaydettim, cikiyorum" guveni verir ve
   * (ayar aciksa) yeni kalemleri ocak fisi olarak bastirir. Masa ACIK kalir;
   * musteriler yerken sonra odeme icin geri donulur.
   */
  async function handleSaveAndExit() {
    if (!orderId) {
      navigate('/masalar');
      return;
    }

    // Otomatik ocak fisi ayari aciksa yeni kalemleri ocaga gonder (masaustunde)
    if (isDesktop && settings.data?.printer.autoPrintKitchenTicket && detail.data) {
      const unprinted = detail.data.items.filter(
        (i) => i.status !== 'cancelled' && !i.kitchen_printed_at,
      );
      if (unprinted.length > 0) {
        const ticket = buildKitchenTicket(detail.data, tableName, unprinted.map((i) => i.id));
        const result = await window.desktop.print.kitchen(settings.data.printer, ticket);
        if (result.ok) {
          await markKitchenPrinted.mutateAsync({ orderId, itemIds: unprinted.map((i) => i.id) });
        } else {
          // Yazici hatasi cikisi engellemez; siparis zaten kayitli
          feedback.toast(result.error ?? 'Ocak fişi basılamadı.', 'error');
        }
      }
    }

    feedback.toast('Masa kaydedildi.', 'ok');
    navigate('/masalar');
  }

  /**
   * Masayi odeme almadan kapatir. Iki durum:
   *  - Bos masa (urun yok): yanlis acilmis, adisyon IPTAL edilir (satis sayilmaz).
   *  - Urun var: ikram/zarar olarak odemesiz kapatilir; urunler servis edildigi
   *    icin stok duser. Her iki durumda da once onay sorulur.
   */
  async function handleCloseTable() {
    if (!orderId || !detail.data) return;
    const hasItems = detail.data.items.some((i) => i.status !== 'cancelled');

    if (!hasItems) {
      const result = await feedback.confirm({
        title: 'Masayı kapat',
        message: 'Bu masada ürün yok. Adisyon iptal edilecek (satış sayılmaz).',
        confirmLabel: 'İptal et',
        danger: true,
      });
      if (!result.ok) return;
      try {
        await cancelOrder.mutateAsync({ orderId, reason: 'Boş masa kapatıldı' });
        feedback.toast('Masa kapatıldı.', 'ok');
        navigate('/masalar');
      } catch (e) {
        feedback.toast(describeError(e), 'error');
      }
      return;
    }

    const result = await feedback.confirm({
      title: 'Ödeme almadan kapat',
      message:
        'Bu masa ödeme alınmadan kapatılacak (ikram/iptal). Ürünler stoktan düşülür. Emin misiniz?',
      confirmLabel: 'Ödemesiz kapat',
      danger: true,
    });
    if (!result.ok) return;
    try {
      await closeOrder.mutateAsync({ orderId, allowUnpaid: true });
      feedback.toast('Masa ödeme alınmadan kapatıldı.', 'ok');
      navigate('/masalar');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  if (detail.isLoading) return <p className="p-6 text-(--color-text-muted)">Yükleniyor…</p>;
  if (detail.error || !detail.data) {
    return (
      <div className="p-6">
        <p className="text-(--color-status-alert)">{describeError(detail.error)}</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/masalar')}>
          Masalara dön
        </Button>
      </div>
    );
  }

  const activeItems = detail.data.items.filter((i) => i.status !== 'cancelled');
  const totals = detail.data.totals;

  return (
    <div className="flex h-full">
      {/* SOL: urun secimi */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-(--color-border) px-4 py-3">
          <Button variant="ghost" onClick={() => navigate('/masalar')}>
            ← Masalar
          </Button>
          <div>
            <div className="font-semibold">{tableName}</div>
            <div className="text-xs text-(--color-text-faint)">Adisyon #{detail.data.order.order_no}</div>
          </div>
          <Button variant="secondary" className="ml-auto" onClick={() => setMoveOpen(true)}>
            Masa taşı / birleştir
          </Button>
        </div>

        {/* Kategori sekmeleri */}
        <div className="scroll-thin flex gap-2 overflow-x-auto border-b border-(--color-border) px-4 py-2">
          {(categories.data ?? []).map((category) => {
            const isActive = category.id === currentCategory;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={[
                  'min-h-12 shrink-0 rounded-(--radius-control) px-4 font-medium',
                  isActive
                    ? 'bg-(--color-accent) text-(--color-accent-fg)'
                    : 'bg-(--color-surface-sunken) text-(--color-text-muted)',
                ].join(' ')}
              >
                {category.name}
              </button>
            );
          })}
        </div>

        {/* Urun izgarasi */}
        <div className="scroll-thin grid flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto p-4">
          {visibleProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              disabled={!product.is_available}
              onClick={() => handleProductTap(product)}
              className={[
                'flex min-h-20 flex-col justify-between rounded-(--radius-card) border-2 border-(--color-border) bg-(--color-surface-raised) p-3 text-left transition-colors',
                product.is_available
                  ? 'hover:border-(--color-accent)'
                  : 'cursor-not-allowed opacity-50',
              ].join(' ')}
            >
              <span className="font-medium">{product.name}</span>
              <span className="tabular mt-2 font-semibold text-(--color-accent)">
                {formatTRY(product.price_kurus)}
                {!product.is_available && (
                  <span className="ml-2 text-xs text-(--color-status-alert)">Tükendi</span>
                )}
              </span>
            </button>
          ))}
          {visibleProducts.length === 0 && (
            <p className="text-(--color-text-muted)">Bu kategoride ürün yok.</p>
          )}
        </div>
      </div>

      {/* SAG: adisyon dokumu (sabit, toplam her zaman gorunur) */}
      <aside className="flex w-96 shrink-0 flex-col border-l border-(--color-border) bg-(--color-surface-raised)">
        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          {activeItems.length === 0 ? (
            <p className="mt-8 text-center text-(--color-text-faint)">
              Henüz ürün eklenmedi.
              <br />
              Soldan ürün seçin.
            </p>
          ) : (
            <ul className="space-y-2">
              {activeItems.map((item) => (
                <OrderItemRow
                  key={item.id}
                  item={item}
                  onInc={() => handleChangeQty(item, 1)}
                  onDec={() => handleChangeQty(item, -1)}
                  onCancel={() => handleCancelItem(item)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Toplam + islemler */}
        <div className="border-t border-(--color-border) p-4">
          {totals.discount_kurus > 0 && (
            <div className="mb-1 flex justify-between text-sm text-(--color-text-muted)">
              <span>Ara toplam</span>
              <span className="tabular">{formatTRY(totals.subtotal_kurus)}</span>
            </div>
          )}
          {totals.discount_kurus > 0 && (
            <div className="mb-1 flex justify-between text-sm text-(--color-status-ready)">
              <span>İndirim</span>
              <span className="tabular">−{formatTRY(totals.discount_kurus)}</span>
            </div>
          )}
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-semibold">Toplam</span>
            <span className="tabular text-2xl font-bold">{formatTRY(totals.total_kurus)}</span>
          </div>

          {/* Ana islem: siparisi kaydet ve masa planina don (masa acik kalir) */}
          <Button size="lg" className="w-full" onClick={handleSaveAndExit}>
            Kaydet ve Çık
          </Button>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={printKitchen}>
              Ocak fişi
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(`/kasa/${orderId}`)}
              disabled={activeItems.length === 0}
            >
              Hesap / Öde
            </Button>
          </div>

          {/* Odeme almadan kapat: bos masayi iptal eder, dolu masayi ikram/zarar
              olarak kapatir. Her iki durumda da onay sorar. */}
          <button
            type="button"
            onClick={handleCloseTable}
            className="mt-2 min-h-11 w-full rounded-(--radius-control) text-sm text-(--color-status-alert) hover:bg-(--color-status-alert-soft)"
          >
            Masayı ödeme almadan kapat
          </button>
        </div>
      </aside>

      {picker && (
        <OptionPicker
          product={picker}
          groups={picker.option_group_ids
            .map((id) => groupsById.get(id))
            .filter((g): g is NonNullable<typeof g> => !!g)}
          onCancel={() => setPicker(null)}
          onConfirm={({ selected, quantity, note }) => {
            void quickAdd(picker, selected, quantity, note);
            setPicker(null);
          }}
        />
      )}

      {moveOpen && (
        <MoveMergeModal
          currentTableId={detail.data.order.table_id}
          tables={tables.data ?? []}
          openOrders={openOrders.data ?? []}
          onClose={() => setMoveOpen(false)}
          onMove={async (tableId) => {
            if (!orderId) return;
            try {
              await moveTable.mutateAsync({ orderId, tableId });
              feedback.toast('Masa taşındı.', 'ok');
              setMoveOpen(false);
            } catch (e) {
              feedback.toast(describeError(e), 'error');
            }
          }}
          onMerge={async (targetOrderId) => {
            if (!orderId) return;
            try {
              await mergeOrders.mutateAsync({ sourceOrderId: orderId, targetOrderId });
              feedback.toast('Adisyonlar birleştirildi.', 'ok');
              navigate(`/adisyon/${targetOrderId}`);
            } catch (e) {
              feedback.toast(describeError(e), 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function OrderItemRow({
  item,
  onInc,
  onDec,
  onCancel,
}: {
  item: OrderItemFull;
  onInc: () => void;
  onDec: () => void;
  onCancel: () => void;
}) {
  const optionsTotal = item.options.reduce((s, o) => s + o.price_delta_kurus_snapshot, 0);
  const lineTotal = (item.unit_price_kurus_snapshot + optionsTotal) * item.quantity;

  return (
    <li className="rounded-(--radius-control) border border-(--color-border) p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{item.product_name_snapshot}</div>
          {item.options.length > 0 && (
            <div className="text-xs text-(--color-text-muted)">
              {item.options.map((o) => o.option_name_snapshot).join(' · ')}
            </div>
          )}
          {item.note && (
            <div className="text-xs text-(--color-accent)">Not: {item.note}</div>
          )}
        </div>
        <span className="tabular shrink-0 font-semibold">{formatTRY(lineTotal)}</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDec}
            className="flex size-9 items-center justify-center rounded-(--radius-control) bg-(--color-surface-sunken) text-lg"
          >
            −
          </button>
          <span className="tabular w-8 text-center font-semibold">{item.quantity}</span>
          <button
            type="button"
            onClick={onInc}
            className="flex size-9 items-center justify-center rounded-(--radius-control) bg-(--color-surface-sunken) text-lg"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-(--color-status-alert) hover:underline"
        >
          İptal
        </button>
      </div>
    </li>
  );
}
