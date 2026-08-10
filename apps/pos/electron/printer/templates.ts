/**
 * Fis sablonlari (80mm / 48 karakter).
 *
 * FONT DUZENI (musteriyle onaylandi):
 *  - Baslik (dukkan adi) ve TOPLAM: iri (cift genislik+yukseklik)
 *  - Govde (urun satirlari): cift yukseklik -> okunur, 48 kolon korunur
 *  - Ayrinti/dipnot: normal
 *
 * TURKCE: Yazici modeli standart PC857'yi (ESC t 13) desteklemiyor; Turkce
 * karakterler bozuk cikiyor. Kod sayfasi cozulene kadar tum metni ASCII'ye
 * sadelestiriyoruz (Yarim Ekmek Kokorec gibi) - fis temiz ve okunur olsun.
 * asciify() tek kapi; kod sayfasi cozulunce burayi kaldirmak yeterli.
 */

import type { ThermalPrinter } from 'node-thermal-printer';
import {
  formatClock,
  formatBusinessDay,
  formatDateTime,
  formatKurusForReceipt,
  PAYMENT_METHOD_LABELS,
  type BillData,
  type KitchenTicketData,
  type QrLabelData,
  type ZReportData,
} from '@adisyon/shared';
import type { ReceiptBuilder } from './adapter';

/* ------------------------------------------------------------------ yardimci */

const TR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I',
  ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
  â: 'a', î: 'i', û: 'u', ā: 'a',
};

/** Turkce harfleri ASCII karsiligina cevirir, kalan ASCII-disi karakteri atar */
function asciify(text: string): string {
  return text
    .replace(/[çÇğĞıİöÖşŞüÜâîûā]/g, (c) => TR_MAP[c] ?? c)
    .replace(/[^\x20-\x7E]/g, '');
}

