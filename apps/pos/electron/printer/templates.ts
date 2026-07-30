/**
 * Fis sablonlari (80mm / 48 karakter).
 *
 * Termal fis tasarim kurallari:
 *  - Fis dar: 48 karakter. Uzun urun adlari sarilir, tutar hep sagda kalir.
 *  - ₺ simgesi termal yazicilarda cogu zaman basilamaz; "TL" yaziyoruz.
 *  - Ocak fisinde FIYAT YOK: ocaktaki kisiye gereksiz bilgi kalabaligi olmaz.
 *  - Hesap fisinde yasal ibare var: bu belge yazarkasa fisinin yerini almaz.
 */

import type { ThermalPrinter } from 'node-thermal-printer';
import {
  formatClock,
  formatBusinessDay,
  formatKurusForReceipt,
  PAYMENT_METHOD_LABELS,
  type BillData,
  type KitchenTicketData,
  type QrLabelData,
  type ZReportData,
} from '@adisyon/shared';
import type { ReceiptBuilder } from './adapter';

/* ------------------------------------------------------------------ yardimci */

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
    p.setTextDoubleHeight();
    p.bold(true);
    p.println(data.isPartial ? 'YENİ SİPARİŞ' : 'OCAK FİŞİ');
    p.bold(false);
    p.setTextNormal();

    // Masa ve siparis no en buyuk puntoda: ocakta uzaktan okunmali
    p.setTextDoubleHeight();
    p.println(data.tableLabel);
    p.setTextNormal();

    p.println(`Sipariş No: ${data.orderNo}   Saat: ${formatClock(data.printedAt)}`);
    if (data.guestCount) p.println(`Kişi: ${data.guestCount}`);

    p.alignLeft();
    p.drawLine();

    for (const item of data.items) {
      p.bold(true);
      p.setTextDoubleHeight();
      p.println(`${item.quantity} x ${item.name}`);
      p.setTextNormal();
      p.bold(false);

      for (const option of item.options) {
        p.println(`   + ${option}`);
      }
      // Not, ocagin en cok dikkat etmesi gereken bilgi: vurgulu basiyoruz
      if (item.note) {
        p.bold(true);
        for (const line of wrap(`>> ${item.note}`, 46)) {
          p.println(`   ${line}`);
        }
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
    p.alignCenter();
    p.bold(true);
    p.setTextDoubleHeight();
    p.println(data.shop.header || data.shop.shopName);
    p.setTextNormal();
    p.bold(false);

    if (data.shop.address) p.println(data.shop.address);
    if (data.shop.phone) p.println(data.shop.phone);

    p.alignLeft();
    p.drawLine();
    p.leftRight(data.tableLabel, `Fiş No: ${data.orderNo}`);
    p.leftRight(`Açılış: ${formatClock(data.openedAt)}`, `Kapanış: ${formatClock(data.closedAt)}`);
    p.drawLine();

    for (const item of data.items) {
      // Satir 1: adet x urun ................ satir toplami
      const label = `${item.quantity} x ${item.name}`;
      const amount = formatKurusForReceipt(item.lineTotalKurus);
      const labelWidth = 48 - amount.length - 1;
      const labelLines = wrap(label, labelWidth);

      p.leftRight(labelLines[0] ?? '', amount);
      for (const extra of labelLines.slice(1)) {
        p.println(`  ${extra}`);
      }

      // Varyant/ekstralar: ucretli olanlarin farki gorunur
      for (const option of item.options) {
        const suffix =
          option.priceDeltaKurus !== 0
            ? ` (${formatKurusForReceipt(option.priceDeltaKurus)})`
            : '';
        p.println(`   + ${option.name}${suffix}`);
      }
      if (item.note) p.println(`   * ${item.note}`);
    }

    p.drawLine();
    p.leftRight('Ara Toplam', formatKurusForReceipt(data.subtotalKurus));

    if (data.discountKurus > 0) {
      p.leftRight(
        `İndirim${data.discountReason ? ` (${data.discountReason})` : ''}`,
        `-${formatKurusForReceipt(data.discountKurus)}`,
      );
    }

    p.bold(true);
    p.setTextDoubleHeight();
    p.leftRight('TOPLAM', formatKurusForReceipt(data.totalKurus));
    p.setTextNormal();
    p.bold(false);

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
    if (data.shop.footer) p.println(data.shop.footer);

    // Yasal ibare: bastigimiz belge bilgi fisidir, yazarkasa fisi degildir.
    p.println('Bu belge bilgi amaçlıdır,');
    p.println('mali değeri olan fiş değildir.');
  };
}

/* --------------------------------------------------------- GUN SONU FISI */

