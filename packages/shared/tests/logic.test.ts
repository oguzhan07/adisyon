/**
 * Saf mantik testleri (Node yerlesik test kosucusu).
 *
 *   npm test
 *
 * Buradaki fonksiyonlar veritabani gerektirmez ama sistemin en riskli
 * hesaplarini tasir: kurus aritmetigi, birim donusumu ve is gunu siniri.
 * Bu ucunde sessiz bir hata, kasanin tutmamasina veya stok raporunun
 * anlamsizlasmasina yol acar - bu yuzden testleri var.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTRY,
  parseTRYToKurus,
  percentDiscount,
  splitEvenly,
  vatFromGross,
} from '../src/money.ts';
import { formatQuantity, toBaseQuantity } from '../src/units.ts';
import { businessDayOf, businessDayRange } from '../src/businessDay.ts';
import { lineTotal, validateSelection } from '../src/menu.ts';

/* ------------------------------------------------------------- para/kurus */

test('hesap bolmede kurus buharlasmaz', () => {
  // 100,00 TL 3'e bolunur. Naif bolme 3 x 3333 = 9999 verir ve kasa tutmaz.
  assert.deepEqual(splitEvenly(10000, 3), [3334, 3333, 3333]);
  assert.equal(splitEvenly(10000, 3).reduce((a, b) => a + b, 0), 10000);

  assert.deepEqual(splitEvenly(14000, 4), [3500, 3500, 3500, 3500]);
  assert.deepEqual(splitEvenly(1, 3), [1, 0, 0]);
  assert.deepEqual(splitEvenly(0, 2), [0, 0]);

  // Rastgele degerlerde de toplam korunmali
  for (const total of [1, 7, 999, 12345, 99999]) {
    for (const parts of [2, 3, 4, 5, 7]) {
      const sum = splitEvenly(total, parts).reduce((a, b) => a + b, 0);
      assert.equal(sum, total, `${total} / ${parts} toplami bozuldu`);
    }
  }
});

test('splitEvenly gecersiz parca sayisini reddeder', () => {
  assert.throws(() => splitEvenly(1000, 0));
  assert.throws(() => splitEvenly(1000, -1));
});

test('KDV dahil fiyattan KDV ayrilir', () => {
  assert.equal(vatFromGross(11000, 10), 1000); // 110 TL icinde 10 TL
  assert.equal(vatFromGross(14000, 10), 1273);
  assert.equal(vatFromGross(14000, 0), 0);
});

test('tutar girisi Turkce ve Ingilizce bicimi kabul eder', () => {
  assert.equal(parseTRYToKurus('125,50'), 12550);
  assert.equal(parseTRYToKurus('125.50'), 12550);
  assert.equal(parseTRYToKurus('1.250,75'), 125075); // TR binlik ayirici
  assert.equal(parseTRYToKurus('1,250.75'), 125075); // EN binlik ayirici
  assert.equal(parseTRYToKurus('₺ 80'), 8000);
  assert.equal(parseTRYToKurus('abc'), null);
  assert.equal(parseTRYToKurus('   '), null);
});

test('bicimlendirme ve yuzde indirim', () => {
  assert.equal(formatTRY(12550), '₺125,50');
  assert.equal(percentDiscount(14000, 10), 1400);
  assert.equal(percentDiscount(14000, 150), 14000); // %100'e kirpilir
});

/* ------------------------------------------------------------------ birim */

test('alim birimleri temel birime cevrilir', () => {
  assert.equal(toBaseQuantity(2, 'kg', 'g'), 2000);
  assert.equal(toBaseQuantity(500, 'g', 'g'), 500);
  assert.equal(toBaseQuantity(1.5, 'lt', 'ml'), 1500);
  assert.equal(toBaseQuantity(0.25, 'adet', 'adet'), 0.25);
});

test('karisik birim girisleri dogru toplanir', () => {
  // Ayni malzemeye 2 kg + 500 g giris: toplam 2500 g olmali
  assert.equal(toBaseQuantity(2, 'kg', 'g') + toBaseQuantity(500, 'g', 'g'), 2500);
});

test('uyumsuz birim sessizce kaydedilmez', () => {
  // kg ile ml karistirmak stogu 1000 kat sasirtir; hata firlatmasi sart
  assert.throws(() => toBaseQuantity(1, 'kg', 'ml'), /Birim uyumsuz/);
});

