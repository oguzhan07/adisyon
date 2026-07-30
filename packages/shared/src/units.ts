/**
 * Malzeme birimi donusumleri.
 *
 * TEMEL KURAL: Stokta tutulan her miktar malzemenin TEMEL BIRIMINDEDIR
 * (gram / mililitre / adet). Alim kg veya lt olarak girilse bile temel
 * birime cevrilerek yazilir.
 *
 * Neden: "1,5 kg aldim, 150 g kullandim" hesabi ancak ikisi ayni birimde
 * oldugunda dogru cikar. Karisik birim saklamak stogu 1000 kat sasirtir ve
 * hata sessizdir - rapor yanlis cikar ama hicbir yerde patlamaz.
 */

/** Stokta saklanan birimler */
export const BASE_UNITS = ['g', 'ml', 'adet'] as const;
export type BaseUnit = (typeof BASE_UNITS)[number];

/** Mal kabulde girilebilen birimler */
export const PURCHASE_UNITS = ['kg', 'g', 'lt', 'ml', 'adet'] as const;
export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];

/** Her alim birimi hangi temel birime, hangi carpanla cevrilir */
const CONVERSION: Record<PurchaseUnit, { base: BaseUnit; factor: number }> = {
  kg: { base: 'g', factor: 1000 },
  g: { base: 'g', factor: 1 },
  lt: { base: 'ml', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  adet: { base: 'adet', factor: 1 },
};

export const UNIT_LABELS: Record<PurchaseUnit, string> = {
  kg: 'kg',
  g: 'g',
  lt: 'lt',
  ml: 'ml',
  adet: 'adet',
};

/** Bir alim birimi verilen temel birimle uyumlu mu? (kg -> g evet, kg -> ml hayir) */
export function isCompatible(purchaseUnit: PurchaseUnit, baseUnit: BaseUnit): boolean {
  return CONVERSION[purchaseUnit].base === baseUnit;
}

/** Bir temel birim icin girilebilecek alim birimleri */
export function purchaseUnitsFor(baseUnit: BaseUnit): PurchaseUnit[] {
  return PURCHASE_UNITS.filter((u) => CONVERSION[u].base === baseUnit);
}

/**
 * Alim miktarini temel birime cevirir.
 * Uyumsuz birim kombinasyonunda hata atar - sessizce yanlis kaydetmekten iyidir.
 */
export function toBaseQuantity(
  quantity: number,
  purchaseUnit: PurchaseUnit,
  baseUnit: BaseUnit,
): number {
  const conv = CONVERSION[purchaseUnit];
  if (conv.base !== baseUnit) {
    throw new Error(
      `Birim uyumsuz: "${purchaseUnit}" birimi "${baseUnit}" ile kullanilamaz ` +
        `(beklenen temel birim: "${conv.base}")`,
    );
  }
  // 3 ondalik hassasiyet: 0,5 g gibi degerler korunur, kayan nokta artigi silinir
  return Math.round(quantity * conv.factor * 1000) / 1000;
}

/** Temel birimden alim birimine geri cevirir (raporda "8,5 kg" gostermek icin) */
export function fromBaseQuantity(baseQuantity: number, purchaseUnit: PurchaseUnit): number {
  return Math.round((baseQuantity / CONVERSION[purchaseUnit].factor) * 1000) / 1000;
}

const qtyFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

/**
 * Miktari insan okuyacak sekilde yazar; buyuk degerleri ust birime yukseltir.
 * 8500 g -> "8,5 kg" | 150 g -> "150 g" | 3 adet -> "3 adet"
 */
export function formatQuantity(baseQuantity: number, baseUnit: BaseUnit): string {
  const abs = Math.abs(baseQuantity);

  if (baseUnit === 'g' && abs >= 1000) {
    return `${qtyFormatter.format(baseQuantity / 1000)} kg`;
  }
  if (baseUnit === 'ml' && abs >= 1000) {
    return `${qtyFormatter.format(baseQuantity / 1000)} lt`;
  }
  return `${qtyFormatter.format(baseQuantity)} ${baseUnit}`;
}

/** Recete satirinda gosterim: her zaman temel birimde, yukseltme yapmadan */
export function formatRecipeQuantity(baseQuantity: number, baseUnit: BaseUnit): string {
  return `${qtyFormatter.format(baseQuantity)} ${baseUnit}`;
}
