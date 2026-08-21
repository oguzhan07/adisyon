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

/**
 * Iyimser (optimistic) guncellemede toplamlari yerel olarak yeniden hesaplar.
 *
 * Gercek toplam v_order_totals view'inda hesaplaniyor; burada yalnizca ekranin
 * ANLIK dogru gorunmesi icin ayni aritmetigi uyguluyoruz. Sunucu cevabi gelince
 * (onSettled -> invalidate) gercek degerler zaten yerine oturuyor.
 */
function recalcTotals(
  totals: OrderTotals,
  amountDeltaKurus: number,
  itemCountDelta: number,
): OrderTotals {
  const subtotal = Math.max(totals.subtotal_kurus + amountDeltaKurus, 0);
  const total = Math.max(subtotal - totals.discount_kurus, 0);
  return {
    ...totals,
    subtotal_kurus: subtotal,
    total_kurus: total,
    remaining_kurus: Math.max(total - totals.paid_kurus, 0),
    item_count: Math.max(totals.item_count + itemCountDelta, 0),
  };
}

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
    /**
     * ANLIK GERI BILDIRIM: Urun, veritabani cevabini BEKLEMEDEN adisyon
     * listesinde belirir. Kasiyer yogun serviste "tiklamalar gecikiyor"
     * hissetmez. Istek basarisiz olursa onceki durum geri yuklenir ve hata
     * gosterilir (onError).
     */
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: qk.order(vars.orderId) });
      const previous = queryClient.getQueryData<OrderDetail>(qk.order(vars.orderId));

      if (previous) {
        const tempId = `temp-${Date.now()}`;
        const optimisticItem: OrderItemFull = {
          id: tempId,
          order_id: vars.orderId,
          product_id: vars.productId,
          product_name_snapshot: vars.productName,
          unit_price_kurus_snapshot: vars.unitPriceKurus,
          quantity: vars.quantity,
          note: vars.note,
          status: 'new',
          kitchen_printed_at: null,
          cancelled_reason: null,
          created_at: new Date().toISOString(),
          options: vars.selected.map((o) => ({
            id: `temp-opt-${o.option_id}`,
            order_item_id: tempId,
            option_id: o.option_id,
            option_name_snapshot: o.name,
            price_delta_kurus_snapshot: o.price_delta_kurus,
          })),
        };

        const lineTotal =
          (vars.unitPriceKurus + vars.selected.reduce((s, o) => s + o.price_delta_kurus, 0)) *
          vars.quantity;

        queryClient.setQueryData<OrderDetail>(qk.order(vars.orderId), {
          ...previous,
          items: [...previous.items, optimisticItem],
          totals: recalcTotals(previous.totals, lineTotal, vars.quantity),
        });
      }

      return { previous };
    },
    onError: (_err, vars, context) => {
      const ctx = context as { previous?: OrderDetail } | undefined;
      if (ctx?.previous) queryClient.setQueryData(qk.order(vars.orderId), ctx.previous);
    },
    onSettled: (_id, _err, vars) => refreshOrder(vars.orderId),
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
    // Adet degisimi de anlik gorunur; hata olursa geri alinir
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: qk.order(vars.orderId) });
      const previous = queryClient.getQueryData<OrderDetail>(qk.order(vars.orderId));

      if (previous) {
        const item = previous.items.find((i) => i.id === vars.itemId);
        if (item) {
          const unit =
            item.unit_price_kurus_snapshot +
            item.options.reduce((s, o) => s + o.price_delta_kurus_snapshot, 0);
          const delta = (vars.quantity - item.quantity) * unit;

          queryClient.setQueryData<OrderDetail>(qk.order(vars.orderId), {
            ...previous,
            items: previous.items.map((i) =>
              i.id === vars.itemId ? { ...i, quantity: vars.quantity } : i,
            ),
            totals: recalcTotals(previous.totals, delta, vars.quantity - item.quantity),
          });
        }
      }
      return { previous };
    },
    onError: (_err, vars, context) => {
      const ctx = context as { previous?: OrderDetail } | undefined;
      if (ctx?.previous) queryClient.setQueryData(qk.order(vars.orderId), ctx.previous);
    },
    onSettled: (_r, _err, vars) => refreshOrder(vars.orderId),
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
    // Iptal de anlik: satir listeden hemen dusar
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: qk.order(vars.orderId) });
      const previous = queryClient.getQueryData<OrderDetail>(qk.order(vars.orderId));

      if (previous) {
        const item = previous.items.find((i) => i.id === vars.itemId);
        if (item) {
          const unit =
            item.unit_price_kurus_snapshot +
            item.options.reduce((s, o) => s + o.price_delta_kurus_snapshot, 0);

          queryClient.setQueryData<OrderDetail>(qk.order(vars.orderId), {
            ...previous,
            items: previous.items.map((i) =>
              i.id === vars.itemId
                ? { ...i, status: 'cancelled' as const, cancelled_reason: vars.reason }
                : i,
            ),
            totals: recalcTotals(previous.totals, -unit * item.quantity, -item.quantity),
          });
        }
      }
      return { previous };
    },
    onError: (_err, vars, context) => {
      const ctx = context as { previous?: OrderDetail } | undefined;
      if (ctx?.previous) queryClient.setQueryData(qk.order(vars.orderId), ctx.previous);
    },
    onSettled: (_r, _err, vars) => refreshOrder(vars.orderId),
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
