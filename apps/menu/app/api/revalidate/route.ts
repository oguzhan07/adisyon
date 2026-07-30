import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

/**
 * Menu onbellegini aninda tazeler.
 *
 * Kasa programindaki "Menüyü yayınla" dugmesi buraya istek atar. Boylece
 * fiyat degisikligi 60 saniyelik onbellek suresini beklemeden yayina girer.
 *
 * Yetki: paylasilan gizli anahtar (REVALIDATE_SECRET). Anahtar sabit zamanli
 * karsilastirma ile dogrulanir; ucu acik bir "cache temizle" ucnoktasi
 * birakmak istemiyoruz.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'REVALIDATE_SECRET tanimli degil.' },
      { status: 500 },
    );
  }

  const provided = request.headers.get('x-revalidate-secret') ?? '';

  if (!timingSafeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: 'Yetkisiz.' }, { status: 401 });
  }

  revalidatePath('/');

  return NextResponse.json({ ok: true, revalidatedAt: new Date().toISOString() });
}

/** Uzunluk sizdirmayan sabit zamanli karsilastirma */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