export function zReport(data: ZReportData): ReceiptBuilder {
  return (p: ThermalPrinter) => {
    p.alignCenter();
    p.bold(true);
    p.setTextDoubleHeight();
    p.println('GÜN SONU RAPORU');
    p.setTextNormal();
    p.println(data.shop.shopName);
    p.bold(false);
    p.println(formatBusinessDay(data.businessDay));
    p.println(`Yazdırma: ${formatClock(data.printedAt)}`);

    p.alignLeft();
    p.drawLine();

    p.leftRight('Adisyon sayısı', String(data.orderCount));
    p.leftRight('Satılan kalem', String(data.itemCount));
    p.leftRight('Ortalama sepet', formatKurusForReceipt(data.avgBasketKurus));
    p.drawLine();

    p.leftRight('Brüt satış', formatKurusForReceipt(data.grossKurus));
    if (data.discountKurus > 0) {
      p.leftRight('İndirim / ikram', `-${formatKurusForReceipt(data.discountKurus)}`);
    }

    p.bold(true);
    p.setTextDoubleHeight();
    p.leftRight('CİRO', formatKurusForReceipt(data.netKurus));
    p.setTextNormal();
    p.bold(false);

    p.drawLine();
    p.leftRight('Nakit', formatKurusForReceipt(data.cashKurus));
    p.leftRight('Kart', formatKurusForReceipt(data.cardKurus));

    // Kasa sayimi ile karsilastirma icin: nakit tutar kasada olmali
    const paymentSum = data.cashKurus + data.cardKurus;
    if (paymentSum !== data.netKurus) {
      p.newLine();
      p.bold(true);
      p.leftRight('! Ödeme farkı', formatKurusForReceipt(data.netKurus - paymentSum));
      p.bold(false);
      p.println('  (açık hesap veya eksik ödeme)');
    }

    p.drawLine();
    p.leftRight(`KDV (%${data.vatPercent})`, formatKurusForReceipt(data.vatKurus));

    if (data.cancelledItemCount > 0) {
      p.drawLine();
      p.leftRight(
        `İptal edilen kalem (${data.cancelledItemCount})`,
        formatKurusForReceipt(data.cancelledItemKurus),
      );
    }

    if (data.topProducts.length > 0) {
      p.drawLine();
      p.bold(true);
      p.println('EN ÇOK SATANLAR');
      p.bold(false);
      for (const product of data.topProducts) {
        p.leftRight(
          `${product.quantity} x ${product.name}`,
          formatKurusForReceipt(product.revenueKurus),
        );
      }
    }

    p.drawLine();
    p.alignCenter();
    p.println('Bu belge bilgi amaçlıdır,');
    p.println('mali değeri olan fiş değildir.');
  };
}

/* ------------------------------------------------------------- TEST FISI */

/**
 * Test fisi. Kurulumun ILK GUNUNDE calistirilmali.
 *
 * Sirasiyla su uceyi dogruluyor:
 *   1. Turkce karakterlerin dogru codepage ile basildigi
 *   2. Otomatik kesicinin calistigi (adapter cut() ekliyor)
 *   3. Kasa cekmecesinin acildigi (ayar aciksa)
 */
export function testReceipt(shopName: string): ReceiptBuilder {
  return (p: ThermalPrinter) => {
    p.alignCenter();
    p.bold(true);
    p.println('YAZICI TEST FİŞİ');
    p.bold(false);
    p.println(shopName);
    p.alignLeft();
    p.drawLine();

    p.bold(true);
    p.println('TÜRKÇE KARAKTER TESTİ');
    p.bold(false);
    p.println('Küçük : ç ğ ı i ö ş ü');
    p.println('Büyük : Ç Ğ I İ Ö Ş Ü');
    p.println('Cümle : Şişli’de ağır bir çöp yığını');
    p.println('Ürün  : Yarım Ekmek Kokoreç, Şalgam');
    p.newLine();
    p.println('Yukarıdaki satırlarda bozuk karakter');
    p.println('varsa Ayarlar > Yazıcı bölümünden');
    p.println('karakter setini değiştirip tekrar');
    p.println('deneyin.');

    p.drawLine();
    p.bold(true);
    p.println('BİÇİM TESTİ');
    p.bold(false);
    p.leftRight('Sol taraf', 'Sağ taraf');
    p.leftRight('1 x Yarım Ekmek Kokoreç', formatKurusForReceipt(14000));
    p.setTextDoubleHeight();
    p.println('Büyük punto');
    p.setTextNormal();

    p.drawLine();
    p.println('Fiş buradan kesilmelidir ↓');
  };
}

/* ------------------------------------------------------------ QR ETIKETI */

/**
 * Masalara yapistirilacak QR etiketi.
 * Yazici zaten hazir oldugu icin etiketi ayrica bastirmaya gerek kalmiyor.
 */
export function qrLabel(data: QrLabelData): ReceiptBuilder {
  return (p: ThermalPrinter) => {
    p.alignCenter();
    p.bold(true);
    p.setTextDoubleHeight();
    p.println(data.shopName);
    p.setTextNormal();
    p.bold(false);
    p.newLine();
    p.println('MENÜ İÇİN OKUTUN');
    p.newLine();

    // printImageBuffer yerine yazicinin kendi QR komutu: cok daha hizli basar
    // ve olceklendirme sorunu cikmaz.
    p.printQR(data.url, { cellSize: 8, correction: 'M', model: 2 });

    p.newLine();
    p.println('Fiyatlar güncel menüde');
    p.println('görüntülenir.');
  };
}
