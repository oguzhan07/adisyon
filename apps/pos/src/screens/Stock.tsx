import { useState } from 'react';
import {
  formatKurus,
  formatQuantity,
  formatRecipeQuantity,
  parseTRYToKurus,
  purchaseUnitsFor,
  UNIT_LABELS,
  type BaseUnit,
  type PurchaseLineInput,
  type PurchaseUnit,
} from '@adisyon/shared';
import {
  useActiveCount,
  useIngredients,
  useIngredientStock,
  useOptionRecipe,
  useStockMutations,
} from '../lib/stockData';
import { useOptionGroups } from '../lib/menuData';
import { describeError } from '../lib/supabase';
import { Button } from '../ui/Button';
import { Field, NumberInput, Select, TextInput } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { useFeedback } from '../ui/feedback';
import { RecipeEditor, type RecipeLine } from './menu/RecipeEditor';
import type { Ingredient } from '../lib/dbTypes';

type Tab = 'stock' | 'purchase' | 'waste' | 'count' | 'recipes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'stock', label: 'Stok Durumu' },
  { id: 'purchase', label: 'Mal Kabul' },
  { id: 'waste', label: 'Zayi' },
  { id: 'count', label: 'Sayım' },
  { id: 'recipes', label: 'Ekstra Reçeteleri' },
];

export function Stock() {
  const [tab, setTab] = useState<Tab>('stock');

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">Stok</h1>

      <div className="mb-6 flex gap-2 border-b border-(--color-border)">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'min-h-12 px-4 font-medium',
              tab === t.id
                ? 'border-b-2 border-(--color-accent) text-(--color-accent)'
                : 'text-(--color-text-muted)',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && <StockLevels />}
      {tab === 'purchase' && <PurchaseForm />}
      {tab === 'waste' && <WasteForm />}
      {tab === 'count' && <CountTab />}
      {tab === 'recipes' && <OptionRecipesTab />}
    </div>
  );
}

/* ------------------------------------------------------------- stok durumu */

