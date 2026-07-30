/**
 * "Menüyü yayınla" - QR menu sitesinin onbellegini aninda tazeler.
 *
 * Fiyat/urun degisiklikleri normalde 60 saniyelik onbellek suresi sonunda
 * yayina girer; bu cagri o beklemeyi atlar. Menu sitesindeki /api/revalidate
 * ile paylasilan gizli anahtar uzerinden dogrulanir.
 */
export async function publishMenu(): Promise<{ ok: boolean; error?: string }> {
  const menuUrl = import.meta.env.VITE_MENU_URL as string | undefined;
  const secret = import.meta.env.VITE_REVALIDATE_SECRET as string | undefined;

  if (!menuUrl || !secret) {
    return {
      ok: false,
      error: 'Menü adresi veya yayın anahtarı tanımlı değil (.env: VITE_MENU_URL, VITE_REVALIDATE_SECRET).',
    };
  }

  try {
    const response = await fetch(`${menuUrl.replace(/\/$/, '')}/api/revalidate`, {
      method: 'POST',
      headers: { 'x-revalidate-secret': secret },
    });

    if (!response.ok) {
      return { ok: false, error: `Yayınlama başarısız (HTTP ${response.status}).` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Menü sitesine ulaşılamadı.',
    };
  }
}
