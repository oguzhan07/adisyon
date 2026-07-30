-- ============================================================================
-- 0004 · Odeme ve hesap bolme + adisyon toplamlari
-- ============================================================================
-- HESAP BOLME iki sekilde calisir ve ikisi de ayni tabloya yazar:
--
--   Tutar bazli : "3'e bol" veya elle tutar -> sadece payments satirlari
--   Urun bazli  : secili kalemler ayri odenir -> payments + payment_items
--
-- Adisyon, odemeler toplami tutari karsiladiginda kapatilabilir.
-- ============================================================================

create table payments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders (id) on delete cascade,

  method        text not null check (method in ('cash', 'card')),
  amount_kurus  integer not null check (amount_kurus > 0),

  note          text,
  paid_at       timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index payments_order_idx on payments (order_id);
create index payments_paid_at_idx on payments (paid_at desc);

/**
 * Urun bazli bolmede hangi kalemin ne kadari bu odemeye dahil.
 * Tutar bazli bolmede bu tablo bos kalir - bilincli bir tasarim: kasiyer
 * "3'e bol" dediginde kalem eslestirmesiyle ugrasmak zorunda kalmasin.
 */
create table payment_items (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references payments (id) on delete cascade,
  order_item_id   uuid not null references order_items (id) on delete cascade,
  amount_kurus    integer not null check (amount_kurus > 0),

  unique (payment_id, order_item_id)
);

create index payment_items_payment_idx on payment_items (payment_id);
create index payment_items_order_item_idx on payment_items (order_item_id);

-- ------------------------------------------------------------------ toplamlar

/**
 * Adisyon basi ara toplam / indirim / toplam / odenen / kalan.
 *
 * Hicbiri tabloda tutulmaz. Kalem eklendiginde guncellenmeyi unutulan bir
 * "total" kolonu yuzunden kasanin tutmamasi en klasik POS hatasidir; view
 * bu ihtimali tamamen ortadan kaldirir.
 */
create view v_order_totals as
  select
    o.id                                                          as order_id,
    o.business_day,
    o.order_no,
    o.status,
    o.table_id,
    coalesce(t.subtotal_kurus, 0)::bigint                         as subtotal_kurus,
    o.discount_kurus,
    greatest(coalesce(t.subtotal_kurus, 0) - o.discount_kurus, 0)::bigint
                                                                  as total_kurus,
    coalesce(p.paid_kurus, 0)::bigint                             as paid_kurus,
    greatest(
      greatest(coalesce(t.subtotal_kurus, 0) - o.discount_kurus, 0)
        - coalesce(p.paid_kurus, 0),
      0
    )::bigint                                                     as remaining_kurus,
    coalesce(t.item_count, 0)::bigint                             as item_count,
    o.opened_at,
    o.closed_at
  from orders o
  left join lateral (
    select sum(v.line_total_kurus) as subtotal_kurus,
           sum(v.quantity)         as item_count
    from v_order_item_totals v
    where v.order_id = o.id
  ) t on true
  left join lateral (
    select sum(pm.amount_kurus) as paid_kurus
    from payments pm
    where pm.order_id = o.id
  ) p on true;

-- ------------------------------------------------------------ kapatma islemi

/**
 * Adisyonu kapatir.
 *
 * Kapanis tek bir noktadan gecsin diye fonksiyon olarak yazildi: kalan tutar
 * kontrolu, kapanis zamani ve stok dusum tetigi hep birlikte calisir.
 * Uygulama tarafinda "status = closed" yazip kontrolu atlamak mumkun olmasin.
 *
 * @param p_allow_unpaid true ise kalan tutar olsa da kapatir (ikram/zarar
 *        yazma durumu). Cagiran taraf bunu kullanicidan onay alarak gonderir.
 */
create or replace function rpc_close_order(
  p_order_id uuid,
  p_allow_unpaid boolean default false
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status    text;
  v_remaining bigint;
begin
  select status into v_status from orders where id = p_order_id for update;

  if v_status is null then
    raise exception 'Adisyon bulunamadi.';
  end if;

  if v_status = 'closed' then
    return; -- zaten kapali; cift kapatma sessizce yok sayilir
  end if;

  if v_status <> 'open' then
    raise exception 'Yalnizca acik adisyon kapatilabilir (mevcut durum: %).', v_status;
  end if;

  select remaining_kurus into v_remaining
    from v_order_totals where order_id = p_order_id;

  if v_remaining > 0 and not p_allow_unpaid then
    raise exception 'Adisyonda odenmemis % kurus var.', v_remaining;
  end if;

  update orders
     set status = 'closed',
         closed_at = now()
   where id = p_order_id;
end;
$$;

comment on function rpc_close_order is
  'Adisyonu kapatir; kalan tutar kontrolu yapar ve stok dusum tetigini calistirir.';

/**
 * Iki adisyonu birlestirir: kaynak adisyonun kalemleri ve odemeleri hedefe
 * tasinir, kaynak 'merged' olarak isaretlenir.
 *
 * Kaynak SILINMEZ - hangi masanin hangi masaya birlestigi raporda ve denetim
 * kaydinda izlenebilir kalir.
 */
create or replace function rpc_merge_orders(
  p_source_order_id uuid,
  p_target_order_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_source_status text;
  v_target_status text;
begin
  if p_source_order_id = p_target_order_id then
    raise exception 'Bir adisyon kendisiyle birlestirilemez.';
  end if;

  select status into v_source_status from orders where id = p_source_order_id for update;
  select status into v_target_status from orders where id = p_target_order_id for update;

  if v_source_status is distinct from 'open' or v_target_status is distinct from 'open' then
    raise exception 'Yalnizca acik adisyonlar birlestirilebilir.';
  end if;

  update order_items set order_id = p_target_order_id where order_id = p_source_order_id;
  update payments    set order_id = p_target_order_id where order_id = p_source_order_id;

  update orders
     set status = 'merged',
         merged_into_order_id = p_target_order_id,
         closed_at = now()
   where id = p_source_order_id;

  insert into audit_log (entity, entity_id, action, payload)
  values (
    'order', p_source_order_id, 'merge',
    jsonb_build_object('target_order_id', p_target_order_id)
  );
end;
$$;

comment on function rpc_merge_orders is
  'Kaynak adisyonun kalemlerini hedefe tasir; kaynagi merged olarak isaretler.';
