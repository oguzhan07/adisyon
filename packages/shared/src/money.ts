/**
 * Para birimi islemleri.
 *
 * TEMEL KURAL: Tutarlar her yerde tam sayi KURUS olarak tasinir.
 * Hicbir yerde ondalikli TL degeri ile aritmetik yapilmaz - JS'in kayan
 * nokta hatasi (0.1 + 0.2 !== 0.3) kasa toplamlarinda kurus kaymasina
 * yol acar. TL'ye cevirme yalnizca ekrana/fise yazarken yapilir.
 */

const trNumber = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 12550 -> "125,50" */
export function formatKurus(kurus: number): string {
  return trNumber.format(kurus / 100);
}

/** 12550 -> "₺125,50" */
export function formatTRY(kurus: number): string {
  return `₺${formatKurus(kurus)}`;
}

/** Fise yazmak icin: "125,50 TL" (termal yazicida ₺ simgesi cikmayabilir) */
export function formatKurusForReceipt(kurus: number): string {
  return `${formatKurus(kurus)} TL`;
}

/**
 * Kullanici girisini kurusa cevirir. Turkce ondalik ayirici (virgul) ve
 * nokta ayiricinin ikisini de kabul eder: "125,50" / "125.50" / "1.250,75"
 * Gecersiz giriste null doner - cagiran taraf hatayi gostermelidir.
 */
export function parseTRYToKurus(input: string): number | null {
  const cleaned = input.replace(/[₺\s]/g, '').trim();
  if (cleaned === '') return null;

  let normalized: string;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Iki ayirici birlikte: sonda olan ondalik ayiricidir (1.250,75 veya 1,250.75)
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    normalized = cleaned.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(',', '.');
  } else {
    normalized = cleaned;
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const tl = Number(normalized);
  if (!Number.isFinite(tl)) return null;

  return Math.round(tl * 100);
}

/**
 * KDV DAHIL fiyatin icindeki KDV tutarini hesaplar.
 * Turkiye'de perakende fiyatlari KDV dahil gosterilir; bu yuzden
 * ayirma (tevkif) yonunde hesap yapiyoruz: kdv = brut - brut/(1+oran)
 *
 * @param grossKurus KDV dahil tutar (kurus)
 * @param ratePercent KDV orani, yuzde olarak (or. 10)
 */
export function vatFromGross(grossKurus: number, ratePercent: number): number {
  if (ratePercent <= 0) return 0;
  const net = Math.round((grossKurus * 100) / (100 + ratePercent));
  return grossKurus - net;
}

/** KDV dahil tutarin KDV haric (net) kismi */
export function netFromGross(grossKurus: number, ratePercent: number): number {
  return grossKurus - vatFromGross(grossKurus, ratePercent);
}

/**
 * Bir tutari n kisiye boler ve KURUSU KAYBETMEZ.
 *
 * Neden onemli: 10000 kurus / 3 = 3333,33... Naif bolme 3 x 3333 = 9999
 * verir ve 1 kurus buharlasir; kasa kapanmaz. Bu fonksiyon artan kurusu
 * ilk paylara dagitir: [3334, 3333, 3333] -> toplam tam 10000.
 */
export function splitEvenly(totalKurus: number, parts: number): number[] {
  if (parts <= 0) throw new Error('splitEvenly: parca sayisi 1 veya daha buyuk olmali');

  const base = Math.floor(totalKurus / parts);
  const remainder = totalKurus - base * parts;

  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Yuzde indirim tutarini hesaplar (yukari degil, en yakina yuvarlar).
 * @param percent 0-100
 */
export function percentDiscount(amountKurus: number, percent: number): number {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return Math.round((amountKurus * clamped) / 100);
}
