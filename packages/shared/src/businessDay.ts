/**
 * Is gunu (business day) hesabi.
 *
 * NEDEN VAR: Kokoreççi gece 02:00'de kapaniyorsa, 01:30'da kesilen adisyon
 * takvimsel olarak yeni gune ait olsa da ISLETME acisindan onceki gunun
 * satisidir. Ham takvim gunune gore rapor almak gun sonu ciroyu sessizce
 * yanlis boler - patron "dun 8 bin yazmisti, bugun 300 TL" der.
 *
 * Cozum: is gunu, ayarlardaki baslangic saatinden (or. 04:00) itibaren sayilir.
 * Tum tarih gruplamalari Europe/Istanbul saatine gore yapilir; sunucu UTC'de
 * calistigi icin ham Date metotlarina guvenilemez.
 */

export const SHOP_TIMEZONE = 'Europe/Istanbul';

const istanbulParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function toIstanbulParts(date: Date): LocalParts {
  const parts = istanbulParts.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value ?? '0';
    return Number(value);
  };
  // 'en-CA' + hour12:false gece yarisini bazi ortamlarda 24 olarak verir
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
  };
}

function isoDate(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Verilen anin hangi is gunune ait oldugunu 'YYYY-MM-DD' olarak dondurur.
 *
 * @param startHour Is gunu baslangic saati (0-23). 4 ise 03:59 onceki gune sayilir.
 */
export function businessDayOf(date: Date, startHour: number): string {
  const p = toIstanbulParts(date);

  if (p.hour < startHour) {
    // Istanbul takviminde bir gun geri git (ay/yil sinirini dogru asmak icin
    // UTC tabanli bir yardimci tarih uzerinden yuruyoruz)
    const helper = new Date(Date.UTC(p.year, p.month - 1, p.day));
    helper.setUTCDate(helper.getUTCDate() - 1);
    return isoDate(helper.getUTCFullYear(), helper.getUTCMonth() + 1, helper.getUTCDate());
  }

  return isoDate(p.year, p.month, p.day);
}

/** Su anin is gunu */
export function currentBusinessDay(startHour: number): string {
  return businessDayOf(new Date(), startHour);
}

/**
 * Bir is gununun gercek zaman araligini dondurur.
 * Ornek: 2026-07-30, startHour=4 -> 30 Tem 04:00 ile 31 Tem 04:00 arasi.
 *
 * Rapor sorgularina bu araligi gonderiyoruz; SQL tarafinda tekrar saat
 * dilimi hesabi yapmak zorunda kalmiyoruz.
 */
export function businessDayRange(
  businessDay: string,
  startHour: number,
): { fromIso: string; toIso: string } {
  const [y, m, d] = businessDay.split('-').map(Number);

  const from = zonedTimeToUtc(y, m, d, startHour);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/**
 * Istanbul saatindeki bir yerel zamani UTC Date'e cevirir.
 * Yaz saati gecisleri icin iki adimli duzeltme yapar (Turkiye 2016'dan beri
 * kalici UTC+3 ama fonksiyon yine de genel dogru kalsin).
 */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour));
  const asLocal = toIstanbulParts(guess);
  const guessedUtcMs = Date.UTC(
    asLocal.year,
    asLocal.month - 1,
    asLocal.day,
    asLocal.hour,
    asLocal.minute,
  );
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, 0);
  return new Date(guess.getTime() + (targetUtcMs - guessedUtcMs));
}

/** Son N is gununun listesi (en yeni ilk) - rapor ekranindaki hizli secim icin */
export function recentBusinessDays(startHour: number, count: number): string[] {
  const today = currentBusinessDay(startHour);
  const [y, m, d] = today.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));

  return Array.from({ length: count }, () => {
    const value = isoDate(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      cursor.getUTCDate(),
    );
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    return value;
  });
}

const trDate = new Intl.DateTimeFormat('tr-TR', {
  timeZone: SHOP_TIMEZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const trTime = new Intl.DateTimeFormat('tr-TR', {
  timeZone: SHOP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** '2026-07-30' -> '30 Temmuz 2026' */
export function formatBusinessDay(businessDay: string): string {
  const [y, m, d] = businessDay.split('-').map(Number);
  return trDate.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Adisyon saatini gostermek icin: '21:45' */
export function formatClock(date: Date | string): string {
  return trTime.format(typeof date === 'string' ? new Date(date) : date);
}

/** Masa planinda "kac dakikadir acik" gostergesi */
export function formatElapsed(since: Date | string): string {
  const start = typeof since === 'string' ? new Date(since) : since;
  const minutes = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));

  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  return `${hours} sa ${minutes % 60} dk`;
}
