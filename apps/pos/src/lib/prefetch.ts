import type { QueryClient } from '@tanstack/react-query';
import { DEFAULT_PRINTER_SETTINGS } from '@adisyon/shared';
import { supabase } from './supabase';
import { qk } from './queryKeys';
import type { SettingsRow } from './settings';

/**
 * Giristen hemen sonra menu/masa/ayar verisini onbellege doldurur.
 *
 * NEDEN: Bunlar nadiren degisen ama HER ekranda gereken veriler. Onden
 * yuklenmezse kasiyer masaya her dokundugunda ekran veritabanini bekliyor ve
 * program "agir" hissettiriyor. Onbellekte hazir olunca ekran gecisleri anlik
 * oluyor; tazeleme arka planda sessizce yapiliyor.
 */
export async function prefetchCoreData(queryClient: QueryClient): Promise<void> {
  const tasks: Promise<unknown>[] = [
    queryClient.prefetchQuery({
      queryKey: [...qk.categories, false],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .eq('is_active', true)
          .order('sort_order');
        if (error) throw error;
        return data ?? [];
      },
    }),

    queryClient.prefetchQuery({
      queryKey: [...qk.products, false],
      queryFn: async () => {
        const { data, error } = await supabase
          .from('products')
          .select('*, product_option_groups(option_group_id, sort_order)')
          .eq('is_active', true)
          .order('sort_order');
        if (error) throw error;
        type Raw = { product_option_groups: { option_group_id: string; sort_order: number }[] | null };
        return (data ?? []).map((p) => ({
          ...(p as object),
          option_group_ids: ((p as Raw).product_option_groups ?? [])
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((l) => l.option_group_id),
        }));
      },
    }),

    queryClient.prefetchQuery({
      queryKey: qk.optionGroups,
      queryFn: async () => {
        const { data, error } = await supabase
          .from('option_groups')
          .select('*, options(*)')
          .eq('is_active', true)
          .order('sort_order');
        if (error) throw error;
        type Raw = { options: { sort_order: number }[] | null };
        return (data ?? []).map((g) => ({
          ...(g as object),
          options: ((g as Raw).options ?? []).sort((a, b) => a.sort_order - b.sort_order),
        }));
      },
    }),

    queryClient.prefetchQuery({
      queryKey: qk.areas,
      queryFn: async () => {
        const { data, error } = await supabase
          .from('areas')
          .select('*')
          .eq('is_active', true)
          .order('sort_order');
        if (error) throw error;
        return data ?? [];
      },
    }),

    queryClient.prefetchQuery({
      queryKey: qk.tables,
      queryFn: async () => {
        const { data, error } = await supabase
          .from('restaurant_tables')
          .select('*')
          .eq('is_active', true)
          .order('sort_order');
        if (error) throw error;
        return data ?? [];
      },
    }),

    queryClient.prefetchQuery({
      queryKey: qk.settings,
      queryFn: async () => {
        const { data, error } = await supabase
          .from('settings')
          .select(
            `shop_name, address, phone, receipt_header, receipt_footer, vat_percent,
             business_day_start_hour, stock_variance_threshold_percent, printer`,
          )
          .single();
        if (error) throw error;
        const row = data as unknown as SettingsRow;
        return { ...row, printer: { ...DEFAULT_PRINTER_SETTINGS, ...row.printer } };
      },
    }),
  ];

  // Onbellek doldurma en iyi cabadir: biri basarisiz olursa ekranlar kendi
  // sorgularini yine calistirir, uygulama calismaya devam eder.
  await Promise.allSettled(tasks);
}
