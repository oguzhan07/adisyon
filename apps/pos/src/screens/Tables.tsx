import { useNavigate } from 'react-router';
import { formatTRY, formatElapsed } from '@adisyon/shared';
import { useAreas, useOpenOrders, useOrderMutations, useTables } from '../lib/orderData';
import { describeError } from '../lib/supabase';
import { useFeedback } from '../ui/feedback';
import type { OrderTotals, RestaurantTable } from '../lib/dbTypes';

/**
 * Masa plani. Bolgelere gore gruplanmis masalar; bos/dolu renk kodu, acik
 * adisyonda sure ve tutar gorunur.
 *
 * Bos masaya dokunmak adisyon acar; dolu masaya dokunmak adisyona gider.
 * Ikisi de tek dokunus - en sik yapilan is en kisa yolda (plan tasarim kurali).
 */
export function Tables() {
  const navigate = useNavigate();
  const feedback = useFeedback();
  const areas = useAreas();
  const tables = useTables();
  const openOrders = useOpenOrders();
  const { openOrder } = useOrderMutations();

  const loading = areas.isLoading || tables.isLoading || openOrders.isLoading;
  const error = areas.error || tables.error || openOrders.error;

  // masa_id -> acik adisyon ozeti
  const orderByTable = new Map<string, OrderTotals>();
  for (const order of openOrders.data ?? []) {
    if (order.table_id) orderByTable.set(order.table_id, order);
  }

  async function handleTable(table: RestaurantTable) {
    const existing = orderByTable.get(table.id);
    if (existing) {
      navigate(`/adisyon/${existing.order_id}`);
      return;
    }
    try {
      const orderId = await openOrder.mutateAsync({ tableId: table.id });
      navigate(`/adisyon/${orderId}`);
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  if (loading) return <p className="p-6 text-(--color-text-muted)">Yükleniyor…</p>;
  if (error) {
    return (
      <div className="p-6">
        <p className="text-(--color-status-alert)">{describeError(error)}</p>
      </div>
    );
  }

  const tablesByArea = (areaId: string) =>
    (tables.data ?? []).filter((t) => t.area_id === areaId);

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Masalar</h1>
        <div className="flex items-center gap-4 text-sm text-(--color-text-muted)">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-(--color-status-idle)" /> Boş
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-(--color-status-open)" /> Açık adisyon
          </span>
        </div>
      </div>

      {(areas.data ?? []).map((area) => (
        <section key={area.id} className="mb-7">
          <h2 className="mb-3 text-sm font-semibold text-(--color-text-muted)">{area.name}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {tablesByArea(area.id).map((table) => {
              const order = orderByTable.get(table.id);
              const isOpen = !!order;
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => handleTable(table)}
                  className={[
                    'flex min-h-24 flex-col items-start justify-between rounded-(--radius-card) border-2 p-3 text-left transition-colors',
                    isOpen
                      ? 'border-(--color-status-open) bg-(--color-status-open-soft)'
                      : 'border-(--color-border) bg-(--color-surface-raised) hover:border-(--color-border-strong)',
                  ].join(' ')}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-lg font-bold">{table.name}</span>
                    {table.seats && (
                      <span className="text-xs text-(--color-text-faint)">{table.seats} kişi</span>
                    )}
                  </div>

                  {isOpen ? (
                    <div className="w-full">
                      <div className="tabular text-lg font-semibold text-(--color-status-open)">
                        {formatTRY(order.total_kurus)}
                      </div>
                      <div className="text-xs text-(--color-text-muted)">
                        {formatElapsed(order.opened_at)} · {order.item_count} ürün
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-(--color-text-faint)">Boş</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {(areas.data ?? []).length === 0 && (
        <p className="text-(--color-text-muted)">
          Henüz bölge/masa tanımlanmamış. Ayarlar bölümünden ekleyebilirsiniz.
        </p>
      )}
    </div>
  );
}
