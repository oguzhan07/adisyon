import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SelectedOption } from '@adisyon/shared';
import { supabase } from './supabase';
import { qk } from './queryKeys';
import type {
  Area,
  Order,
  OrderItem,
  OrderItemOption,
  OrderTotals,
  Payment,
  RestaurantTable,
} from './dbTypes';

/* --------------------------------------------------------- bolgeler / masalar */

export function useAreas() {
  return useQuery({
    queryKey: qk.areas,
    queryFn: async (): Promise<Area[]> => {
      const { data, error } = await supabase
        .from('areas')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as Area[];
    },
  });
}

export function useTables() {
  return useQuery({
    queryKey: qk.tables,
    queryFn: async (): Promise<RestaurantTable[]> => {
      const { data, error } = await supabase
        .from('restaurant_tables')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as RestaurantTable[];
    },
  });
}

/**
 * Acik adisyonlarin ozeti (masa plani icin). v_order_totals'tan besleniyor;
 * her masanin uzerinde tutar ve sure gostermek icin bu yeterli.
 */
export function useOpenOrders() {
  return useQuery({
    queryKey: qk.openOrders,
    queryFn: async (): Promise<OrderTotals[]> => {
      const { data, error } = await supabase
        .from('v_order_totals')
        .select('*')
        .eq('status', 'open');
      if (error) throw error;
      return (data ?? []) as OrderTotals[];
    },
    // Masa plani birden fazla cihazdan degil ama yine de taze kalsin
    refetchInterval: 15_000,
  });
}

/* ------------------------------------------------------- ocak / siparis takip */

export interface KitchenItem {
  id: string;
  order_id: string;
  product_name_snapshot: string;
  quantity: number;
  note: string | null;
  status: 'new' | 'preparing' | 'ready';
  created_at: string;
  order_no: number;
  table_id: string | null;
  options: { option_name_snapshot: string }[];
}

/**
 * Ocak ekrani: bekleyen (new/preparing/ready) kalemler. Hazir/iptal disi
 * kalemler ocakta gorunmez. Sik yenilenir cunku ocaktaki kisi anlik takip eder.
 */
export function useKitchenItems() {
  return useQuery({
    queryKey: qk.kitchen,
    queryFn: async (): Promise<KitchenItem[]> => {
      const { data, error } = await supabase
        .from('order_items')
        .select(
          'id, order_id, product_name_snapshot, quantity, note, status, created_at, ' +
            'order_item_options(option_name_snapshot), orders!inner(order_no, table_id, status)',
        )
        .in('status', ['new', 'preparing', 'ready'])
        .order('created_at');
      if (error) throw error;

      type Raw = {
        id: string;
        order_id: string;
        product_name_snapshot: string;
        quantity: number;
        note: string | null;
        status: 'new' | 'preparing' | 'ready';
        created_at: string;
        order_item_options: { option_name_snapshot: string }[] | null;
        orders: { order_no: number; table_id: string | null; status: string } | null;
      };

      return ((data ?? []) as unknown as Raw[])
        // Yalnizca acik adisyonlarin kalemleri (kapali adisyonda ocak isi bitmistir)
        .filter((row) => row.orders?.status === 'open')
        .map((row) => ({
          id: row.id,
          order_id: row.order_id,
          product_name_snapshot: row.product_name_snapshot,
          quantity: row.quantity,
          note: row.note,
          status: row.status,
          created_at: row.created_at,
          order_no: row.orders?.order_no ?? 0,
          table_id: row.orders?.table_id ?? null,
          options: row.order_item_options ?? [],
        }));
    },
    refetchInterval: 10_000,
  });
}

/* ------------------------------------------------------------ adisyon detayi */

export interface OrderItemFull extends OrderItem {
  options: OrderItemOption[];
}

export interface OrderDetail {
  order: Order;
  items: OrderItemFull[];
  totals: OrderTotals;
  payments: Payment[];
}

export function useOrderDetail(orderId: string | null) {
  return useQuery({
    queryKey: orderId ? qk.order(orderId) : ['order', 'none'],
    enabled: !!orderId,
    queryFn: async (): Promise<OrderDetail> => {
      if (!orderId) throw new Error('Adisyon seçilmedi');

      const [orderRes, itemsRes, totalsRes, paymentsRes] = await Promise.all([
        supabase.from('orders').select('*').eq('id', orderId).single(),
        supabase
          .from('order_items')
          .select('*, order_item_options(*)')
          .eq('order_id', orderId)
          .order('created_at'),
        supabase.from('v_order_totals').select('*').eq('order_id', orderId).single(),
        supabase.from('payments').select('*').eq('order_id', orderId).order('paid_at'),
      ]);

      if (orderRes.error) throw orderRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (totalsRes.error) throw totalsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      type RawItem = OrderItem & { order_item_options: OrderItemOption[] | null };
      const items = ((itemsRes.data ?? []) as RawItem[]).map((item) => ({
        ...item,
        options: item.order_item_options ?? [],
      }));

      return {
        order: orderRes.data as Order,
        items,
        totals: totalsRes.data as OrderTotals,
        payments: (paymentsRes.data ?? []) as Payment[],
      };
    },
  });
}

