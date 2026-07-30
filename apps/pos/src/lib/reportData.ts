import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { qk } from './queryKeys';
import type { ProductCost } from './dbTypes';

export interface DailySummary {
  business_day: string;
  order_count: number;
  gross_kurus: number;
  discount_kurus: number;
  net_kurus: number;
  cash_kurus: number;
  card_kurus: number;
  vat_kurus: number;
  avg_basket_kurus: number;
  item_count: number;
  cancelled_item_count: number;
  cancelled_item_kurus: number;
}

export interface ProductSalesRow {
  product_id: string;
  product_name: string;
  category_name: string | null;
  quantity_sold: number;
  revenue_kurus: number;
  cost_kurus: number;
  gross_profit_kurus: number;
}

export interface HourlyLoadRow {
  hour_of_day: number;
  order_count: number;
  revenue_kurus: number;
  item_count: number;
}

/** Gun araligi 'YYYY-MM-DD' is gunu bazinda */
export function useDailySummary(fromDay: string, toDay: string) {
  return useQuery({
    queryKey: qk.dailySummary(fromDay, toDay),
    queryFn: async (): Promise<DailySummary[]> => {
      const { data, error } = await supabase.rpc('rpc_daily_summary', {
        p_from_day: fromDay,
        p_to_day: toDay,
      });
      if (error) throw error;
      return (data ?? []) as DailySummary[];
    },
  });
}

export function useProductSales(fromDay: string, toDay: string) {
  return useQuery({
    queryKey: qk.productSales(fromDay, toDay),
    queryFn: async (): Promise<ProductSalesRow[]> => {
      const { data, error } = await supabase.rpc('rpc_product_sales', {
        p_from_day: fromDay,
        p_to_day: toDay,
      });
      if (error) throw error;
      return (data ?? []) as ProductSalesRow[];
    },
  });
}

export function useHourlyLoad(fromDay: string, toDay: string) {
  return useQuery({
    queryKey: qk.hourlyLoad(fromDay, toDay),
    queryFn: async (): Promise<HourlyLoadRow[]> => {
      const { data, error } = await supabase.rpc('rpc_hourly_load', {
        p_from_day: fromDay,
        p_to_day: toDay,
      });
      if (error) throw error;
      return (data ?? []) as HourlyLoadRow[];
    },
  });
}

export function useProductCosts() {
  return useQuery({
    queryKey: qk.productCosts,
    queryFn: async (): Promise<ProductCost[]> => {
      const { data, error } = await supabase.from('v_product_cost').select('*').order('name');
      if (error) throw error;
      return (data ?? []) as ProductCost[];
    },
  });
}
