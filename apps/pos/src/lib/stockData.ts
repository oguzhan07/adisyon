import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PurchaseLineInput, StockReportRow } from '@adisyon/shared';
import { supabase } from './supabase';
import { qk } from './queryKeys';
import type {
  Ingredient,
  IngredientStock,
  OptionIngredient,
  ProductIngredient,
  StockCount,
  StockCountItem,
} from './dbTypes';

/* ----------------------------------------------------------------- malzemeler */

export function useIngredients() {
  return useQuery({
    queryKey: qk.ingredients,
    queryFn: async (): Promise<Ingredient[]> => {
      const { data, error } = await supabase
        .from('ingredients')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Ingredient[];
    },
  });
}

export function useIngredientStock() {
  return useQuery({
    queryKey: qk.ingredientStock,
    queryFn: async (): Promise<IngredientStock[]> => {
      const { data, error } = await supabase
        .from('v_ingredient_stock')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as IngredientStock[];
    },
  });
}

/* ------------------------------------------------------------------ receteler */

export function useRecipe(productId: string | null) {
  return useQuery({
    queryKey: productId ? qk.recipe(productId) : ['recipe', 'none'],
    enabled: !!productId,
    queryFn: async (): Promise<ProductIngredient[]> => {
      const { data, error } = await supabase
        .from('product_ingredients')
        .select('*')
        .eq('product_id', productId!);
      if (error) throw error;
      return (data ?? []) as ProductIngredient[];
    },
  });
}

export function useOptionRecipe(optionId: string | null) {
  return useQuery({
    queryKey: optionId ? qk.optionRecipe(optionId) : ['option-recipe', 'none'],
    enabled: !!optionId,
    queryFn: async (): Promise<OptionIngredient[]> => {
      const { data, error } = await supabase
        .from('option_ingredients')
        .select('*')
        .eq('option_id', optionId!);
      if (error) throw error;
      return (data ?? []) as OptionIngredient[];
    },
  });
}

/* --------------------------------------------------------------- aktif sayim */

export interface ActiveCount {
  count: StockCount;
  items: (StockCountItem & { ingredient_name: string; base_unit: string })[];
}

export function useActiveCount() {
  return useQuery({
    queryKey: qk.activeCount,
    queryFn: async (): Promise<ActiveCount | null> => {
      const { data: counts, error } = await supabase
        .from('stock_counts')
        .select('*')
        .eq('status', 'draft')
        .order('counted_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const count = (counts ?? [])[0] as StockCount | undefined;
      if (!count) return null;

      const { data: items, error: itemsError } = await supabase
        .from('stock_count_items')
        .select('*, ingredients(name, base_unit)')
        .eq('count_id', count.id);
      if (itemsError) throw itemsError;

      type Raw = StockCountItem & { ingredients: { name: string; base_unit: string } | null };
      const mapped = ((items ?? []) as Raw[])
        .map((row) => ({
          ...row,
          ingredient_name: row.ingredients?.name ?? '',
          base_unit: row.ingredients?.base_unit ?? '',
        }))
        .sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name, 'tr'));

      return { count, items: mapped };
    },
  });
}

/* ---------------------------------------------------------------- stok raporu */

export function useStockReport(fromIso: string, toIso: string, enabled = true) {
  return useQuery({
    queryKey: qk.stockReport(fromIso, toIso),
    enabled,
    queryFn: async (): Promise<StockReportRow[]> => {
      const { data, error } = await supabase.rpc('rpc_stock_report', {
        p_from: fromIso,
        p_to: toIso,
      });
      if (error) throw error;
      return (data ?? []) as StockReportRow[];
    },
  });
}

/* ---------------------------------------------------------------- mutasyonlar */

