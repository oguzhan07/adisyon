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
    const sections = categories
      .map((c) => document.getElementById(`kategori-${c.id}`))
      .filter((el): el is HTMLElement => el !== null);

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Ekranda gorunen en ustteki bolum aktif kabul edilir
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible[0]) {
          setActiveId(visible[0].target.id.replace('kategori-', ''));
        }
      },
      // Sabit cubugun yuksekligi kadar ust bosluk birakiyoruz
      { rootMargin: '-72px 0px -60% 0px', threshold: 0 },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
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
