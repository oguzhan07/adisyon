import { useState } from 'react';
import { formatKurus, parseTRYToKurus } from '@adisyon/shared';
import { Button } from '../../ui/Button';
import { Field, Select, TextInput } from '../../ui/Field';
import { Modal } from '../../ui/Modal';
import { useFeedback } from '../../ui/feedback';
import { describeError, productImageUrl, supabase } from '../../lib/supabase';
import { useMenuMutations, type OptionGroupWithOptions, type ProductWithGroups } from '../../lib/menuData';
import { useIngredients, useRecipe, useStockMutations } from '../../lib/stockData';
import type { Category } from '../../lib/dbTypes';
import { RecipeEditor, type RecipeLine } from './RecipeEditor';

interface Props {
  product: ProductWithGroups | null; // null = yeni urun
  categories: Category[];
  optionGroups: OptionGroupWithOptions[];
  defaultCategoryId: string;
  onClose: () => void;
}

/**
 * Urun ekle/duzenle modali: temel alanlar + opsiyon gruplari + fotograf +
 * recete. Recete ayni kaydetmede guncellenir; boylece "kaydet" tek islemde
 * her seyi tutar.
 */
export function ProductEditor({
  product,
  categories,
  optionGroups,
  defaultCategoryId,
  onClose,
}: Props) {
  const feedback = useFeedback();
  const { saveProduct } = useMenuMutations();
  const { saveRecipe } = useStockMutations();
  const ingredients = useIngredients();
  const existingRecipe = useRecipe(product?.id ?? null);

  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [priceText, setPriceText] = useState(
    product ? formatKurus(product.price_kurus) : '',
  );
  const [categoryId, setCategoryId] = useState(product?.category_id ?? defaultCategoryId);
  const [isAvailable, setIsAvailable] = useState(product?.is_available ?? true);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(product?.option_group_ids ?? []);
  const [imagePath, setImagePath] = useState<string | null>(product?.image_path ?? null);
  const [uploading, setUploading] = useState(false);
  const [recipeLines, setRecipeLines] = useState<RecipeLine[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Mevcut recete yuklendiginde formu bir kez doldur
  const effectiveRecipe: RecipeLine[] =
    recipeLines ??
    (existingRecipe.data ?? []).map((r) => ({ ingredient_id: r.ingredient_id, quantity: r.quantity }));

  function toggleGroup(groupId: string) {
    setSelectedGroups((current) =>
      current.includes(groupId)
        ? current.filter((g) => g !== groupId)
        : [...current, groupId],
    );
  }

  async function handleImage() {
    const filePath = await window.desktop.pickImage();
    if (!filePath) return;

    setUploading(true);
    try {
      const prepared = await window.desktop.prepareImage(filePath);
      const bytes = Uint8Array.from(atob(prepared.base64), (c) => c.charCodeAt(0));
      const storagePath = `${crypto.randomUUID()}.webp`;

      const { error } = await supabase.storage
        .from('product-images')
        .upload(storagePath, bytes, { contentType: 'image/webp', upsert: false });
      if (error) throw error;

      setImagePath(storagePath);
      feedback.toast('Fotoğraf yüklendi.', 'ok');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    const priceKurus = parseTRYToKurus(priceText);
    if (name.trim() === '') {
      feedback.toast('Ürün adı zorunlu.', 'error');
      return;
    }
    if (priceKurus === null || priceKurus < 0) {
      feedback.toast('Geçerli bir fiyat girin.', 'error');
      return;
    }

    setBusy(true);
    try {
      await saveProduct.mutateAsync({
        product: {
          ...(product?.id ? { id: product.id } : {}),
          name: name.trim(),
          description: description.trim() || null,
          price_kurus: priceKurus,
          category_id: categoryId,
          is_available: isAvailable,
          image_path: imagePath,
        },
        optionGroupIds: selectedGroups,
      });

      // Recete: yeni urunde id save sonrasi olusur; bu yuzden urunu tekrar
      // bulmak yerine recete kaydini yalnizca DUZENLEMEDE burada yapiyoruz.
      // Yeni urunde recete, urun listesinden tekrar acilarak eklenir.
      if (product?.id) {
        await saveRecipe.mutateAsync({ productId: product.id, lines: effectiveRecipe.filter((l) => l.quantity > 0) });
      }

      feedback.toast('Ürün kaydedildi.', 'ok');
      onClose();
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const imagePreview = productImageUrl(imagePath);

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? 'Ürünü düzenle' : 'Yeni ürün'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={busy || uploading}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-4">
          <Field label="Ürün adı">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Açıklama">
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fiyat (₺, KDV dahil)">
              <TextInput
                inputMode="decimal"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                className="tabular text-right"
              />
            </Field>
            <Field label="Kategori">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={isAvailable}
              onChange={(e) => setIsAvailable(e.target.checked)}
              className="size-5 accent-(--color-accent)"
            />
            <span>Satışta (kapalıysa menüde "Tükendi" görünür)</span>
          </label>

          {/* Fotograf */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
              Fotoğraf
            </span>
            <div className="flex items-center gap-3">
              {imagePreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imagePreview}
                  alt=""
                  className="size-16 rounded-(--radius-control) object-cover"
                />
              )}
              <Button variant="secondary" onClick={handleImage} disabled={uploading}>
                {uploading ? 'Yükleniyor…' : imagePreview ? 'Değiştir' : 'Fotoğraf seç'}
              </Button>
              {imagePath && (
                <button
                  type="button"
                  onClick={() => setImagePath(null)}
                  className="text-sm text-(--color-status-alert)"
                >
                  Kaldır
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Opsiyon gruplari */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
              Varyant / ekstra grupları
            </span>
            <div className="space-y-1.5">
              {optionGroups.map((group) => (
                <label key={group.id} className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selectedGroups.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                    className="size-5 accent-(--color-accent)"
                  />
                  <span>{group.name}</span>
                </label>
              ))}
              {optionGroups.length === 0 && (
                <p className="text-sm text-(--color-text-faint)">Tanımlı grup yok.</p>
              )}
            </div>
          </div>

          {/* Recete */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
              Reçete (bir porsiyonda kullanılan malzeme)
            </span>
            {product?.id ? (
              <RecipeEditor
                ingredients={ingredients.data ?? []}
                lines={effectiveRecipe}
                onChange={setRecipeLines}
              />
            ) : (
              <p className="text-sm text-(--color-text-faint)">
                Reçeteyi eklemek için önce ürünü kaydedin, sonra tekrar düzenleyin.
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
