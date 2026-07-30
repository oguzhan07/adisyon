/**
 * Menu fiyat hesaplari.
 *
 * Bu dosya fiyat hesabinin TEK DOGRULUK KAYNAGIDIR. QR menu sitesi ile kasa
 * programi ayni fonksiyonlari cagirir; boylece musterinin telefonda gordugu
 * tutar ile adisyona islenen tutar hicbir kosulda ayrisamaz.
 */

export type SelectionType = 'single' | 'multi';

export interface OptionLike {
  id: string;
  name: string;
  price_delta_kurus: number;
  is_available: boolean;
}

export interface OptionGroupLike {
  id: string;
  name: string;
  selection_type: SelectionType;
  is_required: boolean;
  min_select: number;
  max_select: number | null;
  options: OptionLike[];
}

/** Bir adisyon satirinin secili opsiyonlari (fiyat farki dahil) */
export interface SelectedOption {
  option_id: string;
  name: string;
  price_delta_kurus: number;
}

/** Bir porsiyonun opsiyonlarla birlikte birim fiyati */
export function unitPriceWithOptions(
  basePriceKurus: number,
  selected: readonly SelectedOption[],
): number {
  return selected.reduce((sum, o) => sum + o.price_delta_kurus, basePriceKurus);
}

/** Satir toplami = (taban fiyat + opsiyon farklari) x adet */
export function lineTotal(
  basePriceKurus: number,
  selected: readonly SelectedOption[],
  quantity: number,
): number {
  return unitPriceWithOptions(basePriceKurus, selected) * quantity;
}

/**
 * Adisyon ara toplami.
 * Iptal edilmis satirlar cagiran tarafta filtrelenmis olmalidir.
 */
export function subtotal(
  lines: readonly { unit_price_kurus: number; quantity: number }[],
): number {
  return lines.reduce((sum, l) => sum + l.unit_price_kurus * l.quantity, 0);
}

export interface ValidationError {
  groupId: string;
  groupName: string;
  message: string;
}

/**
 * Opsiyon secimini dogrular. Zorunlu grup bos birakilmis mi, coktan secmeli
 * grupta ust sinir asilmis mi diye bakar.
 *
 * Kasada "acilik secilmeden urun eklenmesi" gibi eksik siparislerin ocaga
 * dusmesini engeller.
 */
export function validateSelection(
  groups: readonly OptionGroupLike[],
  selectedOptionIds: readonly string[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const selected = new Set(selectedOptionIds);

  for (const group of groups) {
    const count = group.options.filter((o) => selected.has(o.id)).length;

    if (group.is_required && count < Math.max(group.min_select, 1)) {
      errors.push({
        groupId: group.id,
        groupName: group.name,
        message: `"${group.name}" secimi zorunlu.`,
      });
      continue;
    }

    if (count > 0 && count < group.min_select) {
      errors.push({
        groupId: group.id,
        groupName: group.name,
        message: `"${group.name}" icin en az ${group.min_select} secim yapilmali.`,
      });
      continue;
    }

    // Ust sinir ihlali TEK hata uretir. Tek secimli grupta max_select de 1
    // oldugu icin, iki kontrolu ayri ayri calistirmak ayni sorun icin iki
    // mesaj gosterirdi.
    if (group.selection_type === 'single' && count > 1) {
      errors.push({
        groupId: group.id,
        groupName: group.name,
        message: `"${group.name}" icin yalnizca bir secim yapilabilir.`,
      });
    } else if (group.max_select !== null && count > group.max_select) {
      errors.push({
        groupId: group.id,
        groupName: group.name,
        message: `"${group.name}" icin en fazla ${group.max_select} secim yapilabilir.`,
      });
    }
  }

  return errors;
}

/** Bir urunun opsiyon secimi gerektirip gerektirmedigi.
 *  Gerektirmiyorsa kasada modal acmadan tek dokunusla eklenir. */
export function needsOptionModal(groups: readonly OptionGroupLike[]): boolean {
  return groups.some((g) => g.options.some((o) => o.is_available));
}

/** QR menude "+₺15" seklinde fiyat farki etiketi; fark yoksa bos doner */
export function formatPriceDelta(
  deltaKurus: number,
  format: (kurus: number) => string,
): string {
  if (deltaKurus === 0) return '';
  const sign = deltaKurus > 0 ? '+' : '−';
  return `${sign}${format(Math.abs(deltaKurus))}`;
}
