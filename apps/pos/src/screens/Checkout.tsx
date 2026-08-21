import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  formatTRY,
  parseTRYToKurus,
  percentDiscount,
  splitEvenly,
  PAYMENT_METHOD_LABELS,
} from '@adisyon/shared';
import {
  useOrderDetail,
  useOrderMutations,
  usePaymentMutations,
  useTables,
} from '../lib/orderData';
import { useSettings } from '../lib/settings';
import { buildBill } from '../lib/printHelpers';
import { describeError } from '../lib/supabase';
import { Button } from '../ui/Button';
import { NumPad } from '../ui/NumPad';
import { Modal } from '../ui/Modal';
import { useFeedback } from '../ui/feedback';

/**
 * Kasa ekrani: odeme, hesap bolme, indirim ve adisyon kapatma. Kapanis
 * rpc_close_order uzerinden gecer (kalan tutar kontrolu + stok dusum tetigi);
 * ardindan hesap fisi basilir ve cekmece acilir.
 *
 * Masa tasima/birlestirme burada DEGIL, adisyon (siparis girme) ekranindadir.
 */
export function Checkout() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const feedback = useFeedback();

  const detail = useOrderDetail(orderId ?? null);
  const tables = useTables();
  const settings = useSettings();
  const { addPayment, removePayment, closeOrder } = usePaymentMutations();
  const { applyDiscount } = useOrderMutations();

  const [method, setMethod] = useState<'cash' | 'card'>('cash');
  const [amountText, setAmountText] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);

  const tableName = useMemo(() => {
    const tableId = detail.data?.order.table_id;
    const table = (tables.data ?? []).find((t) => t.id === tableId);
    return table ? `Masa ${table.name}` : 'Paket / Tezgah';
  }, [detail.data, tables.data]);

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

  const totals = detail.data.totals;
  const remaining = totals.remaining_kurus;

  async function addAmount(amountKurus: number) {
    if (!orderId) return;
    if (amountKurus <= 0) {
      feedback.toast('Geçerli bir tutar girin.', 'error');
      return;
    }
    try {
      await addPayment.mutateAsync({ orderId, method, amountKurus });
      setAmountText('');

      // NAKIT odemede kasa hemen acilir: kasiyer para ustunu fis basilmadan
      // verebilmeli. Kartta acilmaz - ihtiyac yok ve bolunmus odemede cekmece
      // gereksiz yere tekrar tekrar acilirdi.
      if (method === 'cash') void openDrawer(true);
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  function fillRemaining() {
    setAmountText(String(remaining / 100).replace('.', ','));
  }

  function fillSplit(parts: number) {
    const share = splitEvenly(remaining, parts)[0] ?? 0;
    setAmountText(String(share / 100).replace('.', ','));
  }

  /**
   * Fis basmadan cekmeceyi acar - nakit odemede para ustu vermek icin.
   *
   * @param silent Otomatik acilislarda (odeme eklendiginde) true: yazici
   *   kapaliysa her odemede hata balonu cikmasin. Kullanici "Kasayı aç"
   *   dugmesine bastiginda ise hatayi gormeli.
   */
  async function openDrawer(silent = false) {
    if (!settings.data) return;
    if (silent && settings.data.printer.connection === 'disabled') return;

    const result = await window.desktop.print.openDrawer(settings.data.printer);
    if (!result.ok && !silent) {
      feedback.toast(result.error ?? 'Kasa açılamadı.', 'error');
    }
  }

  async function handleClose() {
    if (!orderId || !settings.data) return;

    const allowUnpaid = remaining > 0;
    if (allowUnpaid) {
      const result = await feedback.confirm({
        title: 'Adisyonu kapat',
        message: `Kalan ${formatTRY(remaining)} tahsil edilmedi. Yine de kapatmak istiyor musunuz?`,
        confirmLabel: 'Yine de kapat',
        danger: true,
      });
      if (!result.ok) return;
    } else {
      const result = await feedback.confirm({
        title: 'Adisyonu kapat',
        message: 'Hesap tahsil edildi. Adisyon kapatılıp hesap fişi basılacak.',
        confirmLabel: 'Kapat ve fiş bas',
      });
      if (!result.ok) return;
    }

    try {
      await closeOrder.mutateAsync({ orderId, allowUnpaid });

      // Kapanistan SONRA guncel veriyle fis bas (kapanis saati dahil)
      const fresh = await detail.refetch();
      if (fresh.data && settings.data) {
        const bill = buildBill(fresh.data, tableName, settings.data);
        const printed = await window.desktop.print.bill(settings.data.printer, bill);
        if (!printed.ok) {
          feedback.toast(`Adisyon kapandı ama fiş basılamadı: ${printed.error}`, 'error');
        }
      }

      feedback.toast('Adisyon kapatıldı.', 'ok');
      navigate('/masalar');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  return (
    <div className="flex h-full">
      {/* SOL: ozet + odemeler */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-(--color-border) px-4 py-3">
          <Button variant="ghost" onClick={() => navigate(`/adisyon/${orderId}`)}>
            ← Adisyon
          </Button>
          <div>
            <div className="font-semibold">{tableName}</div>
            <div className="text-xs text-(--color-text-faint)">Adisyon #{detail.data.order.order_no}</div>
          </div>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-5">
          {/* Ozet kutusu */}
          <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5">
            <div className="flex justify-between text-(--color-text-muted)">
              <span>Ara toplam</span>
              <span className="tabular">{formatTRY(totals.subtotal_kurus)}</span>
            </div>
            {totals.discount_kurus > 0 && (
              <div className="mt-1 flex justify-between text-(--color-status-ready)">
                <span>İndirim {detail.data.order.discount_reason && `(${detail.data.order.discount_reason})`}</span>
                <span className="tabular">−{formatTRY(totals.discount_kurus)}</span>
              </div>
            )}
            <div className="mt-2 flex items-baseline justify-between border-t border-(--color-border) pt-2">
              <span className="font-semibold">Toplam</span>
              <span className="tabular text-2xl font-bold">{formatTRY(totals.total_kurus)}</span>
            </div>
            <div className="mt-1 flex justify-between text-(--color-text-muted)">
              <span>Ödenen</span>
              <span className="tabular">{formatTRY(totals.paid_kurus)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-semibold text-(--color-accent)">Kalan</span>
              <span className="tabular text-xl font-bold text-(--color-accent)">
                {formatTRY(remaining)}
              </span>
            </div>
          </div>

          {/* Eklenen odemeler */}
          {detail.data.payments.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold text-(--color-text-muted)">Ödemeler</h3>
              <ul className="space-y-2">
                {detail.data.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-(--radius-control) border border-(--color-border) px-3 py-2"
                  >
                    <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular font-semibold">{formatTRY(p.amount_kurus)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          orderId && removePayment.mutate({ paymentId: p.id, orderId })
                        }
                        className="text-sm text-(--color-status-alert) hover:underline"
                      >
                        Sil
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Yonetim islemleri */}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDiscountOpen(true)}>
              İndirim / ikram
            </Button>
            {/* Para ustu vermek icin: fis basmadan cekmeceyi acar */}
            <Button variant="secondary" onClick={() => openDrawer()}>
              Kasayı aç
            </Button>
          </div>
        </div>
      </div>

      {/* SAG: odeme girisi */}
      <aside className="flex w-96 shrink-0 flex-col border-l border-(--color-border) bg-(--color-surface-raised) p-4">
        {/* Yontem */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(['cash', 'card'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={[
                'min-h-12 rounded-(--radius-control) border-2 font-medium',
                method === m
                  ? 'border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent)'
                  : 'border-(--color-border) text-(--color-text-muted)',
              ].join(' ')}
            >
              {PAYMENT_METHOD_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Tutar */}
        <div className="mb-2 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface) px-3 py-3 text-right">
          <span className="tabular text-2xl font-bold">
            {amountText === '' ? '0,00' : amountText} ₺
          </span>
        </div>

        {/* Hizli tutar */}
        <div className="mb-2 grid grid-cols-4 gap-2">
          <Button variant="ghost" onClick={fillRemaining} className="text-sm">
            Kalan
          </Button>
          <Button variant="ghost" onClick={() => fillSplit(2)} className="text-sm">
            2'ye
          </Button>
          <Button variant="ghost" onClick={() => fillSplit(3)} className="text-sm">
            3'e
          </Button>
          <Button variant="ghost" onClick={() => fillSplit(4)} className="text-sm">
            4'e
          </Button>
        </div>

        <NumPad value={amountText} onChange={setAmountText} decimal />

        <Button
          size="lg"
          className="mt-3"
          onClick={() => {
            const kurus = parseTRYToKurus(amountText);
            if (kurus === null) {
              feedback.toast('Geçerli bir tutar girin.', 'error');
              return;
            }
            void addAmount(kurus);
          }}
          disabled={amountText === ''}
        >
          Ödeme ekle
        </Button>

        {remaining <= 0 ? (
          <Button size="lg" variant="primary" className="mt-2" onClick={handleClose}>
            Kapat ve fiş bas
          </Button>
        ) : (
          <>
            {/* Kismi odeme senaryosu: bir kisim odedi, gerisi sonra odeyecek.
                Masa ACIK kalir, alinan odeme kayitli; kasadan cikilir, sonra
                donup kalan tahsil edilir. */}
            <Button
              size="lg"
              variant="secondary"
              className="mt-2"
              onClick={() => navigate('/masalar')}
            >
              Kaydet ve Çık (masa açık kalsın)
            </Button>

            {/* Kalani tahsil etmeden kapatma (ikram/zarar) - onay sorar */}
            <button
              type="button"
              onClick={handleClose}
              className="mt-2 min-h-11 w-full rounded-(--radius-control) text-sm text-(--color-status-alert) hover:bg-(--color-status-alert-soft)"
            >
              Ödeme almadan kapat
            </button>
          </>
        )}
      </aside>

      {discountOpen && orderId && (
        <DiscountModal
          currentSubtotal={totals.subtotal_kurus}
          onClose={() => setDiscountOpen(false)}
          onApply={async (kurus, reason) => {
            try {
              await applyDiscount.mutateAsync({ orderId, discountKurus: kurus, reason });
              feedback.toast('İndirim uygulandı.', 'ok');
              setDiscountOpen(false);
            } catch (e) {
              feedback.toast(describeError(e), 'error');
            }
          }}
        />
      )}

    </div>
  );
}

/* --------------------------------------------------------------- indirim */

function DiscountModal({
  currentSubtotal,
  onClose,
  onApply,
}: {
  currentSubtotal: number;
  onClose: () => void;
  onApply: (kurus: number, reason: string) => void;
}) {
  const [amountText, setAmountText] = useState('');
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');

  const kurus = (() => {
    if (percent) return percentDiscount(currentSubtotal, Number(percent) || 0);
    return parseTRYToKurus(amountText) ?? 0;
  })();

  return (
    <Modal
      open
      onClose={onClose}
      title="İndirim / ikram"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            onClick={() => onApply(kurus, reason.trim())}
            disabled={kurus <= 0 || reason.trim() === ''}
          >
            Uygula ({formatTRY(kurus)})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
            Tutar (₺)
          </label>
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setPercent('');
            }}
            className="tabular w-full min-h-12 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface-raised) px-3 text-right text-base"
          />
        </div>
        <div className="text-center text-sm text-(--color-text-faint)">— veya —</div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
            Yüzde (%)
          </label>
          <input
            inputMode="numeric"
            value={percent}
            onChange={(e) => {
              setPercent(e.target.value);
              setAmountText('');
            }}
            className="tabular w-full min-h-12 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface-raised) px-3 text-right text-base"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
            Sebep (zorunlu)
          </label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Örn. müdavim ikramı"
            className="w-full min-h-12 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface-raised) px-3 text-base"
          />
        </div>
      </div>
    </Modal>
  );
}