/* ------------------------------------------------------------------ islemler */

export function useOrderMutations() {
  const queryClient = useQueryClient();

  const refreshOrder = (orderId: string) => {
    void queryClient.invalidateQueries({ queryKey: qk.order(orderId) });
    void queryClient.invalidateQueries({ queryKey: qk.openOrders });
    void queryClient.invalidateQueries({ queryKey: qk.kitchen });
  };

  /** Masaya yeni adisyon acar (order_no trigger tarafindan atanir) */
  const openOrder = useMutation({
    mutationFn: async ({
      tableId,
      guestCount,
    }: {
      tableId: string;
      guestCount?: number | null;
    }): Promise<string> => {
      const { data, error } = await supabase
        .from('orders')
        .insert({ table_id: tableId, guest_count: guestCount ?? null })
        .select('id')
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.openOrders });
    },
  });

  /** Adisyona kalem ekler (urun + secili varyant/ekstralar, snapshot'lanarak) */
  const addItem = useMutation({
    mutationFn: async ({
      orderId,
      productId,
      productName,
      unitPriceKurus,
      quantity,
      note,
      selected,
    }: {
      orderId: string;
      productId: string;
      productName: string;
      unitPriceKurus: number;
      quantity: number;
      note: string | null;
      selected: SelectedOption[];
    }) => {
      const { data, error } = await supabase
        .from('order_items')
        .insert({
          order_id: orderId,
          product_id: productId,
          product_name_snapshot: productName,
          unit_price_kurus_snapshot: unitPriceKurus,
          quantity,
          note,
        })
        .select('id')
        .single();
      if (error) throw error;

      const itemId = (data as { id: string }).id;

      if (selected.length > 0) {
        const { error: optError } = await supabase.from('order_item_options').insert(
          selected.map((o) => ({
            order_item_id: itemId,
            option_id: o.option_id,
            option_name_snapshot: o.name,
            price_delta_kurus_snapshot: o.price_delta_kurus,
          })),
        );
        if (optError) throw optError;
      }

      return itemId;
    },
    onSuccess: (_id, vars) => refreshOrder(vars.orderId),
  });

  const changeQuantity = useMutation({
    mutationFn: async ({
      itemId,
      quantity,
    }: {
      itemId: string;
      orderId: string;
      quantity: number;
    }) => {
      const { error } = await supabase
        .from('order_items')
        .update({ quantity })
        .eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => refreshOrder(vars.orderId),
  });

  /** Kalem iptali: SILINMEZ, status='cancelled' + sebep (denetim izi kalir) */
  const cancelItem = useMutation({
    mutationFn: async ({
      itemId,
      reason,
    }: {
      itemId: string;
      orderId: string;
      reason: string;
    }) => {
      const { error } = await supabase
        .from('order_items')
        .update({ status: 'cancelled', cancelled_reason: reason })
        .eq('id', itemId);
      if (error) throw error;

      await supabase.from('audit_log').insert({
        entity: 'order_item',
        entity_id: itemId,
        action: 'cancel',
        payload: { reason },
      });
    },
    onSuccess: (_r, vars) => refreshOrder(vars.orderId),
  });

  const setItemStatus = useMutation({
    mutationFn: async ({
      itemId,
      status,
    }: {
      itemId: string;
      orderId: string;
      status: OrderItem['status'];
    }) => {
      const { error } = await supabase.from('order_items').update({ status }).eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => refreshOrder(vars.orderId),
  });

  const markKitchenPrinted = useMutation({
    mutationFn: async ({ itemIds }: { orderId: string; itemIds: string[] }) => {
      if (itemIds.length === 0) return;
      const { error } = await supabase
        .from('order_items')
        .update({ kitchen_printed_at: new Date().toISOString() })
        .in('id', itemIds);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => refreshOrder(vars.orderId),
  });

  /** Masa notu / kisi sayisi guncelle */
  const updateOrder = useMutation({
    mutationFn: async ({
      orderId,
      patch,
    }: {
      orderId: string;
      patch: Partial<Pick<Order, 'note' | 'guest_count' | 'table_id'>>;
    }) => {
      const { error } = await supabase.from('orders').update(patch).eq('id', orderId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => refreshOrder(vars.orderId),
  });

  /** Indirim / ikram (sebep zorunlu, denetim kaydina yazilir) */
  const applyDiscount = useMutation({
    mutationFn: async ({
      orderId,
      discountKurus,
      reason,
    }: {
      orderId: string;
      discountKurus: number;
      reason: string;
    }) => {
      const { error } = await supabase
        .from('orders')
        .update({ discount_kurus: discountKurus, discount_reason: reason })
        .eq('id', orderId);
      if (error) throw error;

      await supabase.from('audit_log').insert({
        entity: 'order',
        entity_id: orderId,
        action: 'discount',
        payload: { discount_kurus: discountKurus, reason },
      });
    },
    onSuccess: (_r, vars) => refreshOrder(vars.orderId),
  });

  /** Bos/yanlis acilmis adisyonu iptal eder (satisa donusmedi, stok dusmez) */
  const cancelOrder = useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason: string }) => {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'cancelled', closed_at: new Date().toISOString() })
        .eq('id', orderId);
      if (error) throw error;

      await supabase.from('audit_log').insert({
        entity: 'order',
        entity_id: orderId,
        action: 'cancel_order',
        payload: { reason },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.openOrders });
      void queryClient.invalidateQueries({ queryKey: qk.kitchen });
    },
  });

  /** Masa tasima */
  const moveTable = useMutation({
    mutationFn: async ({ orderId, tableId }: { orderId: string; tableId: string }) => {
      const { error } = await supabase.from('orders').update({ table_id: tableId }).eq('id', orderId);
      if (error) throw error;
      await supabase.from('audit_log').insert({
        entity: 'order',
        entity_id: orderId,
        action: 'move_table',
        payload: { table_id: tableId },
      });
    },
    onSuccess: (_r, vars) => refreshOrder(vars.orderId),
  });

  /** Masa birlestirme (rpc; kaynak merged olur, kalemler hedefe tasinir) */
  const mergeOrders = useMutation({
    mutationFn: async ({
      sourceOrderId,
      targetOrderId,
    }: {
      sourceOrderId: string;
      targetOrderId: string;
    }) => {
      const { error } = await supabase.rpc('rpc_merge_orders', {
        p_source_order_id: sourceOrderId,
        p_target_order_id: targetOrderId,
      });
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      refreshOrder(vars.targetOrderId);
      refreshOrder(vars.sourceOrderId);
    },
  });

  return {
    openOrder,
    addItem,
    changeQuantity,
    cancelItem,
    setItemStatus,
    markKitchenPrinted,
    updateOrder,
    applyDiscount,
    cancelOrder,
    moveTable,
    mergeOrders,
  };
}

