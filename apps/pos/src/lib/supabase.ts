import { createClient, type SupportedStorage } from '@supabase/supabase-js';

/**
 * Kasa programinin Supabase istemcisi.
 *
 * Oturum jetonu localStorage'a DEGIL, isletim sisteminin sifreleme servisine
 * (Windows DPAPI) yazilir. localStorage diskte duz metin durur; kasa
 * bilgisayarina fiziksel erisen biri jetonu alip veritabanina baglanabilirdi.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Yapilandirma eksikse modul yuklenirken HATA FIRLATMIYORUZ.
 *
 * Firlatirsak React hic mount edilemez ve kullanici bomboş beyaz bir pencere
 * gorur - kurulum sirasinda sebebi anlasilmayan en sinir bozucu durum. Onun
 * yerine bayragi disari veriyoruz; App bunu gorup ne yapilmasi gerektigini
 * anlatan bir ekran gosteriyor.
 */
export const configError: string | null =
  !url || !anonKey
    ? 'Supabase bağlantı bilgileri eksik. VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlanmalı.'
    : null;

/**
 * Oturum deposu.
 *
 * ELECTRON'DA: isletim sisteminin sifreleme servisine (Windows DPAPI) yazilir;
 * jeton diskte SIFRELI durur. Bu, gercek kullanim yolu.
 *
 * TARAYICIDA (window.desktop yok): Bu program bir MASAUSTU uygulamasidir ve
 * asil olarak Electron penceresinde calisir. Ama gelistirme/onizleme sirasinda
 * dev sunucusu (localhost:5173) tarayicida da acilabilir; orada masaustu
 * koprusu bulunmaz. Cokme yerine localStorage'a duserek en azindan arayuzun
 * yuklenmesini sagliyoruz (yazici gibi masaustu ozellikleri yine calismaz).
 */
const desktopApi = (globalThis as { desktop?: import('@adisyon/shared').DesktopApi }).desktop;

const secureStorage: SupportedStorage = desktopApi
  ? {
      getItem: (key) => desktopApi.secureStore.get(key),
      setItem: (key, value) => desktopApi.secureStore.set(key, value),
      removeItem: (key) => desktopApi.secureStore.remove(key),
    }
  : window.localStorage;

/** Masaustu koprusu var mi (Electron icinde miyiz)? UI bazi yerlerde buna bakar. */
export const isDesktop = !!desktopApi;

// configError varken istemci hic kullanilmaz (App onceden durdurur); yer
// tutucu degerler yalnizca createClient'in dogrulamasini gecmek icin.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'yapilandirilmadi', {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Masaustu uygulamasinda URL'de oturum donusu olmaz
    detectSessionInUrl: false,
  },
});

/** Supabase Storage'daki urun gorselinin herkese acik URL'i */
export function productImageUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

/**
 * Supabase hatalarini kullaniciya gosterilebilir Turkce mesaja cevirir.
 * Ham Postgres hatalari ("violates check constraint ...") kasiyere hicbir
 * sey anlatmaz; bilinen durumlari ceviriyoruz.
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) {
    return 'Sunucuya ulaşılamıyor. İnternet bağlantısını kontrol edin.';
  }
  if (/Invalid login credentials/i.test(message)) {
    return 'E-posta veya şifre hatalı.';
  }
  if (/JWT expired|token is expired/i.test(message)) {
    return 'Oturum süresi doldu. Lütfen tekrar giriş yapın.';
  }
  if (/odenmemis/i.test(message)) {
    // rpc_close_order'dan gelen kontrollu hata
    return message;
  }
  return message;
}