function StockLevels() {
  const stock = useIngredientStock();
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [creating, setCreating] = useState(false);

  if (stock.isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;
  if (stock.error) return <p className="text-(--color-status-alert)">{describeError(stock.error)}</p>;

  const rows = stock.data ?? [];
  const belowMin = rows.filter((r) => r.is_below_min);

  return (
    <div>
      {belowMin.length > 0 && (
        <div className="mb-4 rounded-(--radius-control) bg-(--color-status-alert-soft) px-4 py-3 text-sm text-(--color-status-alert)">
          <strong>Kritik seviye:</strong>{' '}
          {belowMin.map((r) => r.name).join(', ')} bitmek üzere.
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <Button variant="secondary" onClick={() => setCreating(true)}>
          + Malzeme ekle
        </Button>
      </div>

      <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border)">
        <table className="w-full text-sm">
          <thead className="bg-(--color-surface-sunken) text-left text-(--color-text-muted)">
            <tr>
              <th className="px-4 py-2 font-medium">Malzeme</th>
              <th className="px-4 py-2 text-right font-medium">Mevcut stok</th>
              <th className="px-4 py-2 text-right font-medium">Ort. maliyet</th>
              <th className="px-4 py-2 text-right font-medium">Stok değeri</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ingredient_id} className="border-t border-(--color-border)">
                <td className="px-4 py-2.5">
                  {row.name}
                  {row.is_below_min && (
                    <span className="ml-2 rounded-full bg-(--color-status-alert-soft) px-2 py-0.5 text-xs text-(--color-status-alert)">
                      kritik
                    </span>
                  )}
                </td>
                <td className="tabular px-4 py-2.5 text-right">
                  {formatQuantity(row.stock_qty, row.base_unit)}
                </td>
                <td className="tabular px-4 py-2.5 text-right text-(--color-text-muted)">
                  {formatKurus(Math.round(row.avg_cost_kurus))} ₺/{row.base_unit}
                </td>
                <td className="tabular px-4 py-2.5 text-right">
                  {formatKurus(row.stock_value_kurus)} ₺
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        id: row.ingredient_id,
                        name: row.name,
                        base_unit: row.base_unit,
                        min_stock: row.min_stock,
                        avg_cost_kurus: row.avg_cost_kurus,
                        note: null,
                        is_active: true,
                      })
                    }
                    className="text-(--color-text-muted) hover:underline"
                  >
                    Düzenle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <IngredientModal
          ingredient={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function IngredientModal({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null;
  onClose: () => void;
}) {
  const feedback = useFeedback();
  const { saveIngredient } = useStockMutations();
  const [name, setName] = useState(ingredient?.name ?? '');
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(ingredient?.base_unit ?? 'g');
  const [minStock, setMinStock] = useState(ingredient?.min_stock?.toString() ?? '');

  async function save() {
    if (name.trim() === '') {
      feedback.toast('Malzeme adı zorunlu.', 'error');
      return;
    }
    try {
      await saveIngredient.mutateAsync({
        ...(ingredient?.id ? { id: ingredient.id } : {}),
        name: name.trim(),
        base_unit: baseUnit,
        min_stock: minStock ? Number(minStock.replace(',', '.')) : null,
      });
      feedback.toast('Malzeme kaydedildi.', 'ok');
      onClose();
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={ingredient ? 'Malzemeyi düzenle' : 'Yeni malzeme'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save}>Kaydet</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Malzeme adı">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field
          label="Temel birim"
          hint={ingredient ? 'Mevcut hareketler bu birimde; değiştirmeyin.' : 'Stokta bu birimde saklanır.'}
        >
          <Select
            value={baseUnit}
            onChange={(e) => setBaseUnit(e.target.value as BaseUnit)}
            disabled={!!ingredient}
          >
            <option value="g">gram (g)</option>
            <option value="ml">mililitre (ml)</option>
            <option value="adet">adet</option>
          </Select>
        </Field>
        <Field label={`Kritik seviye (${baseUnit})`} hint="Bu miktarın altına düşünce uyarılır. Boş bırakılabilir.">
          <NumberInput value={minStock} onChange={(e) => setMinStock(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- mal kabul */

interface DraftLine {
  ingredient_id: string;
  purchase_unit: PurchaseUnit;
  quantityText: string;
  costText: string;
}

function PurchaseForm() {
  const feedback = useFeedback();
  const ingredients = useIngredients();
  const { recordPurchase } = useStockMutations();

  const [supplier, setSupplier] = useState('');
  const [invoice, setInvoice] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);

  function addLine() {
    const first = ingredients.data?.[0];
    if (!first) return;
    setLines((l) => [
      ...l,
      {
        ingredient_id: first.id,
        purchase_unit: purchaseUnitsFor(first.base_unit)[0] ?? 'adet',
        quantityText: '',
        costText: '',
      },
    ]);
  }

  function update(index: number, patch: Partial<DraftLine>) {
    setLines((l) => l.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submit() {
    const byId = new Map((ingredients.data ?? []).map((i) => [i.id, i]));
    const payload: PurchaseLineInput[] = [];

    for (const line of lines) {
      const qty = Number(line.quantityText.replace(',', '.'));
      const cost = parseTRYToKurus(line.costText);
      const ing = byId.get(line.ingredient_id);
      if (!ing || !qty || qty <= 0 || cost === null || cost < 0) {
        feedback.toast('Tüm satırlarda geçerli miktar ve fiyat girin.', 'error');
        return;
      }
      payload.push({
        ingredient_id: line.ingredient_id,
        purchase_unit: line.purchase_unit,
        purchase_quantity: qty,
        unit_cost_kurus: cost,
      });
    }
    if (payload.length === 0) {
      feedback.toast('En az bir satır ekleyin.', 'error');
      return;
    }

    try {
      await recordPurchase.mutateAsync({
        supplierName: supplier.trim() || null,
        invoiceNo: invoice.trim() || null,
        lines: payload,
      });
      feedback.toast('Mal kabul kaydedildi, stok güncellendi.', 'ok');
      setLines([]);
      setSupplier('');
      setInvoice('');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  const byId = new Map((ingredients.data ?? []).map((i) => [i.id, i]));

  return (
    <div className="max-w-3xl">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Field label="Tedarikçi (isteğe bağlı)">
          <TextInput value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label="Fatura no (isteğe bağlı)">
          <TextInput value={invoice} onChange={(e) => setInvoice(e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => {
          const ing = byId.get(line.ingredient_id);
          const units = ing ? purchaseUnitsFor(ing.base_unit) : [];
          return (
            <div key={index} className="grid grid-cols-[1fr_90px_100px_120px_40px] items-center gap-2">
              <Select
                value={line.ingredient_id}
                onChange={(e) => {
                  const newIng = byId.get(e.target.value);
                  update(index, {
                    ingredient_id: e.target.value,
                    purchase_unit: newIng ? purchaseUnitsFor(newIng.base_unit)[0] : line.purchase_unit,
                  });
                }}
              >
                {(ingredients.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
              <NumberInput
                placeholder="Miktar"
                value={line.quantityText}
                onChange={(e) => update(index, { quantityText: e.target.value })}
              />
              <Select
                value={line.purchase_unit}
                onChange={(e) => update(index, { purchase_unit: e.target.value as PurchaseUnit })}
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </Select>
              <NumberInput
                placeholder="Birim ₺"
                value={line.costText}
                onChange={(e) => update(index, { costText: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setLines((l) => l.filter((_, i) => i !== index))}
                className="text-(--color-status-alert)"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={addLine}>
          + Satır ekle
        </Button>
        {lines.length > 0 && <Button onClick={submit}>Mal kabulü kaydet</Button>}
      </div>

      <p className="mt-4 text-xs text-(--color-text-faint)">
        Birim fiyat, seçilen birim başınadır (örn. "kg" seçtiyseniz kg fiyatı). Girilen miktar
        otomatik olarak malzemenin temel birimine çevrilir ve ağırlıklı ortalama maliyet güncellenir.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- zayi */

function WasteForm() {
  const feedback = useFeedback();
  const ingredients = useIngredients();
  const { recordWaste } = useStockMutations();
  const [ingredientId, setIngredientId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');

  const selectedIng = (ingredients.data ?? []).find((i) => i.id === ingredientId);

  async function submit() {
    const qty = Number(quantity.replace(',', '.'));
    if (!ingredientId || !qty || qty <= 0 || reason.trim() === '') {
      feedback.toast('Malzeme, miktar ve sebep zorunlu.', 'error');
      return;
    }
    try {
      await recordWaste.mutateAsync({ ingredientId, quantity: qty, reason: reason.trim() });
      feedback.toast('Zayi kaydedildi.', 'ok');
      setQuantity('');
      setReason('');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <Field label="Malzeme">
        <Select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">Seçin…</option>
          {(ingredients.data ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Miktar${selectedIng ? ` (${selectedIng.base_unit})` : ''}`}>
        <NumberInput value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </Field>
      <Field label="Sebep (zorunlu)">
        <TextInput
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Örn. yanık, bozulma, düşürme"
        />
      </Field>
      <Button onClick={submit}>Zayi kaydet</Button>
    </div>
  );
}

/* ------------------------------------------------------------------- sayim */

function CountTab() {
  const feedback = useFeedback();
  const active = useActiveCount();
  const { startCount, setCountValue, applyCount, cancelCount } = useStockMutations();

  if (active.isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;

  if (!active.data) {
    return (
      <div className="max-w-md">
        <p className="mb-4 text-(--color-text-muted)">
          Açık sayım yok. Yeni sayım başlatınca tüm malzemelerin o anki teorik miktarı dondurulur;
          fiili miktarları girip uyguladığınızda stok fiiliye eşitlenir.
        </p>
        <Button
          onClick={async () => {
            try {
              await startCount.mutateAsync(null);
              feedback.toast('Sayım başlatıldı.', 'ok');
            } catch (e) {
              feedback.toast(describeError(e), 'error');
            }
          }}
        >
          Yeni sayım başlat
        </Button>
      </div>
    );
  }

  const { count, items } = active.data;

  async function apply() {
    const result = await feedback.confirm({
      title: 'Sayımı uygula',
      message: 'Girilen fiili miktarlara göre stok düzeltilecek. Bu işlem geri alınamaz.',
      confirmLabel: 'Uygula',
    });
    if (!result.ok) return;
    try {
      await applyCount.mutateAsync(count.id);
      feedback.toast('Sayım uygulandı, stok güncellendi.', 'ok');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-(--color-text-muted)">
          Fiili miktarı girin. Fark otomatik hesaplanır.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => cancelCount.mutate(count.id)}>
            Sayımı iptal et
          </Button>
          <Button onClick={apply}>Sayımı uygula</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border)">
        <table className="w-full text-sm">
          <thead className="bg-(--color-surface-sunken) text-left text-(--color-text-muted)">
            <tr>
              <th className="px-4 py-2 font-medium">Malzeme</th>
              <th className="px-4 py-2 text-right font-medium">Teorik</th>
              <th className="px-4 py-2 text-right font-medium">Sayılan</th>
              <th className="px-4 py-2 text-right font-medium">Fark</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const variance =
                item.counted_quantity === null
                  ? null
                  : item.counted_quantity - item.theoretical_quantity;
              return (
                <tr key={item.id} className="border-t border-(--color-border)">
                  <td className="px-4 py-2">{item.ingredient_name}</td>
                  <td className="tabular px-4 py-2 text-right text-(--color-text-muted)">
                    {formatRecipeQuantity(item.theoretical_quantity, item.base_unit as BaseUnit)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      inputMode="decimal"
                      defaultValue={item.counted_quantity ?? ''}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const value = raw === '' ? null : Number(raw.replace(',', '.'));
                        setCountValue.mutate({ countItemId: item.id, countedQuantity: value });
                      }}
                      className="tabular w-28 min-h-10 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface-raised) px-2 text-right"
                    />
                  </td>
                  <td
                    className={[
                      'tabular px-4 py-2 text-right font-medium',
                      variance === null
                        ? 'text-(--color-text-faint)'
                        : variance < 0
                          ? 'text-(--color-status-alert)'
                          : variance > 0
                            ? 'text-(--color-status-ready)'
                            : 'text-(--color-text-muted)',
                    ].join(' ')}
                  >
                    {variance === null
                      ? '—'
                      : `${variance > 0 ? '+' : ''}${formatRecipeQuantity(variance, item.base_unit as BaseUnit)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- ekstra receteleri */

function OptionRecipesTab() {
  const optionGroups = useOptionGroups();
  const [optionId, setOptionId] = useState<string | null>(null);

  const allOptions = (optionGroups.data ?? []).flatMap((g) =>
    g.options.map((o) => ({ ...o, groupName: g.name })),
  );

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm text-(--color-text-muted)">
        Ekstra/varyantların stoktan düşmesi için reçetesi olmalı (örn. "Bol Kimyon" → +3 g kimyon).
        Ürünlerin reçetesi Menü Yönetimi'nden düzenlenir.
      </p>

      <div className="mb-4 max-w-md">
        <Field label="Ekstra / varyant seç">
          <Select value={optionId ?? ''} onChange={(e) => setOptionId(e.target.value || null)}>
            <option value="">Seçin…</option>
            {allOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.groupName} · {o.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {optionId && <OptionRecipeEditor optionId={optionId} />}
    </div>
  );
}

function OptionRecipeEditor({ optionId }: { optionId: string }) {
  const feedback = useFeedback();
  const ingredients = useIngredients();
  const existing = useOptionRecipe(optionId);
  const { saveOptionRecipe } = useStockMutations();
  const [lines, setLines] = useState<RecipeLine[] | null>(null);

  const effective: RecipeLine[] =
    lines ?? (existing.data ?? []).map((r) => ({ ingredient_id: r.ingredient_id, quantity: r.quantity }));

  async function save() {
    try {
      await saveOptionRecipe.mutateAsync({
        optionId,
        lines: effective.filter((l) => l.quantity > 0),
      });
      feedback.toast('Reçete kaydedildi.', 'ok');
      setLines(null);
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  if (existing.isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;

  return (
    <div className="rounded-(--radius-card) border border-(--color-border) p-4">
      <RecipeEditor
        ingredients={ingredients.data ?? []}
        lines={effective}
        onChange={setLines}
      />
      <Button className="mt-4" onClick={save}>
        Reçeteyi kaydet
      </Button>
    </div>
  );
}
