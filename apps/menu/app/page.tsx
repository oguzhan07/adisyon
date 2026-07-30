import { formatTRY, formatPriceDelta } from '@adisyon/shared';
import { CategoryTabs } from '../components/CategoryTabs';
import { fetchMenu, fetchShopInfo, imageUrl, type MenuProduct } from '../lib/supabase';

/**
 * Menu nadiren degisir; sayfayi 60 saniye onbellekte tutuyoruz. Patron kasadan
 * "Menuyu yayinla" dedigi anda /api/revalidate cagrilir ve onbellek aninda
 * tazelenir - musteri eski fiyati gormez.
 */
export const revalidate = 60;

export default async function MenuPage() {
  /**
   * Veritabanina ulasilamamasi GECICI bir durumdur (Supabase takilmasi, ag
   * sorunu): dagitimi dusurmek yerine nazik bir mesaj gosterip bir sonraki
   * tazelemede tekrar deniyoruz. Eksik ortam degiskeni ise YAPILANDIRMA
   * hatasidir ve lib/supabase.ts icinde bilincli olarak build'i dusurur.
   */
  let categories: Awaited<ReturnType<typeof fetchMenu>> = [];
  let shop: Awaited<ReturnType<typeof fetchShopInfo>> = null;

  try {
    [categories, shop] = await Promise.all([fetchMenu(), fetchShopInfo()]);
  } catch (error) {
    console.error('Menü yüklenemedi:', error);
  }

  if (categories.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center p-6">
        <p className="text-center text-(--color-text-muted)">
          Menü şu anda hazırlanıyor. Lütfen daha sonra tekrar deneyin.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl pb-16">
      <header className="px-4 pt-8 pb-5">
        <h1 className="text-2xl font-bold tracking-tight">{shop?.shop_name ?? 'Menü'}</h1>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Siparişiniz için garsonumuza bildirebilirsiniz.
        </p>
      </header>

      <CategoryTabs categories={categories.map((c) => ({ id: c.id, name: c.name }))} />

      {categories.map((category) => (
        <section key={category.id} id={`kategori-${category.id}`} className="px-4 pt-7">
          <h2 className="mb-3 text-lg font-semibold text-(--color-accent)">{category.name}</h2>

          <ul className="divide-y divide-(--color-border)">
            {category.products.map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </ul>
        </section>
      ))}

      {(shop?.phone || shop?.address) && (
        <footer className="mt-10 border-t border-(--color-border) px-4 pt-6 text-sm text-(--color-text-muted)">
          {shop.address && <p>{shop.address}</p>}
          {shop.phone && (
            <p className="mt-1">
              <a href={`tel:${shop.phone}`} className="underline">
                {shop.phone}
              </a>
            </p>
          )}
        </footer>
      )}
    </main>
  );
}

function ProductRow({ product }: { product: MenuProduct }) {
  const soldOut = !product.is_available;
  const image = imageUrl(product.image_path);

  return (
    <li className={`flex gap-3 py-4 ${soldOut ? 'opacity-55' : ''}`}>
      {image && (
        // next/image yerine <img>: gorseller Storage'dan WebP olarak zaten
        // boyutlandirilmis geliyor, ek optimizasyon katmani gecikme ekler
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          width={72}
          height={72}
          loading="lazy"
          decoding="async"
          className="size-18 shrink-0 rounded-(--radius-control) object-cover"
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-medium">
            {product.name}
            {soldOut && (
              <span className="ml-2 rounded-full bg-(--color-status-alert-soft) px-2 py-0.5 align-middle text-xs font-semibold text-(--color-status-alert)">
                Tükendi
              </span>
            )}
          </h3>
          {/* Fiyat tukendi urunlerde de gorunur: musteri fiyati bilmek ister */}
          <span className="tabular shrink-0 font-semibold">{formatTRY(product.price_kurus)}</span>
        </div>

        {product.description && (
          <p className="mt-0.5 text-sm text-(--color-text-muted)">{product.description}</p>
        )}

        {product.option_groups.map((group) => (
          <p key={group.id} className="mt-1.5 text-xs text-(--color-text-faint)">
            <span className="font-medium">{group.name}:</span>{' '}
            {group.options
              .map((option) => {
                const delta = formatPriceDelta(option.price_delta_kurus, formatTRY);
                return delta ? `${option.name} ${delta}` : option.name;
              })
              .join(' · ')}
          </p>
        ))}
      </div>
    </li>
  );
}
