import { useMemo, useState } from 'react';
import {
  formatTRY,
  formatPriceDelta,
  lineTotal,
  validateSelection,
  type SelectedOption,
} from '@adisyon/shared';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import type { OptionGroupWithOptions } from '../../lib/menuData';
import type { ProductWithGroups } from '../../lib/menuData';

interface Props {
  product: ProductWithGroups;
  groups: OptionGroupWithOptions[];
  onCancel: () => void;
  onConfirm: (payload: { selected: SelectedOption[]; quantity: number; note: string | null }) => void;
}

/**
 * Varyantli urun icin secim modali. Acilik/porsiyon (tek secim) ve ekstralar
 * (cok secim) burada secilir; fiyat farki canli hesaplanir. Zorunlu grup
 * secilmeden "Ekle" pasiftir - eksik siparis ocaga dusemez.
 */
export function OptionPicker({ product, groups, onCancel, onConfirm }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  function toggle(group: OptionGroupWithOptions, optionId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (group.selection_type === 'single') {
        // Tek secim: ayni gruptaki digerlerini kaldir
        for (const opt of group.options) next.delete(opt.id);
        next.add(optionId);
      } else {
        if (next.has(optionId)) next.delete(optionId);
        else next.add(optionId);
      }
      return next;
    });
  }

  const selected: SelectedOption[] = useMemo(() => {
    const result: SelectedOption[] = [];
    for (const group of groups) {
      for (const option of group.options) {
        if (selectedIds.has(option.id)) {
          result.push({
            option_id: option.id,
            name: option.name,
            price_delta_kurus: option.price_delta_kurus,
          });
        }
      }
    }
    return result;
  }, [groups, selectedIds]);

  const errors = validateSelection(groups, [...selectedIds]);
  const total = lineTotal(product.price_kurus, selected, quantity);

  return (
    <Modal
      open
      onClose={onCancel}
      title={product.name}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Vazgeç
          </Button>
          <Button
            onClick={() => onConfirm({ selected, quantity, note: note.trim() || null })}
            disabled={errors.length > 0}
          >
            Ekle · {formatTRY(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {groups.map((group) => {
          const available = group.options.filter((o) => o.is_available);
          if (available.length === 0) return null;
          return (
            <div key={group.id}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="font-semibold">{group.name}</h3>
                {group.is_required && (
                  <span className="text-xs text-(--color-status-alert)">zorunlu</span>
                )}
                {group.selection_type === 'multi' && (
                  <span className="text-xs text-(--color-text-faint)">
                    birden fazla seçilebilir
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {available.map((option) => {
                  const isSelected = selectedIds.has(option.id);
                  const delta = formatPriceDelta(option.price_delta_kurus, formatTRY);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggle(group, option.id)}
                      className={[
                        'flex min-h-12 items-center justify-between rounded-(--radius-control) border-2 px-3 text-left transition-colors',
                        isSelected
                          ? 'border-(--color-accent) bg-(--color-accent-soft)'
                          : 'border-(--color-border) hover:border-(--color-border-strong)',
                      ].join(' ')}
                    >
                      <span>{option.name}</span>
                      {delta && (
                        <span className="tabular text-sm text-(--color-text-muted)">{delta}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Not */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
            Not (isteğe bağlı)
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Örn. soğansız"
            className="w-full min-h-12 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface-raised) px-3 text-base"
          />
        </div>

        {/* Adet */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-(--color-text-muted)">Adet</span>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="w-14"
            >
              −
            </Button>
            <span className="tabular w-10 text-center text-xl font-semibold">{quantity}</span>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setQuantity((q) => q + 1)}
              className="w-14"
            >
              +
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
