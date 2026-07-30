import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { qk } from './queryKeys';
import type { Category, OptionGroup, OptionRow, Product } from './dbTypes';

/* --------------------------------------------------------------- kategoriler */

export function useCategories(includeInactive = false) {
  return useQuery({
    queryKey: [...qk.categories, includeInactive],
    queryFn: async (): Promise<Category[]> => {
      let query = supabase.from('categories').select('*').order('sort_order');
      if (!includeInactive) query = query.eq('is_active', true);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
}

/* ------------------------------------------------------------------ urunler */

export interface ProductWithGroups extends Product {
  option_group_ids: string[];
}

/**
 * Adisyon ekrani ve menu yonetimi icin urunler + hangi opsiyon gruplarina
 * bagli olduklari. Kategori bazli gruplama cagiran tarafta yapilir.
 */
export function useProducts(includeInactive = false) {
  return useQuery({
    queryKey: [...qk.products, includeInactive],
    queryFn: async (): Promise<ProductWithGroups[]> => {
      let query = supabase
        .from('products')
        .select('*, product_option_groups(option_group_id, sort_order)')
        .order('sort_order');
      if (!includeInactive) query = query.eq('is_active', true);

      const { data, error } = await query;
      if (error) throw error;

      type Raw = Product & {
        product_option_groups: { option_group_id: string; sort_order: number }[] | null;
      };

      return ((data ?? []) as Raw[]).map((p) => ({
        ...p,
        option_group_ids: (p.product_option_groups ?? [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((link) => link.option_group_id),
      }));
    },
  });
}

/* ------------------------------------------------------- opsiyon gruplari */

export interface OptionGroupWithOptions extends OptionGroup {
  options: OptionRow[];
}

export function useOptionGroups() {
  return useQuery({
    queryKey: qk.optionGroups,
    queryFn: async (): Promise<OptionGroupWithOptions[]> => {
      const { data, error } = await supabase
        .from('option_groups')
        .select('*, options(*)')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;

      type Raw = OptionGroup & { options: OptionRow[] | null };
      return ((data ?? []) as Raw[]).map((g) => ({
        ...g,
        options: (g.options ?? []).sort((a, b) => a.sort_order - b.sort_order),
      }));
    },
  });
}

/* ---------------------------------------------------------------- mutasyonlar */

export function useMenuMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.categories });
    void queryClient.invalidateQueries({ queryKey: qk.products });
    void queryClient.invalidateQueries({ queryKey: qk.optionGroups });
  };

  const saveCategory = useMutation({
    mutationFn: async (input: Partial<Category> & { name: string }) => {
      if (input.id) {
        const { error } = await supabase.from('categories').update(input).eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('categories').insert(input);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });

  const saveProduct = useMutation({
    mutationFn: async ({
      product,
      optionGroupIds,
    }: {
      product: Partial<Product> & { name: string; category_id: string; price_kurus: number };
      optionGroupIds?: string[];
    }) => {
      let productId = product.id;

      if (productId) {
        const { error } = await supabase.from('products').update(product).eq('id', productId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('products').insert(product).select('id').single();
        if (error) throw error;
        productId = (data as { id: string }).id;
      }

      // Opsiyon grubu baglantilarini senkronla (verildiyse)
      if (optionGroupIds && productId) {
        await supabase.from('product_option_groups').delete().eq('product_id', productId);
        if (optionGroupIds.length > 0) {
          const { error } = await supabase.from('product_option_groups').insert(
            optionGroupIds.map((gid, index) => ({
              product_id: productId,
              option_group_id: gid,
              sort_order: index,
            })),
          );
          if (error) throw error;
        }
      }
    },
    onSuccess: invalidate,
  });

  /** "Bugun tukendi" hizli anahtari */
  const setAvailability = useMutation({
    mutationFn: async ({ id, isAvailable }: { id: string; isAvailable: boolean }) => {
      const { error } = await supabase
        .from('products')
        .update({ is_available: isAvailable })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { saveCategory, saveProduct, setAvailability, invalidate };
}
