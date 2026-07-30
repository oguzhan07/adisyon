-- ============================================================================
-- 0003 · Bolgeler, masalar ve adisyonlar
-- ============================================================================

create table areas (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,               -- Salon / Bahce / Ust Kat
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger areas_updated_at
  before update on areas
  for each row execute function set_updated_at();

create table restaurant_tables (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references areas (id) on delete restrict,
  name        text not null,               -- "1", "2", "Bahce 3"
  seats       int check (seats is null or seats > 0),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (area_id, name)
);

create trigger restaurant_tables_updated_at
  before update on restaurant_tables
  for each row execute function set_updated_at();

create index restaurant_tables_area_idx on restaurant_tables (area_id, sort_order, name);

-- ===================================================================== ADISYON

/**
 * Adisyon (acik hesap).
 *
 * status akisi:
 *   open      -> masada acik hesap
 *   closed    -> odendi, satis kesinlesti (stok dusumu bu anda tetiklenir)
 *   cancelled -> hic satisa donusmedi (yanlis acilmis masa)
 *   merged    -> baska bir adisyonla birlestirildi; kalemleri tasindi.
 *                Kayit SILINMEZ, merged_into_order_id ile izi kalir.
 */
create table orders (
  id                    uuid primary key default gen_random_uuid(),
  table_id              uuid references restaurant_tables (id) on delete restrict,

  -- Is gunu icinde artan siparis numarasi (fiste ve raporda gorunur)
  business_day          date not null,
  order_no              int not null,

  status                text not null default 'open'
                          check (status in ('open', 'closed', 'cancelled', 'merged')),

  guest_count           int check (guest_count is null or guest_count > 0),
  note                  text,

  -- Ikram / indirim. Sebep zorunlu tutulur ki rapor anlamli olsun.
  discount_kurus        integer not null default 0 check (discount_kurus >= 0),
  discount_reason       text,

  opened_at             timestamptz not null default now(),
  closed_at             timestamptz,
  merged_into_order_id  uuid references orders (id) on delete restrict,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (business_day, order_no),

  -- Kapali adisyonun kapanis zamani olmak zorunda: rapor bu alana dayaniyor
  constraint orders_closed_needs_time
    check (status <> 'closed' or closed_at is not null),
  constraint orders_merged_needs_target
    check (status <> 'merged' or merged_into_order_id is not null),
  constraint orders_discount_needs_reason
    check (discount_kurus = 0 or discount_reason is not null)
);

create trigger orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

create index orders_open_idx on orders (status) where status = 'open';
create index orders_table_open_idx on orders (table_id) where status = 'open';
create index orders_business_day_idx on orders (business_day desc, order_no);
create index orders_closed_at_idx on orders (closed_at) where status = 'closed';

/**
 * Is gunu ve siparis numarasini otomatik atar.
 *
 * Advisory kilit, ayni is gunune ait iki adisyonun ayni numarayi almasini
 * engeller. Tek kasada catisma pratikte olmaz ama ikinci bir pencere acildigi
 * anda unique ihlali kullaniciya hata olarak doner - kilit bunu onler.
 */
create or replace function trg_orders_assign_no()
returns trigger
language plpgsql
as $$
declare
  v_start_hour int;
begin
  v_start_hour := current_business_day_start_hour();
  new.business_day := business_day(coalesce(new.opened_at, now()), v_start_hour);

  if new.order_no is null or new.order_no = 0 then
    perform pg_advisory_xact_lock(hashtext('orders_no_' || new.business_day::text));

    select coalesce(max(order_no), 0) + 1
      into new.order_no
      from orders
     where business_day = new.business_day;
  end if;

  return new;
end;
$$;

-- order_no NOT NULL oldugu icin trigger'a gecici bir varsayilan gerekiyor
alter table orders alter column order_no set default 0;
alter table orders alter column business_day set default current_date;

create trigger orders_assign_no
  before insert on orders
  for each row execute function trg_orders_assign_no();

-- ------------------------------------------------------------ adisyon kalemleri

/**
 * Adisyon satiri.
 *
 * ANLIK GORUNTU (SNAPSHOT) KURALI: urun adi ve birim fiyati siparis anindaki
 * haliyle bu satira yazilir. Patron yarin fiyati zamlarsa dunun adisyonu ve
 * raporu degismez. Raporlar DAIMA snapshot alanlarini kullanir.
 *
 * unit_price_kurus_snapshot yalnizca URUNUN taban fiyatidir; varyant/ekstra
 * farklari order_item_options satirlarinda ayri tutulur (bkz. v_order_item_totals).
 */
create table order_items (
  id                        uuid primary key default gen_random_uuid(),
  order_id                  uuid not null references orders (id) on delete cascade,

  -- RESTRICT: satilmis urun silinemez, gecmis korunur
  product_id                uuid not null references products (id) on delete restrict,

  product_name_snapshot     text not null,
  unit_price_kurus_snapshot integer not null check (unit_price_kurus_snapshot >= 0),

  quantity                  int not null default 1 check (quantity > 0),
  note                      text,                    -- "sogansiz"

  status                    text not null default 'new'
                              check (status in ('new', 'preparing', 'ready', 'cancelled')),

  kitchen_printed_at        timestamptz,
  cancelled_reason          text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Iptalin sebebi zorunlu: stok farki tartismasinda tek dayanak bu
  constraint order_items_cancel_needs_reason
    check (status <> 'cancelled' or cancelled_reason is not null)
);

create trigger order_items_updated_at
  before update on order_items
  for each row execute function set_updated_at();

create index order_items_order_idx on order_items (order_id);
create index order_items_kitchen_idx on order_items (status)
  where status in ('new', 'preparing');

/** Secili varyant/ekstralar - fiyat farki da snapshot'lanir */
create table order_item_options (
  id                          uuid primary key default gen_random_uuid(),
  order_item_id               uuid not null references order_items (id) on delete cascade,

  -- RESTRICT: siparis edilmis opsiyon silinemez (recete ve gecmis icin gerekli)
  option_id                   uuid not null references options (id) on delete restrict,

  option_name_snapshot        text not null,
  price_delta_kurus_snapshot  integer not null default 0,

  created_at                  timestamptz not null default now(),

  unique (order_item_id, option_id)
);

create index order_item_options_item_idx on order_item_options (order_item_id);

-- ------------------------------------------------------------------ toplamlar

/**
 * Satir bazinda gercek birim fiyat ve satir toplami.
 * Toplamlar TABLODA TUTULMAZ, hesaplanir: boylece kalem eklendiginde
 * guncellenmeyi unutulan bir toplam kolonu yuzunden tutarsizlik olusamaz.
 * Iptal edilmis satirlar haric tutulur.
 */
create view v_order_item_totals as
  select
    oi.id                                                as order_item_id,
    oi.order_id,
    oi.quantity,
    oi.unit_price_kurus_snapshot + coalesce(opt.delta_sum, 0) as unit_price_kurus,
    (oi.unit_price_kurus_snapshot + coalesce(opt.delta_sum, 0)) * oi.quantity
                                                         as line_total_kurus
  from order_items oi
  left join lateral (
    select sum(o.price_delta_kurus_snapshot) as delta_sum
    from order_item_options o
    where o.order_item_id = oi.id
  ) opt on true
  where oi.status <> 'cancelled';

-- Adisyon basi toplamlar (v_order_totals) odeme tablosuna dayandigi icin
-- bir sonraki migration'da tanimlanir (20260730100300_payments.sql).