test('miktar gosterimi ust birime yukseltir', () => {
  assert.equal(formatQuantity(8500, 'g'), '8,5 kg');
  assert.equal(formatQuantity(150, 'g'), '150 g');
  assert.equal(formatQuantity(1500, 'ml'), '1,5 lt');
  assert.equal(formatQuantity(3, 'adet'), '3 adet');
});

/* --------------------------------------------------------------- is gunu */

test('gece kapanisi onceki is gunune yazilir', () => {
  // Istanbul UTC+3: 29 Tem 22:30 UTC = 30 Tem 01:30 yerel
  const gece = new Date('2026-07-29T22:30:00Z');

  assert.equal(businessDayOf(gece, 4), '2026-07-29'); // 04:00 basliyor -> onceki gun
  assert.equal(businessDayOf(gece, 0), '2026-07-30'); // 00:00 basliyor -> ayni gun
});

test('aksam satisi ayni is gunune yazilir', () => {
  const aksam = new Date('2026-07-30T18:00:00Z'); // 30 Tem 21:00 yerel
  assert.equal(businessDayOf(aksam, 4), '2026-07-30');
});

test('is gunu siniri ay/yil sinirini dogru asar', () => {
  const ayBasi = new Date('2026-07-31T23:00:00Z'); // 1 Agu 02:00 yerel
  assert.equal(businessDayOf(ayBasi, 4), '2026-07-31');

  const yilBasi = new Date('2026-12-31T23:00:00Z'); // 1 Ocak 02:00 yerel
  assert.equal(businessDayOf(yilBasi, 4), '2026-12-31');
});

test('is gunu araligi 24 saat ve dogru saatte baslar', () => {
  const range = businessDayRange('2026-07-30', 4);

  // 30 Tem 04:00 Istanbul = 30 Tem 01:00 UTC
  assert.equal(range.fromIso, '2026-07-30T01:00:00.000Z');
  assert.equal(
    new Date(range.toIso).getTime() - new Date(range.fromIso).getTime(),
    24 * 60 * 60 * 1000,
  );
});

/* ------------------------------------------------------------ menu/fiyat */

test('satir toplami varyant farklarini icerir', () => {
  const total = lineTotal(
    14000,
    [
      { option_id: 'a', name: 'Acılı', price_delta_kurus: 0 },
      { option_id: 'b', name: 'Ekstra Kokoreç', price_delta_kurus: 6000 },
    ],
    2,
  );
  assert.equal(total, 40000); // (14000 + 6000) x 2
});

const aciliGrup = {
  id: 'g1',
  name: 'Acılık',
  selection_type: 'single' as const,
  is_required: true,
  min_select: 1,
  max_select: 1,
  options: [
    { id: 'o1', name: 'Acısız', price_delta_kurus: 0, is_available: true },
    { id: 'o2', name: 'Acılı', price_delta_kurus: 0, is_available: true },
  ],
};

test('zorunlu opsiyon secilmeden urun eklenemez', () => {
  assert.equal(validateSelection([aciliGrup], []).length, 1);
  assert.equal(validateSelection([aciliGrup], ['o2']).length, 0);
});

test('ust sinir ihlali icin tek hata mesaji uretilir', () => {
  // Tek secimli grupta max_select de 1: iki kontrol ayri calisirsa kullanici
  // ayni sorun icin iki uyari gorurdu
  const errors = validateSelection([aciliGrup], ['o1', 'o2']);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /yalnizca bir secim/);
});

test('coktan secmeli grupta ust sinir uygulanir', () => {
  const ekstralar = {
    id: 'g2',
    name: 'Ekstralar',
    selection_type: 'multi' as const,
    is_required: false,
    min_select: 0,
    max_select: 2,
    options: [
      { id: 'e1', name: 'Bol Kimyon', price_delta_kurus: 0, is_available: true },
      { id: 'e2', name: 'Kaşar', price_delta_kurus: 3000, is_available: true },
      { id: 'e3', name: 'Ekstra Kokoreç', price_delta_kurus: 6000, is_available: true },
    ],
  };

  assert.equal(validateSelection([ekstralar], ['e1', 'e2']).length, 0);
  assert.equal(validateSelection([ekstralar], ['e1', 'e2', 'e3']).length, 1);
});
