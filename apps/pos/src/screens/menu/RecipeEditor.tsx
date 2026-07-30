import { formatKurus, formatRecipeQuantity, type BaseUnit } from '@adisyon/shared';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Field';
import type { Ingredient } from '../../lib/dbTypes';

export interface RecipeLine {
  ingredient_id: string;
  quantity: number;
}

interface Props {
  ingredients: Ingredient[];
  lines: RecipeLine[];
  onChange: (lines: RecipeLine[]) => void;
}

/**
 * Recete satiri editoru (urun ve varyant receteleri icin ortak).
 * Miktar TEMEL BIRIMDE girilir; yaninda o malzemenin birimi gosterilir.
 * Altta canli maliyet tahmini (recete x ortalama maliyet) gorunur.
 */
export function RecipeEditor({ ingredients, lines, onChange }: Props) {
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  function addLine() {
    const firstUnused = ingredients.find((i) => !lines.some((l) => l.ingredient_id === i.id));
    if (!firstUnused) return;
    onChange([...lines, { ingredient_id: firstUnused.id, quantity: 0 }]);
  }

  function update(index: number, patch: Partial<RecipeLine>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function remove(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  const totalCostKurus = lines.reduce((sum, line) => {
    const ing = byId.get(line.ingredient_id);
    return sum + (ing ? line.quantity * ing.avg_cost_kurus : 0);
  }, 0);

  return (
    <div>
      {lines.length === 0 && (
        <p className="mb-2 text-sm text-(--color-text-faint)">
          Henüz malzeme eklenmedi. Reçete olmadan bu ürün stoktan düşülmez.
        </p>
      )}

      <div className="space-y-2">
        {lines.map((line, index) => {
          const ing = byId.get(line.ingredient_id);
          return (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={line.ingredient_id}
                onChange={(e) => update(index, { ingredient_id: e.target.value })}
                className="flex-1"
              >
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
              <input
                inputMode="decimal"
                value={line.quantity || ''}
                onChange={(e) => update(index, { quantity: Number(e.target.value.replace(',', '.')) || 0 })}
                className="tabular w-24 min-h-12 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface-raised) px-3 text-right"
              />
              <span className="w-10 text-sm text-(--color-text-faint)">
                {ing?.base_unit ?? ''}
              </span>
              <button
                type="button"
                onClick={() => remove(index)}
                className="text-(--color-status-alert)"
                aria-label="Kaldır"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button variant="secondary" onClick={addLine}>
          + Malzeme ekle
        </Button>
        {lines.length > 0 && (
          <span className="text-sm text-(--color-text-muted)">
            Tahmini maliyet:{' '}
            <span className="tabular font-semibold text-(--color-text)">
              {formatKurus(Math.round(totalCostKurus))} ₺
            </span>
          </span>
        )}
      </div>

      {/* Ozet: hangi malzemeden ne kadar */}
      {lines.length > 0 && (
        <ul className="mt-3 text-xs text-(--color-text-faint)">
          {lines.map((line, index) => {
            const ing = byId.get(line.ingredient_id);
            if (!ing) return null;
            return (
              <li key={index}>
                {ing.name}: {formatRecipeQuantity(line.quantity, ing.base_unit as BaseUnit)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