export function useStockMutations() {
  const queryClient = useQueryClient();

  const refreshStock = () => {
    void queryClient.invalidateQueries({ queryKey: qk.ingredientStock });
    void queryClient.invalidateQueries({ queryKey: qk.ingredients });
  };

  const saveIngredient = useMutation({
    mutationFn: async (input: Partial<Ingredient> & { name: string; base_unit: string }) => {
      if (input.id) {
        const { error } = await supabase.from('ingredients').update(input).eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ingredients').insert(input);
        if (error) throw error;
      }
    },
    onSuccess: refreshStock,
  });

  /** Mal kabul: baslik + satirlar. Trigger stok girisi ve maliyeti gunceller. */
  const recordPurchase = useMutation({
    mutationFn: async ({
      supplierName,
      invoiceNo,
      lines,
    }: {
      supplierName: string | null;
      invoiceNo: string | null;
      lines: PurchaseLineInput[];
    }) => {
      const { data, error } = await supabase
        .from('stock_purchases')
        .insert({ supplier_name: supplierName, invoice_no: invoiceNo })
        .select('id')
        .single();
      if (error) throw error;
      const purchaseId = (data as { id: string }).id;

      const { error: lineError } = await supabase.from('stock_purchase_items').insert(
        lines.map((l) => ({
          purchase_id: purchaseId,
          ingredient_id: l.ingredient_id,
          purchase_unit: l.purchase_unit,
          purchase_quantity: l.purchase_quantity,
          unit_cost_kurus: l.unit_cost_kurus,
        })),
      );
      if (lineError) throw lineError;
    },
    onSuccess: () => {
      refreshStock();
      void queryClient.invalidateQueries({ queryKey: qk.purchases });
    },
  });

  const recordWaste = useMutation({
    mutationFn: async ({
      ingredientId,
      quantity,
      reason,
    }: {
      ingredientId: string;
      quantity: number;
      reason: string;
    }) => {
      const { error } = await supabase
        .from('stock_waste')
        .insert({ ingredient_id: ingredientId, quantity, reason });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshStock();
      void queryClient.invalidateQueries({ queryKey: qk.waste });
    },
  });

  const saveRecipe = useMutation({
    mutationFn: async ({
      productId,
      lines,
    }: {
      productId: string;
      lines: { ingredient_id: string; quantity: number }[];
    }) => {
      await supabase.from('product_ingredients').delete().eq('product_id', productId);
      if (lines.length > 0) {
        const { error } = await supabase
          .from('product_ingredients')
          .insert(lines.map((l) => ({ product_id: productId, ...l })));
        if (error) throw error;
      }
    },
    onSuccess: (_r, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.recipe(vars.productId) });
      void queryClient.invalidateQueries({ queryKey: qk.productCosts });
    },
  });

  const saveOptionRecipe = useMutation({
    mutationFn: async ({
      optionId,
      lines,
    }: {
      optionId: string;
      lines: { ingredient_id: string; quantity: number }[];
    }) => {
      await supabase.from('option_ingredients').delete().eq('option_id', optionId);
      if (lines.length > 0) {
        const { error } = await supabase
          .from('option_ingredients')
          .insert(lines.map((l) => ({ option_id: optionId, ...l })));
        if (error) throw error;
      }
    },
    onSuccess: (_r, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.optionRecipe(vars.optionId) });
    },
  });

  /* ------ sayim ------ */

  const startCount = useMutation({
    mutationFn: async (note: string | null): Promise<string> => {
      const { data, error } = await supabase.rpc('rpc_start_stock_count', { p_note: note });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.activeCount }),
  });

  const setCountValue = useMutation({
    mutationFn: async ({
      countItemId,
      countedQuantity,
    }: {
      countItemId: string;
      countedQuantity: number | null;
    }) => {
      const { error } = await supabase
        .from('stock_count_items')
        .update({ counted_quantity: countedQuantity })
        .eq('id', countItemId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.activeCount }),
  });

  const applyCount = useMutation({
    mutationFn: async (countId: string) => {
      const { error } = await supabase.rpc('rpc_apply_stock_count', { p_count_id: countId });
      if (error) throw error;
    },
    onSuccess: () => {
      refreshStock();
      void queryClient.invalidateQueries({ queryKey: qk.activeCount });
    },
  });

  const cancelCount = useMutation({
    mutationFn: async (countId: string) => {
      // Taslak sayimi tamamen siler (henuz stok hareketi yazilmadi)
      const { error } = await supabase.from('stock_counts').delete().eq('id', countId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.activeCount }),
  });

  return {
    saveIngredient,
    recordPurchase,
    recordWaste,
    saveRecipe,
    saveOptionRecipe,
    startCount,
    setCountValue,
    applyCount,
    cancelCount,
  };
}