/* -------------------------------------------------------------------- odeme */

export function usePaymentMutations() {
  const queryClient = useQueryClient();

  const refresh = (orderId: string) => {
    void queryClient.invalidateQueries({ queryKey: qk.order(orderId) });
    void queryClient.invalidateQueries({ queryKey: qk.openOrders });
  };

  const addPayment = useMutation({
    mutationFn: async ({
      orderId,
      method,
      amountKurus,
    }: {
      orderId: string;
      method: 'cash' | 'card';
      amountKurus: number;
    }) => {
      const { error } = await supabase
        .from('payments')
        .insert({ order_id: orderId, method, amount_kurus: amountKurus });
      if (error) throw error;
    },
    onSuccess: (_r, vars) => refresh(vars.orderId),
  });

  const removePayment = useMutation({
    mutationFn: async ({ paymentId }: { paymentId: string; orderId: string }) => {
      const { error } = await supabase.from('payments').delete().eq('id', paymentId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => refresh(vars.orderId),
  });

  /** Adisyonu kapatir (rpc; kalan tutar kontrolu + stok dusumu trigger'i) */
  const closeOrder = useMutation({
    mutationFn: async ({
      orderId,
      allowUnpaid,
    }: {
      orderId: string;
      allowUnpaid?: boolean;
    }) => {
      const { error } = await supabase.rpc('rpc_close_order', {
        p_order_id: orderId,
        p_allow_unpaid: allowUnpaid ?? false,
      });
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      refresh(vars.orderId);
      void queryClient.invalidateQueries({ queryKey: qk.ingredientStock });
    },
  });

  return { addPayment, removePayment, closeOrder };
}
