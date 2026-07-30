import { useState } from 'react';
import { formatTRY } from '@adisyon/shared';
import {
  useCategories,
  useMenuMutations,
  useOptionGroups,
  useProducts,
  type ProductWithGroups,
} from '../lib/menuData';
import { publishMenu } from '../lib/publish';
import { describeError } from '../lib/supabase';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { TextInput } from '../ui/Field';
import { useFeedback } from '../ui/feedback';
import { ProductEditor } from './menu/ProductEditor';

/**
 * Menu yonetimi: kategoriler, urunler, "bugun tukendi" anahtari ve menuyu
 * yayinlama. QR menu bu tablolardan beslendigi icin buradaki degisiklik
 * "Menüyü yayınla" ile aninda musteri tarafina yansir.
 */
export function MenuAdmin() {
  const feedback = useFeedback();
  const categories = useCategories(true);
  const products = useProducts(true);
  const optionGroups = useOptionGroups();
  const { saveCategory, setAvailability } = useMenuMutations();

  const [editing, setEditing] = useState<ProductWithGroups | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [publishing, setPublishing] = useState(false);

  async function handlePublish() {
    setPublishing(true);
    const result = await publishMenu();
    setPublishing(false);
    feedback.toast(
      result.ok ? 'Menü yayınlandı. Müşteriler güncel menüyü görecek.' : (result.error ?? 'Yayınlanamadı.'),
      result.ok ? 'ok' : 'error',
    );
  }

  async function addCategory() {
    if (newCategoryName.trim() === '') return;
    try {
      await saveCategory.mutateAsync({
        name: newCategoryName.trim(),
        sort_order: (categories.data ?? []).length,
      });
      setNewCategoryName('');
      feedback.toast('Kategori eklendi.', 'ok');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  if (categories.isLoading || products.isLoading) {
    return <p className="p-6 text-(--color-text-muted)">Yükleniyor…</p>;
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-bold">Menü Yönetimi</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCategoryModal(true)}>
            Kategoriler
          </Button>
          <Button onClick={handlePublish} disabled={publishing}>
            {publishing ? 'Yayınlanıyor…' : 'Menüyü yayınla'}
          </Button>
        </div>
      </div>

      {(categories.data ?? []).map((category) => {
        const items = (products.data ?? []).filter((p) => p.category_id === category.id);
        return (
          <section key={category.id} className="mb-7">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-(--color-text-muted)">
                {category.name}
                {!category.is_active && (
                  <span className="ml-2 text-xs text-(--color-status-alert)">(pasif)</span>
                )}
              </h2>
              <Button variant="ghost" onClick={() => setCreatingIn(category.id)}>
                + Ürün ekle
              </Button>
            </div>

            <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border)">
              {items.length === 0 && (
                <p className="px-4 py-3 text-sm text-(--color-text-faint)">Bu kategoride ürün yok.</p>
              )}
              {items.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between border-b border-(--color-border) px-4 py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {product.name}
                      {!product.is_active && (
                        <span className="ml-2 text-xs text-(--color-status-alert)">pasif</span>
                      )}
                    </div>
                    {product.description && (
                      <div className="truncate text-sm text-(--color-text-muted)">
                        {product.description}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <span className="tabular font-semibold">{formatTRY(product.price_kurus)}</span>

                    {/* Bugun tukendi hizli anahtari */}
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={product.is_available}
                        onChange={(e) =>
                          setAvailability.mutate({ id: product.id, isAvailable: e.target.checked })
                        }
                        className="size-5 accent-(--color-accent)"
                      />
                      <span className="text-(--color-text-muted)">
                        {product.is_available ? 'Satışta' : 'Tükendi'}
                      </span>
                    </label>

                    <Button variant="ghost" onClick={() => setEditing(product)}>
                      Düzenle
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {(editing || creatingIn) && (
        <ProductEditor
          product={editing}
          categories={(categories.data ?? []).filter((c) => c.is_active)}
          optionGroups={optionGroups.data ?? []}
          defaultCategoryId={creatingIn ?? editing?.category_id ?? categories.data?.[0]?.id ?? ''}
          onClose={() => {
            setEditing(null);
            setCreatingIn(null);
          }}
        />
      )}

      <Modal
        open={categoryModal}
        onClose={() => setCategoryModal(false)}
        title="Kategoriler"
        footer={
          <Button variant="ghost" onClick={() => setCategoryModal(false)}>
            Kapat
          </Button>
        }
      >
        <div className="mb-4 flex gap-2">
          <TextInput
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Yeni kategori adı"
          />
          <Button onClick={addCategory}>Ekle</Button>
        </div>
        <ul className="space-y-1">
          {(categories.data ?? []).map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-(--radius-control) border border-(--color-border) px-3 py-2"
            >
              <span>{c.name}</span>
              <button
                type="button"
                onClick={() =>
                  saveCategory.mutate({ id: c.id, name: c.name, is_active: !c.is_active })
                }
                className="text-sm text-(--color-text-muted) hover:underline"
              >
                {c.is_active ? 'Pasife al' : 'Aktifleştir'}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
