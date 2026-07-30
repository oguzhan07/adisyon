import { createClient } from '@supabase/supabase-js';

/**
 * QR menu sitesinin Supabase istemcisi.
 *
 * YALNIZCA anon anahtari kullanilir. Service role anahtari bu uygulamaya
 * hicbir kosulda girmez: bu kod musterinin telefonunda calisiyor ve anon
 * anahtarinin yetkisi RLS ile menu tablolarinin okunmasina kilitli
 * (bkz. supabase/migrations/...rls.sql).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY tanimli olmali. ' +
      'Ornek icin .env.example dosyasina bakin.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    // Menu sitesinde oturum yok: gereksiz token yenileme istegi atilmasin
    persistSession: false,
    autoRefreshToken: false,
  },
});

/* ------------------------------------------------------------------ tipler */

export interface MenuOption {
  id: string;
  name: string;
  price_delta_kurus: number;
  is_available: boolean;
  sort_order: number;
}

export interface MenuOptionGroup {
  id: string;
  name: string;
  selection_type: 'single' | 'multi';
  sort_order: number;
  options: MenuOption[];
}

export interface MenuProduct {
  id: string;
  name: string;
  description: string | null;
  price_kurus: number;
  image_path: string | null;
  is_available: boolean;
  sort_order: number;
  option_groups: MenuOptionGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  sort_order: number;
  products: MenuProduct[];
}

export interface ShopInfo {
  shop_name: string;
  address: string | null;
  phone: string | null;
}

/* ----------------------------------------------------------------- sorgular */

/**
 * Tum menuyu tek istekte ceker.
 *
 * Nested select kullaniyoruz: kategori -> urun -> opsiyon grubu -> opsiyon.
 * Tek gidis-donus, telefonda daha hizli acilis. Pasif satirlar RLS
 * politikasi tarafindan zaten filtreleniyor; burada ayrica siralama yapiyoruz.
 */
export async function fetchMenu(): Promise<MenuCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select(
      `
      id, name, sort_order,
      products (
        id, name, description, price_kurus, image_path, is_available, sort_order,
        product_option_groups (
          sort_order,
          option_groups (
            id, name, selection_type, sort_order,
            options ( id, name, price_delta_kurus, is_available, sort_order )
          )
        )
      )
    `,
    )
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`Menü yüklenemedi: ${error.message}`);

  type RawGroup = Omit<MenuOptionGroup, 'options'> & { options: MenuOption[] | null };
  type RawGroupLink = {
    sort_order: number;
    // Supabase, ice gomulu tekil iliskileri duruma gore nesne YA DA tek
    // elemanli dizi olarak dondurebilir. Iki sekli de kabul ediyoruz - yanlis
    // varsayim menuyu tamamen bos gosterir ve sebebi zor bulunur.
    option_groups: RawGroup | RawGroup[] | null;
  };
  type RawProduct = Omit<MenuProduct, 'option_groups'> & {
    product_option_groups: RawGroupLink[] | null;
  };
  type RawCategory = Omit<MenuCategory, 'products'> & { products: RawProduct[] | null };

  return ((data ?? []) as unknown as RawCategory[])
    .map((category) => ({
      id: category.id,
      name: category.name,
      sort_order: category.sort_order,
      products: (category.products ?? [])
        .map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          price_kurus: product.price_kurus,
          image_path: product.image_path,
          is_available: product.is_available,
          sort_order: product.sort_order,
          option_groups: (product.product_option_groups ?? [])
            .map((link) => firstOf(link.option_groups))
            .filter((group): group is RawGroup => group !== null)
            .map((group) => ({
              id: group.id,
              name: group.name,
              selection_type: group.selection_type,
              sort_order: group.sort_order,
              // Tukendi opsiyonlar musteriye gosterilmez: secemeyecegi bir
              // secenegi listelemek kafa karistirir
              options: (group.options ?? [])
                .filter((option) => option.is_available)
                .sort((a, b) => a.sort_order - b.sort_order),
            }))
            .sort((a, b) => a.sort_order - b.sort_order),
        }))
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr')),
    }))
    // Urunu olmayan kategori sekmesi gostermeye gerek yok
    .filter((category) => category.products.length > 0);
}

/** Nesne ya da dizi olarak gelebilen gomulu iliskiyi tek degere indirger */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function fetchShopInfo(): Promise<ShopInfo | null> {
  const { data, error } = await supabase
    .from('v_public_shop_info')
    .select('shop_name, address, phone')
    .maybeSingle();

  // Dukkan bilgisi menuyu engellemeyecek kadar ikincil: hata olursa yoksay
  if (error) return null;
  return data;
}

/** Supabase Storage'daki gorselin herkese acik URL'i */
export function imageUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}
