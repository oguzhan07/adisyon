/**
 * Veritabani satir tipleri.
 *
 * Ideal olan `npm run db:types` ile Supabase'den uretmek; sema henuz canliya
 * uygulanmadigi icin ihtiyac duyulan tablolarin tiplerini elle tanimliyoruz.
 * Sema uygulaninca `database.types.ts` uretilip bunlarin yerine gecebilir.
 */

import type { BaseUnit, MovementType, OrderItemStatus, OrderStatus, PaymentMethod } from '@adisyon/shared';

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_kurus: number;
  image_path: string | null;
  is_available: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  selection_type: 'single' | 'multi';
  is_required: boolean;
  min_select: number;
  max_select: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface OptionRow {
  id: string;
  option_group_id: string;
  name: string;
  price_delta_kurus: number;
  is_available: boolean;
  sort_order: number;
}

export interface Area {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface RestaurantTable {
  id: string;
  area_id: string;
  name: string;
  seats: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface Order {
  id: string;
  table_id: string | null;
  business_day: string;
  order_no: number;
  status: OrderStatus;
  guest_count: number | null;
  note: string | null;
  discount_kurus: number;
  discount_reason: string | null;
  opened_at: string;
  closed_at: string | null;
  merged_into_order_id: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price_kurus_snapshot: number;
  quantity: number;
  note: string | null;
  status: OrderItemStatus;
  kitchen_printed_at: string | null;
  cancelled_reason: string | null;
  created_at: string;
}

export interface OrderItemOption {
  id: string;
  order_item_id: string;
  option_id: string;
  option_name_snapshot: string;
  price_delta_kurus_snapshot: number;
}

export interface Payment {
  id: string;
  order_id: string;
  method: PaymentMethod;
  amount_kurus: number;
  note: string | null;
  paid_at: string;
}

/** v_order_totals view satiri */
export interface OrderTotals {
  order_id: string;
  business_day: string;
  order_no: number;
  status: OrderStatus;
  table_id: string | null;
  subtotal_kurus: number;
  discount_kurus: number;
  total_kurus: number;
  paid_kurus: number;
  remaining_kurus: number;
  item_count: number;
  opened_at: string;
  closed_at: string | null;
}

export interface Ingredient {
  id: string;
  name: string;
  base_unit: BaseUnit;
  min_stock: number | null;
  avg_cost_kurus: number;
  note: string | null;
  is_active: boolean;
}

/** v_ingredient_stock view satiri */
export interface IngredientStock {
  ingredient_id: string;
  name: string;
  base_unit: BaseUnit;
  min_stock: number | null;
  avg_cost_kurus: number;
  is_active: boolean;
  stock_qty: number;
  is_below_min: boolean;
  stock_value_kurus: number;
}

export interface StockMovement {
  id: string;
  ingredient_id: string;
  movement_type: MovementType;
  quantity: number;
  unit_cost_kurus: number | null;
  source_type: string | null;
  source_id: string | null;
  note: string | null;
  created_at: string;
}

export interface ProductIngredient {
  product_id: string;
  ingredient_id: string;
  quantity: number;
}

export interface OptionIngredient {
  option_id: string;
  ingredient_id: string;
  quantity: number;
}

export interface StockCount {
  id: string;
  status: 'draft' | 'applied';
  note: string | null;
  counted_at: string;
  applied_at: string | null;
}

export interface StockCountItem {
  id: string;
  count_id: string;
  ingredient_id: string;
  theoretical_quantity: number;
  counted_quantity: number | null;
  variance: number | null;
}

/** v_product_cost view satiri */
export interface ProductCost {
  product_id: string;
  name: string;
  price_kurus: number;
  cost_kurus: number;
  gross_profit_kurus: number;
  margin_percent: number | null;
  has_recipe: boolean;
}
