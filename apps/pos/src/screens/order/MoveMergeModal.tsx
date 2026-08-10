import { Modal } from '../../ui/Modal';
import type { OrderTotals, RestaurantTable } from '../../lib/dbTypes';

/**
 * Masa tasi / birlestir modali (adisyon ekranindan acilir).
 *
 * Bos masaya dokunmak adisyonu TASIR; acik adisyonu olan masaya dokunmak iki
 * adisyonu BIRLESTIRIR. Mevcut masa listede gosterilmez.
 */
export function MoveMergeModal({
  currentTableId,
  onClose,
  onMove,
  onMerge,
  tables,
  openOrders,
}: {
  currentTableId: string | null;
  onClose: () => void;
  onMove: (tableId: string) => void;
  onMerge: (targetOrderId: string) => void;
  tables: RestaurantTable[];
  openOrders: OrderTotals[];
}) {
  const openByTable = new Map(
    openOrders.filter((o) => o.table_id).map((o) => [o.table_id as string, o]),
  );

  return (
    <Modal open onClose={onClose} title="Masa taşı / birleştir" wide>
      <p className="mb-3 text-sm text-(--color-text-muted)">
        Boş masaya dokunmak <strong>taşır</strong>; açık adisyonu olan masaya dokunmak iki adisyonu{' '}
        <strong>birleştirir</strong>.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
        {tables
          .filter((t) => t.id !== currentTableId)
          .map((table) => {
            const openOrder = openByTable.get(table.id);
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => (openOrder ? onMerge(openOrder.order_id) : onMove(table.id))}
                className={[
                  'flex min-h-16 flex-col items-center justify-center rounded-(--radius-control) border-2 p-2',
                  openOrder
                    ? 'border-(--color-status-open) bg-(--color-status-open-soft)'
                    : 'border-(--color-border) hover:border-(--color-border-strong)',
                ].join(' ')}
              >
                <span className="font-semibold">{table.name}</span>
                <span className="text-xs text-(--color-text-faint)">
                  {openOrder ? 'birleştir' : 'boş'}
                </span>
              </button>
            );
          })}
      </div>
    </Modal>
  );
}