/** Urun adini fis genisligine sarar; ilk satir dolu, devami girintili */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current === '') {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/* -------------------------------------------------------------- OCAK FISI */

export function kitchenTicket(data: KitchenTicketData): ReceiptBuilder {
  return (p: ThermalPrinter) => {
    p.alignCenter();
    p.setTextQuadArea();
    p.bold(true);
    p.println(asciify(data.isPartial ? 'YENI SIPARIS' : 'OCAK FISI'));
    p.bold(false);
    p.setTextNormal();

    // Masa en buyuk puntoda: ocakta uzaktan okunmali
    p.setTextQuadArea();
    p.println(asciify(data.tableLabel));
    p.setTextNormal();

    p.println(`Siparis No: ${data.orderNo}   Saat: ${formatClock(data.printedAt)}`);
    if (data.guestCount) p.println(`Kisi: ${data.guestCount}`);

    p.alignLeft();
    p.drawLine();

    for (const item of data.items) {
      p.bold(true);
      p.setTextQuadArea();
      p.println(asciify(`${item.quantity} x ${item.name}`));
      p.setTextNormal();
      p.bold(false);

      for (const option of item.options) {
        p.setTextDoubleHeight();
        p.println(asciify(`   + ${option}`));
        p.setTextNormal();
      }
      if (item.note) {
        p.bold(true);
        p.setTextDoubleHeight();
        for (const line of wrap(asciify(`>> ${item.note}`), 46)) {
          p.println(`   ${line}`);
        }
        p.setTextNormal();
        p.bold(false);
      }
      p.newLine();
    }

    p.drawLine();
  };
}

/* ------------------------------------------------------------- HESAP FISI */

export function billReceipt(data: BillData): ReceiptBuilder {
  return (p: ThermalPrinter) => {
    // Baslik: iri
    p.alignCenter();
    p.bold(true);
    p.setTextQuadArea();
    p.println(asciify(data.shop.header || data.shop.shopName));
    p.setTextNormal();
    p.bold(false);

    if (data.shop.address) p.println(asciify(data.shop.address));
    if (data.shop.phone) p.println(asciify(data.shop.phone));

    p.alignLeft();
    p.drawLine();
    p.leftRight(asciify(data.tableLabel), `Fis No: ${data.orderNo}`);
    p.leftRight(`Acilis: ${formatClock(data.openedAt)}`, `Kapanis: ${formatClock(data.closedAt)}`);
    // Fisin basildigi tarih+saat kagitta gorunsun
    p.println(`Yazdirma: ${formatDateTime(data.printedAt)}`);
    p.drawLine();

    // Govde: cift yukseklik (okunur)
    for (const item of data.items) {
      const label = asciify(`${item.quantity} x ${item.name}`);
      const amount = formatKurusForReceipt(item.lineTotalKurus);
      const labelWidth = 48 - amount.length - 1;
      const labelLines = wrap(label, labelWidth);

      p.setTextDoubleHeight();
      p.leftRight(labelLines[0] ?? '', amount);
      for (const extra of labelLines.slice(1)) {
        p.println(`  ${extra}`);
      }
      p.setTextNormal();

      for (const option of item.options) {
        const suffix =
          option.priceDeltaKurus !== 0
            ? ` (${formatKurusForReceipt(option.priceDeltaKurus)})`
            : '';
        p.println(asciify(`   + ${option.name}${suffix}`));
      }
      if (item.note) p.println(asciify(`   * ${item.note}`));
    }

    p.drawLine();
    p.leftRight('Ara Toplam', formatKurusForReceipt(data.subtotalKurus));

    if (data.discountKurus > 0) {
      p.leftRight(
        asciify(`Indirim${data.discountReason ? ` (${data.discountReason})` : ''}`),
        `-${formatKurusForReceipt(data.discountKurus)}`,
      );
    }

    // Toplam: iri, saga yasli
    p.alignRight();
    p.bold(true);
    p.setTextQuadArea();
    p.println(`TOPLAM ${formatKurusForReceipt(data.totalKurus)}`);
    p.setTextNormal();
    p.bold(false);
    p.alignLeft();

    if (data.payments.length > 0) {
      p.newLine();
      for (const payment of data.payments) {
        p.leftRight(
          PAYMENT_METHOD_LABELS[payment.method],
          formatKurusForReceipt(payment.amountKurus),
        );
      }
    }

    p.newLine();
    p.println(`KDV (%${data.vatPercent}) dahil: ${formatKurusForReceipt(data.vatKurus)}`);

    p.alignCenter();
    p.newLine();
    if (data.shop.footer) p.println(asciify(data.shop.footer));

    // Yasal ibare
    p.println('Bu belge bilgi amaclidir,');
    p.println('mali degeri olan fis degildir.');
  };
}

/* --------------------------------------------------------- GUN SONU FISI */

export function zReport(data: ZReportData): ReceiptBuilder {
  return (p: ThermalPrinter) => {
    p.alignCenter();
    p.bold(true);
    p.setTextQuadArea();
    p.println('GUN SONU');
    p.setTextNormal();
    p.println(asciify(data.shop.shopName));
    p.bold(false);
    p.println(asciify(formatBusinessDay(data.businessDay)));
    p.println(`Yazdirma: ${formatDateTime(data.printedAt)}`);

    p.alignLeft();
    p.drawLine();

    p.leftRight('Adisyon sayisi', String(data.orderCount));
    p.leftRight('Satilan kalem', String(data.itemCount));
    p.leftRight('Ortalama sepet', formatKurusForReceipt(data.avgBasketKurus));
    p.drawLine();

    p.leftRight('Brut satis', formatKurusForReceipt(data.grossKurus));
    if (data.discountKurus > 0) {
      p.leftRight('Indirim / ikram', `-${formatKurusForReceipt(data.discountKurus)}`);
    }

    p.alignRight();
    p.bold(true);
    p.setTextQuadArea();
    p.println(`CIRO ${formatKurusForReceipt(data.netKurus)}`);
    p.setTextNormal();
    p.bold(false);
    p.alignLeft();

    p.drawLine();
    p.leftRight('Nakit', formatKurusForReceipt(data.cashKurus));
    p.leftRight('Kart', formatKurusForReceipt(data.cardKurus));

    const paymentSum = data.cashKurus + data.cardKurus;
    if (paymentSum !== data.netKurus) {
      p.newLine();
      p.bold(true);
      p.leftRight('! Odeme farki', formatKurusForReceipt(data.netKurus - paymentSum));
      p.bold(false);
      p.println('  (acik hesap veya eksik odeme)');
    }

    p.drawLine();
    p.leftRight(`KDV (%${data.vatPercent})`, formatKurusForReceipt(data.vatKurus));

    if (data.cancelledItemCount > 0) {
      p.drawLine();
      p.leftRight(
        `Iptal kalem (${data.cancelledItemCount})`,
        formatKurusForReceipt(data.cancelledItemKurus),
      );
    }

    if (data.topProducts.length > 0) {
      p.drawLine();
      p.bold(true);
      p.println('EN COK SATANLAR');
      p.bold(false);
      for (const product of data.topProducts) {
        p.leftRight(
          asciify(`${product.quantity} x ${product.name}`),
          formatKurusForReceipt(product.revenueKurus),
        );
      }
    }

    p.drawLine();
    p.alignCenter();
    p.println('Bu belge bilgi amaclidir,');
    p.println('mali degeri olan fis degildir.');
  };
}

/* ------------------------------------------------------------- TEST FISI */

export function testReceipt(shopName: string): ReceiptBuilder {
  return (p: ThermalPrinter) => {
    p.alignCenter();
    p.bold(true);
    p.setTextQuadArea();
    p.println('YAZICI TEST');
    p.setTextNormal();
    p.println(asciify(shopName));
    p.bold(false);
    p.alignLeft();
    p.drawLine();

    p.println('Bu bir test fisidir.');
    p.println('Yazici, kesici ve (varsa) kasa');
    p.println('cekmecesi kontrol ediliyor.');
    p.drawLine();

    p.setTextDoubleHeight();
    p.leftRight('1 x Yarim Ekmek', formatKurusForReceipt(14000));
    p.setTextNormal();
    p.alignRight();
    p.setTextQuadArea();
    p.println(`TOPLAM ${formatKurusForReceipt(14000)}`);
    p.setTextNormal();
    p.alignLeft();

    p.drawLine();
    p.alignCenter();
    p.println('Fis buradan kesilmelidir');
  };
}

/* ------------------------------------------------------------ QR ETIKETI */

export function qrLabel(data: QrLabelData): ReceiptBuilder {
  return (p: ThermalPrinter) => {
    p.alignCenter();
    p.bold(true);
    p.setTextQuadArea();
    p.println(asciify(data.shopName));
    p.setTextNormal();
    p.bold(false);
    p.newLine();
    p.println('MENU ICIN OKUTUN');
    p.newLine();

    p.printQR(data.url, { cellSize: 8, correction: 'M', model: 2 });

    p.newLine();
    p.println('Fiyatlar guncel menude gorunur.');
  };
}
