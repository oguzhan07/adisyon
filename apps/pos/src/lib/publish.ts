/**
 * "Menüyü yayınla" - QR menu sitesinin onbellegini aninda tazeler.
 *
 * Fiyat/urun degisiklikleri normalde 60 saniyelik onbellek suresi sonunda
 * yayina girer; bu cagri o beklemeyi atlar.
 *
 * Istek ANA SURECTEN atilir (window.desktop.publishMenu). Sebep: renderer'in
 * guvenlik politikasi (CSP) yalnizca Supabase'e baglanti izni veriyor; menu
 * sitesi baska bir alan adinda oldugu icin buradan yapilan fetch "Failed to
 * fetch" ile engellenirdi.
 */
export async function publishMenu(): Promise<{ ok: boolean; error?: string }> {
  const menuUrl = import.meta.env.VITE_MENU_URL as string | undefined;
  const secret = import.meta.env.VITE_REVALIDATE_SECRET as string | undefined;

  if (!menuUrl || !secret) {
    return {
      ok: false,
      error:
        'Menü adresi veya yayın anahtarı tanımlı değil (.env: VITE_MENU_URL, VITE_REVALIDATE_SECRET).',
    };
  }

  return window.desktop.publishMenu(menuUrl, secret);
}
