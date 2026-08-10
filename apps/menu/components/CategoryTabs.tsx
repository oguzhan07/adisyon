'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  categories: { id: string; name: string }[];
}

/**
 * Ust kisimda sabit duran kategori sekmeleri.
 *
 * Aktif sekmeyi IntersectionObserver ile buluyoruz - kaydirma olayina
 * baglanip her karede hesap yapmaktan daha az is, telefonda daha akici.
 * Sayfadaki tek istemci bileseni; geri kalan her sey sunucuda render ediliyor.
 */
export function CategoryTabs({ categories }: Props) {
  const [activeId, setActiveId] = useState(categories[0]?.id ?? '');
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Kaydirma tabanli aktif-sekme tespiti: sabit cubugun hemen altindaki
    // esik cizgisini gecmis EN SON bolum aktiftir. En ustteyken hicbir bolum
    // esigi gecmedigi icin ilk kategori (Kokorec) aktif kalir - Intersection
    // Observer'in en uste yanlis kategoriyi secmesi sorunu boyle cozuluyor.
    const THRESHOLD = 100; // sabit sekme cubugu + bir miktar bosluk (px)

    const update = () => {
      let current = categories[0]?.id ?? '';
      for (const category of categories) {
        const el = document.getElementById(`kategori-${category.id}`);
        if (el && el.getBoundingClientRect().top - THRESHOLD <= 0) {
          current = category.id;
        }
      }
      setActiveId(current);
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [categories]);

  // Aktif sekme gorunur alandan cikarsa yatayda ona kaydir
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const tab = bar.querySelector<HTMLElement>(`[data-tab="${activeId}"]`);
    tab?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [activeId]);

  return (
    <div
      ref={barRef}
      className="scroll-thin sticky top-0 z-10 flex gap-2 overflow-x-auto border-b border-(--color-border) bg-(--color-surface)/95 px-4 py-3 backdrop-blur"
    >
      {categories.map((category) => {
        const isActive = category.id === activeId;
        return (
          <a
            key={category.id}
            data-tab={category.id}
            href={`#kategori-${category.id}`}
            aria-current={isActive ? 'true' : undefined}
            className={[
              'shrink-0 rounded-(--radius-control) px-4 py-2 text-base font-medium transition-colors',
              isActive
                ? 'bg-(--color-accent) text-(--color-accent-fg)'
                : 'bg-(--color-surface-sunken) text-(--color-text-muted)',
            ].join(' ')}
          >
            {category.name}
          </a>
        );
      })}
    </div>
  );
}
