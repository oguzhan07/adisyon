-- ============================================================================
-- KOKOREÇÇİ ADİSYON SİSTEMİ · BİRLEŞİK KURULUM
-- ============================================================================
-- Bu dosya tum sema + ornek veriyi tek seferde kurar.
-- Supabase paneli > SQL Editor'a yapistirip 'Run' deyin.
-- (Migration dosyalarindan otomatik uretildi; elle duzenlemeyin.)
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>> migrations/20260730100000_core.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0001 · Cekirdek: uzantilar, yardimci fonksiyonlar, ayarlar, denetim kaydi
-- ============================================================================
--
-- TASARIM KURALLARI (tum semada gecerli):
--
--  1. PARA  -> integer, KURUS. Ondalikli para tipi kullanilmaz; kasa
--             toplamlarinda kurus kaymasi olmaz.
--  2. MIKTAR-> numeric(12,3), malzemenin TEMEL BIRIMINDE (g/ml/adet).
--  3. SILME -> Satis gecmisine dokunan kayitlar fiziksel silinmez
--             (is_active / status ile pasife alinir). order_items -> products
--             iliskisi ON DELETE RESTRICT: satilmis bir urun silinemez,
--             boylece gecmis adisyonlar ve raporlar bozulmaz.
--  4. SAAT  -> Tum tarih gruplamalari Europe/Istanbul ve is gunu baslangic
--             saatine gore yapilir (business_day fonksiyonu).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- yardimcilar

-- updated_at kolonunu otomatik guncelleyen ortak trigger fonksiyonu
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

/**
 * Bir zaman damgasinin hangi IS GUNUNE ait oldugunu dondurur.
 *
 * Yerel saate cevirip baslangic saatini cikariyoruz: dukkan 04:00'te gun
 * basliyorsa, 01:30'daki satis 21:30'a kayar ve ONCEKI gune yazilir.
 * Ham `created_at::date` kullanmak gun sonu ciroyu sessizce ikiye boler.
 */
create or replace function business_day(ts timestamptz, start_hour int)
returns date
language sql
immutable
as $$
  select ((ts at time zone 'Europe/Istanbul') - make_interval(hours => start_hour))::date;
$$;

comment on function business_day is
  'Zaman damgasini isletme gunune cevirir (Europe/Istanbul + gun baslangic saati).';

-- ------------------------------------------------------------------- ayarlar

-- Tek satirli ayar tablosu. id kolonundaki check tek satir garantisi verir.
create table settings (
  id                  boolean primary key default true check (id),

  shop_name           text    not null default 'Kokoreççi',
  address             text,
  phone               text,

  receipt_header      text,
  receipt_footer      text    default 'Afiyet olsun, tekrar bekleriz!',

  -- Fiyatlar KDV DAHIL girilir; bu oran raporda KDV ayirmak icin kullanilir.
  vat_percent         numeric(5,2) not null default 10 check (vat_percent >= 0 and vat_percent <= 100),

  -- Gece kapanislarinin dogru gune yazilmasi icin (bkz. business_day)
  business_day_start_hour int not null default 4
    check (business_day_start_hour between 0 and 23),

  -- Stok raporunda bu yuzdeyi asan fark isaretlenir
  stock_variance_threshold_percent numeric(5,2) not null default 5
    check (stock_variance_threshold_percent >= 0),

  -- Yazici yapilandirmasi (bkz. PrinterSettings, packages/shared)
  printer             jsonb   not null default jsonb_build_object(
                                'connection', 'network',
                                'host', null,
                                'port', 9100,
                                'printerName', null,
                                'charactersPerLine', 48,
                                'openCashDrawerOnClose', true,
                                'autoPrintKitchenTicket', true
                              ),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger settings_updated_at
  before update on settings
  for each row execute function set_updated_at();

insert into settings (id) values (true);

/** Ayarlardaki is gunu baslangic saatini okur (trigger ve rapor icinde kullanilir) */
create or replace function current_business_day_start_hour()
returns int
language sql
stable
as $$
  select business_day_start_hour from settings where id = true;
$$;

/** Su anin is gunu */
create or replace function today_business_day()
returns date
language sql
stable
as $$
  select business_day(now(), current_business_day_start_hour());
$$;

-- QR menunun okumasina izin verilen dukkan bilgileri.
-- settings tablosunun tamami anon'a KAPALI: yazici IP'si, esikler gibi
-- isletme ici veriler musteri tarafina sizmamali.
create view v_public_shop_info
with (security_invoker = false) as
  select shop_name, address, phone
  from settings
  where id = true;

-- ------------------------------------------------------------- denetim kaydi

/**
 * Hassas islemlerin izi. Tek kullanicili sistemde rol denetimi yok; bu tablo
 * "bu urun neden dusulmus", "bu indirim neden verilmis", "stok neden
 * duzeltilmis" sorularinin tek cevabidir. Kayitlar guncellenmez/silinmez.
 */
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  entity      text not null,          -- 'order_item' | 'order' | 'stock' ...
  entity_id   uuid,
  action      text not null,          -- 'cancel' | 'discount' | 'merge' ...
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_created_at_idx on audit_log (created_at desc);
create index audit_log_entity_idx on audit_log (entity, entity_id);

-- >>>>>>>>>>>>>>>>>>>> migrations/20260730100100_menu.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0002 · Menu: kategoriler, urunler, varyant/ekstra gruplari
-- ============================================================================
-- Bu tablolar QR menu sitesinin de okudugu tek kaynaktir. Patron kasadan
-- fiyati degistirdiginde musterinin telefonda gordugu fiyat da degisir.
-- ============================================================================

create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger categories_updated_at
  before update on categories
  for each row execute function set_updated_at();

create index categories_sort_idx on categories (sort_order, name);

-- ------------------------------------------------------------------- urunler

create table products (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references categories (id) on delete restrict,
  name          text not null,
  description   text,

  -- KDV DAHIL satis fiyati, kurus
  price_kurus   integer not null check (price_kurus >= 0),

  -- Supabase Storage yolu ('product-images/xxx.webp')
  image_path    text,

  -- "Bugun tukendi" isareti. Urun silinmez, sadece satilamaz hale gelir:
  -- QR menude soluk gorunur, kasada secilemez.
  is_available  boolean not null default true,

  -- Menuden tamamen kaldirma (gecmis adisyonlar korunur)
  is_active     boolean not null default true,

  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger products_updated_at
  before update on products
  for each row execute function set_updated_at();

create index products_category_idx on products (category_id, sort_order, name);
create index products_active_idx on products (is_active) where is_active;

-- -------------------------------------------------- varyant / ekstra gruplari

/**
 * Opsiyon grubu: "Acilik" (tek secim), "Ekstralar" (cok secim),
 * "Porsiyon" (tek secim). Gruplar urunlerden bagimsiz tanimlanir ve birden
 * fazla urunde yeniden kullanilir - "Acilik" grubunu her urun icin bastan
 * yazmak zorunda kalmayiz.
 */
create table option_groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  selection_type  text not null default 'single'
                    check (selection_type in ('single', 'multi')),
  is_required     boolean not null default false,
  min_select      int not null default 0 check (min_select >= 0),
  max_select      int check (max_select is null or max_select >= 1),
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Tek secimli grupta ust sinir 1'den buyuk olamaz
  constraint option_groups_single_max
    check (selection_type <> 'single' or max_select is null or max_select = 1),
  constraint option_groups_min_le_max
    check (max_select is null or min_select <= max_select)
);

create trigger option_groups_updated_at
  before update on option_groups
  for each row execute function set_updated_at();

create table options (
  id                uuid primary key default gen_random_uuid(),
  option_group_id   uuid not null references option_groups (id) on delete cascade,
  name              text not null,

  -- Fiyat farki, kurus. 0 olabilir ("az acili" gibi ucretsiz secimler),
  -- negatif de olabilir (kucuk porsiyon indirimi).
  price_delta_kurus integer not null default 0,

  is_available      boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger options_updated_at
  before update on options
  for each row execute function set_updated_at();

create index options_group_idx on options (option_group_id, sort_order, name);

-- Hangi urunde hangi opsiyon gruplari sorulacak
create table product_option_groups (
  product_id      uuid not null references products (id) on delete cascade,
  option_group_id uuid not null references option_groups (id) on delete cascade,
  sort_order      int not null default 0,
  primary key (product_id, option_group_id)
);

create index product_option_groups_product_idx
  on product_option_groups (product_id, sort_order);

-- >>>>>>>>>>>>>>>>>>>> migrations/20260730100200_tables_and_orders.sql <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>> migrations/20260730100300_payments.sql <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>> migrations/20260730100400_stock.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0005 · Stok: malzemeler, mal kabul, receteler, hareket defteri
-- ============================================================================
-- TEMEL TASARIM: Anlik stok bir kolonda TUTULMAZ. Stok, hareket defterinin
-- (stock_movements) toplamidir. Boylece "bu gram nereden geldi, nereye gitti"
-- sorusunun her zaman bir cevabi olur; duzeltmeler gecmisi silmez.
--
-- Tum miktarlar malzemenin TEMEL BIRIMINDE (g / ml / adet) saklanir.
-- Birim donusumu VERITABANINDA yapilir (fn_to_base_quantity): uygulamada bir
-- hata olsa bile stoga karisik birim yazilamaz. packages/shared/src/units.ts
-- yalnizca ekranda onizleme icindir - iki taraf ayni carpanlari kullanir.
-- ============================================================================

-- ---------------------------------------------------------- birim donusumu

create or replace function fn_to_base_quantity(
  p_quantity      numeric,
  p_purchase_unit text,
  p_base_unit     text
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_factor numeric;
  v_base   text;
begin
  case p_purchase_unit
    when 'kg'   then v_factor := 1000; v_base := 'g';
    when 'g'    then v_factor := 1;    v_base := 'g';
    when 'lt'   then v_factor := 1000; v_base := 'ml';
    when 'ml'   then v_factor := 1;    v_base := 'ml';
    when 'adet' then v_factor := 1;    v_base := 'adet';
    else raise exception 'Bilinmeyen alim birimi: %', p_purchase_unit;
  end case;

  if v_base <> p_base_unit then
    raise exception 'Birim uyumsuz: "%" birimi "%" ile kullanilamaz (beklenen: "%").',
      p_purchase_unit, p_base_unit, v_base;
  end if;

  return round(p_quantity * v_factor, 3);
end;
$$;

-- ----------------------------------------------------------------- malzemeler

create table ingredients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,

  -- Stokta saklanan birim. Sonradan degistirilmemeli: mevcut hareketler bu
  -- birimde yazilmis olur.
  base_unit       text not null check (base_unit in ('g', 'ml', 'adet')),

  -- Bu miktarin altina dusunce uyari verilir ("Kimyon bitmek uzere")
  min_stock       numeric(12,3) check (min_stock is null or min_stock >= 0),

  -- Agirlikli ortalama birim maliyet (TEMEL BIRIM basina, kurus).
  -- Mal kabulde trigger ile guncellenir; stok raporundaki "maliyet etkisi" ve
  -- urun karlilik hesabi bu degeri kullanir.
  avg_cost_kurus  numeric(12,4) not null default 0 check (avg_cost_kurus >= 0),

  note            text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger ingredients_updated_at
  before update on ingredients
  for each row execute function set_updated_at();

create index ingredients_active_idx on ingredients (is_active, name);

-- ------------------------------------------------------------ hareket defteri

/**
 * Stok hareketi. Giris pozitif, cikis NEGATIF miktarla yazilir.
 *
 * source_type / source_id: hareketin dayandigi belge ('purchase', 'order',
 * 'waste', 'count'). Idempotency ve izlenebilirlik bu ikiliye dayanir.
 */
create table stock_movements (
  id              uuid primary key default gen_random_uuid(),
  ingredient_id   uuid not null references ingredients (id) on delete restrict,

  movement_type   text not null check (movement_type in
                    ('opening', 'purchase', 'sale', 'waste', 'count_adjust', 'manual')),

  -- Temel birimde, isaretli. 0 olamaz: anlamsiz satir birikmesin.
  quantity        numeric(12,3) not null check (quantity <> 0),

  -- Hareket anindaki birim maliyet (temel birim basina, kurus)
  unit_cost_kurus numeric(12,4),

  source_type     text,
  source_id       uuid,
  note            text,
  created_at      timestamptz not null default now()
);

create index stock_movements_ingredient_idx
  on stock_movements (ingredient_id, created_at);
create index stock_movements_created_at_idx on stock_movements (created_at);
create index stock_movements_source_idx on stock_movements (source_type, source_id);

/**
 * CIFT DUSUM KALKANI: bir adisyon icin ayni malzemeye ikinci bir satis
 * hareketi yazilamaz. fn_consume_stock_for_order ayrica kontrol yapiyor ama
 * bu kisit veritabani seviyesinde garanti verir - uygulama hatasi stoga
 * iki kez yansiyamaz.
 */
create unique index stock_movements_order_sale_uniq
  on stock_movements (source_id, ingredient_id)
  where source_type = 'order' and movement_type = 'sale';

/** Malzeme basi anlik teorik stok */
create view v_ingredient_stock as
  select
    i.id                                as ingredient_id,
    i.name,
    i.base_unit,
    i.min_stock,
    i.avg_cost_kurus,
    i.is_active,
    coalesce(m.qty, 0)::numeric(12,3)   as stock_qty,
    (i.min_stock is not null and coalesce(m.qty, 0) <= i.min_stock) as is_below_min,
    round(coalesce(m.qty, 0) * i.avg_cost_kurus)::bigint as stock_value_kurus
  from ingredients i
  left join lateral (
    select sum(sm.quantity) as qty
    from stock_movements sm
    where sm.ingredient_id = i.id
  ) m on true;

-- ------------------------------------------------------------------ mal kabul

create table stock_purchases (
  id            uuid primary key default gen_random_uuid(),
  supplier_name text,
  invoice_no    text,
  purchased_at  timestamptz not null default now(),
  note          text,
  created_at    timestamptz not null default now()
);

create index stock_purchases_date_idx on stock_purchases (purchased_at desc);

create table stock_purchase_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_id       uuid not null references stock_purchases (id) on delete cascade,
  ingredient_id     uuid not null references ingredients (id) on delete restrict,

  -- Kullanicinin girdigi haliyle: "2 kg", "1,5 lt"
  purchase_unit     text not null check (purchase_unit in ('kg', 'g', 'lt', 'ml', 'adet')),
  purchase_quantity numeric(12,3) not null check (purchase_quantity > 0),

  -- Girilen birim basina fiyat (or. TL/kg), kurus
  unit_cost_kurus   integer not null check (unit_cost_kurus >= 0),

  -- Trigger doldurur: temel birime cevrilmis miktar ve satir toplami
  base_quantity     numeric(12,3),
  line_total_kurus  integer,

  created_at        timestamptz not null default now()
);

create index stock_purchase_items_purchase_idx on stock_purchase_items (purchase_id);

/**
 * Mal kabul satiri kaydedilince:
 *   1. Miktari temel birime cevir
 *   2. Satir toplamini hesapla
 *   3. Stok hareketi (giris) yaz
 *   4. Malzemenin AGIRLIKLI ORTALAMA maliyetini guncelle
 *
 * Agirlikli ortalama neden: son alim fiyatini kullanmak, tek pahali alimda
 * tum stogu pahali gostererek karlilik raporunu yanlislastirir.
 */
create or replace function trg_purchase_item_apply()
returns trigger
language plpgsql
as $$
declare
  v_base_unit      text;
  v_base_qty       numeric(12,3);
  v_line_total     integer;
  v_base_unit_cost numeric(12,4);
  v_current_qty    numeric(12,3);
  v_current_avg    numeric(12,4);
  v_new_avg        numeric(12,4);
begin
  select base_unit, avg_cost_kurus
    into v_base_unit, v_current_avg
    from ingredients
   where id = new.ingredient_id
     for update;

  if v_base_unit is null then
    raise exception 'Malzeme bulunamadi.';
  end if;

  v_base_qty   := fn_to_base_quantity(new.purchase_quantity, new.purchase_unit, v_base_unit);
  v_line_total := round(new.unit_cost_kurus * new.purchase_quantity);

  if v_base_qty <= 0 then
    raise exception 'Cevrilen miktar sifir veya negatif olamaz.';
  end if;

  -- Temel birim basina maliyet: satir toplami / temel miktar
  v_base_unit_cost := round(v_line_total::numeric / v_base_qty, 4);

  new.base_quantity    := v_base_qty;
  new.line_total_kurus := v_line_total;

  -- Mevcut stok miktari (agirlikli ortalama icin)
  select coalesce(sum(quantity), 0) into v_current_qty
    from stock_movements where ingredient_id = new.ingredient_id;

  if v_current_qty <= 0 then
    -- Stok yok veya eksideyse ortalama tutmanin anlami kalmaz: yeni maliyet gecerli
    v_new_avg := v_base_unit_cost;
  else
    v_new_avg := round(
      ((v_current_qty * v_current_avg) + (v_base_qty * v_base_unit_cost))
        / (v_current_qty + v_base_qty),
      4
    );
  end if;

  update ingredients
     set avg_cost_kurus = v_new_avg
   where id = new.ingredient_id;

  insert into stock_movements
    (ingredient_id, movement_type, quantity, unit_cost_kurus, source_type, source_id, note)
  values
    (new.ingredient_id, 'purchase', v_base_qty, v_base_unit_cost,
     'purchase', new.purchase_id, null);

  return new;
end;
$$;

create trigger stock_purchase_items_apply
  before insert on stock_purchase_items
  for each row execute function trg_purchase_item_apply();

-- --------------------------------------------------------------------- zayi

create table stock_waste (
  id            uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients (id) on delete restrict,
  quantity      numeric(12,3) not null check (quantity > 0),  -- pozitif girilir
  reason        text not null,                                -- sebep zorunlu
  wasted_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index stock_waste_date_idx on stock_waste (wasted_at desc);

/** Zayi kaydi -> negatif stok hareketi */
create or replace function trg_waste_apply()
returns trigger
language plpgsql
as $$
declare
  v_avg numeric(12,4);
begin
  select avg_cost_kurus into v_avg from ingredients where id = new.ingredient_id;

  insert into stock_movements
    (ingredient_id, movement_type, quantity, unit_cost_kurus, source_type, source_id, note)
  values
    (new.ingredient_id, 'waste', -new.quantity, v_avg, 'waste', new.id, new.reason);

  return new;
end;
$$;

create trigger stock_waste_apply
  after insert on stock_waste
  for each row execute function trg_waste_apply();

-- ------------------------------------------------------------------ receteler

/**
 * Urun recetesi: bir porsiyon uretmek icin harcanan malzeme miktari.
 * Ornek: Yarim Ekmek Kokorec = 150 g kokorec + 1 adet yarim ekmek + 3 g kimyon
 *
 * Miktarlar istendigi zaman degistirilir - ilk hafta gercek porsiyonlarla
 * kalibre edilmesi beklenir (plandaki bilincli kabul).
 */
create table product_ingredients (
  product_id    uuid not null references products (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete restrict,
  quantity      numeric(12,3) not null check (quantity > 0),  -- temel birimde
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (product_id, ingredient_id)
);

create trigger product_ingredients_updated_at
  before update on product_ingredients
  for each row execute function set_updated_at();

/**
 * Varyant/ekstra recetesi: "Bol kimyon" +4 g kimyon, "Buyuk porsiyon"
 * +75 g kokorec gibi. Bu tablo olmadan ekstralar stoktan dusmez ve stok
 * raporu surekli acik verir.
 */
create table option_ingredients (
  option_id     uuid not null references options (id) on delete cascade,
  ingredient_id uuid not null references ingredients (id) on delete restrict,
  quantity      numeric(12,3) not null check (quantity > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (option_id, ingredient_id)
);

create trigger option_ingredients_updated_at
  before update on option_ingredients
  for each row execute function set_updated_at();

/** Urun recete maliyeti ve brut kar marji */
create view v_product_cost as
  select
    p.id                                        as product_id,
    p.name,
    p.price_kurus,
    coalesce(round(c.cost_kurus), 0)::bigint    as cost_kurus,
    (p.price_kurus - coalesce(round(c.cost_kurus), 0))::bigint as gross_profit_kurus,
    case
      when p.price_kurus > 0
        then round(((p.price_kurus - coalesce(c.cost_kurus, 0)) / p.price_kurus) * 100, 2)
      else null
    end                                         as margin_percent,
    coalesce(c.line_count, 0) > 0               as has_recipe
  from products p
  left join lateral (
    select sum(pi.quantity * i.avg_cost_kurus) as cost_kurus,
           count(*)                            as line_count
    from product_ingredients pi
    join ingredients i on i.id = pi.ingredient_id
    where pi.product_id = p.id
  ) c on true;

-- >>>>>>>>>>>>>>>>>>>> migrations/20260730100500_stock_consumption.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0006 · Satistan otomatik stok dusumu ve fiili sayim
-- ============================================================================

/**
 * Bir adisyonun receteler uzerinden stok dusumunu yapar.
 *
 * NEDEN KAPANISTA: Urun eklendiginde dusmek, iptal edilen kalemlerde stogu
 * yanlis gosterir (musteri vazgectigi urunun malzemesi harcanmamistir).
 * Satis ancak adisyon kapaninda kesinlesir; dusum de orada yapilir.
 *
 * NEDEN TRIGGER: Dusumun uygulama kodundan atlanmasi mumkun olmasin. Kasada
 * hangi yoldan kapatilirsa kapatilsin stok dusumu calisir.
 *
 * IDEMPOTENT: Ayni adisyon icin ikinci kez cagrilirsa hicbir sey yapmaz.
 * Ayrica stock_movements uzerindeki kismi unique indeks veritabani
 * seviyesinde cift dusumu imkansiz kilar.
 *
 * KAPSAM: Iptal edilmis kalemler haric tutulur. Urun recetesi VE secili
 * varyant/ekstra receteleri birlikte hesaplanir.
 */
create or replace function fn_consume_stock_for_order(p_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Zaten dusulmusse cik (cift kapatma / yeniden deneme guvenligi)
  if exists (
    select 1 from stock_movements
     where source_type = 'order'
       and source_id = p_order_id
       and movement_type = 'sale'
  ) then
    return;
  end if;

  insert into stock_movements
    (ingredient_id, movement_type, quantity, unit_cost_kurus, source_type, source_id, note)
  select
    agg.ingredient_id,
    'sale',
    -agg.total_qty,
    i.avg_cost_kurus,
    'order',
    p_order_id,
    null
  from (
    select ingredient_id, sum(qty) as total_qty
    from (
      -- 1) Urun receteleri: recete miktari x satilan adet
      select pi.ingredient_id,
             pi.quantity * oi.quantity as qty
      from order_items oi
      join product_ingredients pi on pi.product_id = oi.product_id
      where oi.order_id = p_order_id
        and oi.status <> 'cancelled'

      union all

      -- 2) Secili varyant/ekstra receteleri
      select oig.ingredient_id,
             oig.quantity * oi.quantity as qty
      from order_items oi
      join order_item_options oio on oio.order_item_id = oi.id
      join option_ingredients oig on oig.option_id = oio.option_id
      where oi.order_id = p_order_id
        and oi.status <> 'cancelled'
    ) parts
    group by ingredient_id
    having sum(qty) > 0
  ) agg
  join ingredients i on i.id = agg.ingredient_id;
end;
$$;

comment on function fn_consume_stock_for_order is
  'Adisyon kapanisinda receteler uzerinden stok dusumu yapar. Idempotenttir.';

/** Adisyon 'closed' oldugunda stok dusumunu tetikler */
create or replace function trg_orders_consume_stock()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    perform fn_consume_stock_for_order(new.id);
  end if;
  return new;
end;
$$;

create trigger orders_consume_stock
  after update of status on orders
  for each row execute function trg_orders_consume_stock();

-- ============================================================================
-- Fiili sayim
-- ============================================================================
--
-- Sayim akisi:
--   1. rpc_start_stock_count()  -> taslak sayim olusur, o andaki TEORIK
--                                  miktarlar satirlara DONDURULUR
--   2. Kullanici counted_quantity alanlarini doldurur (fark canli gorunur)
--   3. rpc_apply_stock_count()  -> fark kadar duzeltme hareketi yazilir
--
-- Teorik miktarin sayim aninda dondurulmasi kritik: duzeltme hareketi
-- yazildiktan sonra teorik stok fiiliye esitlenir, dolayisiyla farki sonradan
-- yeniden hesaplamak imkansiz hale gelir. Rapor bu dondurulmus degerleri okur.
-- ============================================================================

create table stock_counts (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'draft' check (status in ('draft', 'applied')),
  note        text,
  counted_at  timestamptz not null default now(),
  applied_at  timestamptz,
  created_at  timestamptz not null default now(),

  constraint stock_counts_applied_needs_time
    check (status <> 'applied' or applied_at is not null)
);

create index stock_counts_date_idx on stock_counts (counted_at desc);

create table stock_count_items (
  id                    uuid primary key default gen_random_uuid(),
  count_id              uuid not null references stock_counts (id) on delete cascade,
  ingredient_id         uuid not null references ingredients (id) on delete restrict,

  -- Sayim anindaki teorik miktar (DONDURULMUS - sonradan degismez)
  theoretical_quantity  numeric(12,3) not null,

  -- Kullanicinin saydigi fiili miktar. null = henuz sayilmadi.
  counted_quantity      numeric(12,3) check (counted_quantity is null or counted_quantity >= 0),

  -- counted - theoretical. Negatif = beklenenden fazla harcanmis.
  variance              numeric(12,3) generated always as
                          (counted_quantity - theoretical_quantity) stored,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (count_id, ingredient_id)
);

create trigger stock_count_items_updated_at
  before update on stock_count_items
  for each row execute function set_updated_at();

create index stock_count_items_count_idx on stock_count_items (count_id);
create index stock_count_items_ingredient_idx on stock_count_items (ingredient_id);

/**
 * Yeni sayim baslatir: aktif malzemelerin tamami icin o andaki teorik
 * miktari donduran taslak satirlar olusturur.
 */
create or replace function rpc_start_stock_count(p_note text default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count_id uuid;
begin
  if exists (select 1 from stock_counts where status = 'draft') then
    raise exception 'Tamamlanmamis bir sayim var. Once onu uygulayin veya silin.';
  end if;

  insert into stock_counts (note) values (p_note) returning id into v_count_id;

  insert into stock_count_items (count_id, ingredient_id, theoretical_quantity)
  select v_count_id, s.ingredient_id, s.stock_qty
  from v_ingredient_stock s
  where s.is_active;

  return v_count_id;
end;
$$;

/**
 * Sayimi uygular: her sayilmis satir icin fark kadar 'count_adjust' hareketi
 * yazar, boylece teorik stok fiiliye esitlenir.
 *
 * Sayilmamis (null) satirlar atlanir - kismi sayim desteklenir.
 * Fark kayitlari SILINMEZ; stok raporu bunlarin uzerinden calisir.
 */
create or replace function rpc_apply_stock_count(p_count_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from stock_counts where id = p_count_id for update;

  if v_status is null then
    raise exception 'Sayim bulunamadi.';
  end if;
  if v_status = 'applied' then
    raise exception 'Bu sayim daha once uygulanmis.';
  end if;

  insert into stock_movements
    (ingredient_id, movement_type, quantity, unit_cost_kurus, source_type, source_id, note)
  select
    ci.ingredient_id,
    'count_adjust',
    ci.variance,
    i.avg_cost_kurus,
    'count',
    p_count_id,
    'Sayim duzeltmesi'
  from stock_count_items ci
  join ingredients i on i.id = ci.ingredient_id
  where ci.count_id = p_count_id
    and ci.counted_quantity is not null
    and ci.variance <> 0;   -- fark yoksa gereksiz hareket yazilmaz

  update stock_counts
     set status = 'applied',
         applied_at = now()
   where id = p_count_id;

  insert into audit_log (entity, entity_id, action, payload)
  select
    'stock', p_count_id, 'count_applied',
    jsonb_build_object(
      'satir_sayisi', count(*),
      'fark_veren_satir', count(*) filter (where ci.variance <> 0)
    )
  from stock_count_items ci
  where ci.count_id = p_count_id and ci.counted_quantity is not null;
end;
$$;

/**
 * Elle stok duzeltmesi. Sebep zorunlu - denetim kaydina yazilir.
 * Acilis stogu girisi de bunun ozel halidir (p_movement_type = 'opening').
 */
create or replace function rpc_adjust_stock(
  p_ingredient_id uuid,
  p_quantity      numeric,
  p_reason        text,
  p_movement_type text default 'manual'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_avg numeric(12,4);
begin
  if p_quantity = 0 then
    raise exception 'Duzeltme miktari sifir olamaz.';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Duzeltme sebebi zorunludur.';
  end if;
  if p_movement_type not in ('manual', 'opening') then
    raise exception 'Gecersiz hareket tipi: %', p_movement_type;
  end if;

  select avg_cost_kurus into v_avg from ingredients where id = p_ingredient_id;
  if v_avg is null then
    raise exception 'Malzeme bulunamadi.';
  end if;

  insert into stock_movements
    (ingredient_id, movement_type, quantity, unit_cost_kurus, source_type, note)
  values
    (p_ingredient_id, p_movement_type, p_quantity, v_avg, 'manual', p_reason);

  insert into audit_log (entity, entity_id, action, payload)
  values (
    'stock', p_ingredient_id, 'adjust',
    jsonb_build_object('miktar', p_quantity, 'sebep', p_reason, 'tip', p_movement_type)
  );
end;
$$;

-- >>>>>>>>>>>>>>>>>>>> migrations/20260730100600_reports.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0007 · Raporlar
-- ============================================================================
-- Agir hesap istemciye degil Postgres'e yaptirilir: kasa bilgisayari yavas
-- olsa da rapor hizli acilir, mantik tek yerde durur.
--
-- CIRO ATFI KURALI: Bir satis, adisyonun KAPANDIGI is gunune yazilir. Para
-- kasaya o an girer; gun sonu sayimi da o gune ait olmalidir. Is gunu
-- baslangic saati (or. 04:00) ayarlardan gelir - gece 01:30 kapanan adisyon
-- onceki gune yazilir.
-- ============================================================================

/** Kapali adisyonlari is gunuyle birlikte veren yardimci view */
create view v_closed_orders as
  select
    o.id                as order_id,
    o.table_id,
    o.order_no,
    o.closed_at,
    business_day(o.closed_at, current_business_day_start_hour()) as sale_business_day,
    t.subtotal_kurus,
    t.discount_kurus,
    t.total_kurus,
    t.item_count
  from orders o
  join v_order_totals t on t.order_id = o.id
  where o.status = 'closed';

-- ---------------------------------------------------------- gun sonu / ciro

/**
 * Gun sonu ozeti (Z raporu benzeri).
 * Nakit/kart kirilimi, adisyon sayisi, ortalama sepet, iptal ve indirimler.
 */
create or replace function rpc_daily_summary(
  p_from_day date,
  p_to_day   date default null
)
returns table (
  business_day        date,
  order_count         bigint,
  gross_kurus         bigint,   -- indirim oncesi
  discount_kurus      bigint,
  net_kurus           bigint,   -- indirim sonrasi (gercek ciro)
  cash_kurus          bigint,
  card_kurus          bigint,
  vat_kurus           bigint,   -- ciro icindeki KDV (fiyatlar KDV dahil)
  avg_basket_kurus    bigint,
  item_count          bigint,
  cancelled_item_count bigint,
  cancelled_item_kurus bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select p_from_day as d_from, coalesce(p_to_day, p_from_day) as d_to
  ),
  vat as (
    select vat_percent from settings where id = true
  ),
  base as (
    select c.*
    from v_closed_orders c, bounds b
    where c.sale_business_day between b.d_from and b.d_to
  ),
  pay as (
    select
      base.sale_business_day,
      sum(case when pm.method = 'cash' then pm.amount_kurus else 0 end) as cash_kurus,
      sum(case when pm.method = 'card' then pm.amount_kurus else 0 end) as card_kurus
    from base
    join payments pm on pm.order_id = base.order_id
    group by base.sale_business_day
  ),
  cancelled as (
    select
      base.sale_business_day,
      count(*)                                                   as cnt,
      sum(oi.unit_price_kurus_snapshot * oi.quantity)             as amount
    from base
    join order_items oi on oi.order_id = base.order_id
    where oi.status = 'cancelled'
    group by base.sale_business_day
  )
  select
    base.sale_business_day                                    as business_day,
    count(*)                                                  as order_count,
    coalesce(sum(base.subtotal_kurus), 0)::bigint             as gross_kurus,
    coalesce(sum(base.discount_kurus), 0)::bigint             as discount_kurus,
    coalesce(sum(base.total_kurus), 0)::bigint                as net_kurus,
    coalesce(max(pay.cash_kurus), 0)::bigint                  as cash_kurus,
    coalesce(max(pay.card_kurus), 0)::bigint                  as card_kurus,
    -- KDV DAHIL fiyattan ayirma: kdv = brut - brut/(1+oran)
    (coalesce(sum(base.total_kurus), 0)
      - round(coalesce(sum(base.total_kurus), 0) * 100.0
              / (100.0 + (select vat_percent from vat))))::bigint as vat_kurus,
    case when count(*) > 0
      then round(coalesce(sum(base.total_kurus), 0)::numeric / count(*))::bigint
      else 0
    end                                                       as avg_basket_kurus,
    coalesce(sum(base.item_count), 0)::bigint                 as item_count,
    coalesce(max(cancelled.cnt), 0)::bigint                   as cancelled_item_count,
    coalesce(max(cancelled.amount), 0)::bigint                as cancelled_item_kurus
  from base
  left join pay       on pay.sale_business_day = base.sale_business_day
  left join cancelled on cancelled.sale_business_day = base.sale_business_day
  group by base.sale_business_day
  order by base.sale_business_day desc;
$$;

-- ----------------------------------------------------------- en cok satanlar

/**
 * Urun satis dokumu. Adet ve tutar bazli siralanabilir.
 * SNAPSHOT alanlarini kullanir: gecmis satislar, sonradan degisen fiyattan
 * etkilenmez.
 */
create or replace function rpc_product_sales(
  p_from_day date,
  p_to_day   date default null
)
returns table (
  product_id        uuid,
  product_name      text,
  category_name     text,
  quantity_sold     bigint,
  revenue_kurus     bigint,
  cost_kurus        bigint,
  gross_profit_kurus bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select p_from_day as d_from, coalesce(p_to_day, p_from_day) as d_to
  ),
  sold as (
    select
      oi.product_id,
      oi.product_name_snapshot,
      sum(oi.quantity)                 as qty,
      sum(v.line_total_kurus)          as revenue
    from v_closed_orders c
    join order_items oi         on oi.order_id = c.order_id
    join v_order_item_totals v  on v.order_item_id = oi.id
    cross join bounds b
    where c.sale_business_day between b.d_from and b.d_to
      and oi.status <> 'cancelled'
    group by oi.product_id, oi.product_name_snapshot
  )
  select
    sold.product_id,
    sold.product_name_snapshot                        as product_name,
    cat.name                                          as category_name,
    sold.qty::bigint                                   as quantity_sold,
    sold.revenue::bigint                               as revenue_kurus,
    -- Maliyet GUNCEL recete ve guncel ortalama maliyetle hesaplanir; gecmise
    -- donuk maliyet snapshot'i tutulmuyor (recete zamanla kalibre ediliyor).
    round(coalesce(pc.cost_kurus, 0) * sold.qty)::bigint as cost_kurus,
    (sold.revenue - round(coalesce(pc.cost_kurus, 0) * sold.qty))::bigint
                                                       as gross_profit_kurus
  from sold
  left join products p on p.id = sold.product_id
  left join categories cat on cat.id = p.category_id
  left join v_product_cost pc on pc.product_id = sold.product_id
  order by sold.qty desc, sold.revenue desc;
$$;

-- ---------------------------------------------------------- saatlik yogunluk

/**
 * Saat bazli yogunluk. Saat, Europe/Istanbul yerel saatidir - ham UTC
 * kullanmak grafigi 3 saat kaydirir.
 */
create or replace function rpc_hourly_load(
  p_from_day date,
  p_to_day   date default null
)
returns table (
  hour_of_day   int,
  order_count   bigint,
  revenue_kurus bigint,
  item_count    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select p_from_day as d_from, coalesce(p_to_day, p_from_day) as d_to
  ),
  hours as (
    select generate_series(0, 23) as hour_of_day
  ),
  sales as (
    select
      extract(hour from (c.closed_at at time zone 'Europe/Istanbul'))::int as hour_of_day,
      count(*)                        as order_count,
      sum(c.total_kurus)              as revenue_kurus,
      sum(c.item_count)               as item_count
    from v_closed_orders c, bounds b
    where c.sale_business_day between b.d_from and b.d_to
    group by 1
  )
  select
    h.hour_of_day,
    coalesce(s.order_count, 0)::bigint,
    coalesce(s.revenue_kurus, 0)::bigint,
    coalesce(s.item_count, 0)::bigint
  from hours h
  left join sales s on s.hour_of_day = h.hour_of_day
  order by h.hour_of_day;
$$;

-- ============================================================================
-- STOK RAPORU  ·  planin cekirdek istegi
-- ============================================================================
/**
 * Malzeme basina tek satir: girenler, satistan tuketim, zayi, teorik kalan ve
 * fiili sayimla KIYASLAMA.
 *
 *   teorik kalan = donem basi + giren − satis tuketimi − zayi ± duzeltme
 *   fark         = sayilan − teorik   (sayim aninda dondurulmus degerlerden)
 *
 * Fark neden sayim kaydindan okunuyor: sayim uygulandiginda teorik stok
 * fiiliye esitlenir, yani farki sonradan yeniden hesaplamak imkansizdir.
 * Sayim satirlari o anki teorik miktari saklar; rapor onu okur.
 *
 * NEGATIF fark  = beklenenden fazla harcanmis (porsiyon sasmasi, fire, kayip)
 * POZITIF fark  = recete gerceginin altinda kalmis ya da giris/sayim hatasi
 *
 * Rapor farki GOSTERIR, sebebini iddia etmez. Yorum isletmeye aittir.
 */
create or replace function rpc_stock_report(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  ingredient_id       uuid,
  ingredient_name     text,
  base_unit           text,
  opening_qty         numeric,
  purchased_qty       numeric,
  sold_qty            numeric,
  waste_qty           numeric,
  adjustment_qty      numeric,
  theoretical_qty     numeric,
  counted_qty         numeric,
  variance_qty        numeric,
  variance_percent    numeric,
  variance_cost_kurus bigint,
  avg_cost_kurus      numeric,
  min_stock           numeric,
  is_below_min        boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with opening as (
    -- Donem basi devir: p_from oncesindeki tum hareketlerin toplami
    select sm.ingredient_id, sum(sm.quantity) as qty
    from stock_movements sm
    where sm.created_at < p_from
    group by sm.ingredient_id
  ),
  period as (
    select
      sm.ingredient_id,
      sum(case when sm.movement_type in ('purchase', 'opening')
               then sm.quantity else 0 end)                        as purchased,
      -- Cikislar negatif saklanir; raporda pozitif gosteriyoruz
      sum(case when sm.movement_type = 'sale'
               then -sm.quantity else 0 end)                       as sold,
      sum(case when sm.movement_type = 'waste'
               then -sm.quantity else 0 end)                       as waste,
      sum(case when sm.movement_type in ('count_adjust', 'manual')
               then sm.quantity else 0 end)                        as adjustment
    from stock_movements sm
    where sm.created_at >= p_from and sm.created_at < p_to
    group by sm.ingredient_id
  ),
  last_count as (
    -- Donem icindeki EN SON uygulanmis sayimin satiri (malzeme basina)
    select distinct on (ci.ingredient_id)
      ci.ingredient_id,
      ci.counted_quantity,
      ci.theoretical_quantity,
      ci.variance
    from stock_count_items ci
    join stock_counts c on c.id = ci.count_id
    where c.status = 'applied'
      and c.counted_at >= p_from
      and c.counted_at < p_to
      and ci.counted_quantity is not null
    order by ci.ingredient_id, c.counted_at desc
  )
  select
    i.id                                              as ingredient_id,
    i.name                                            as ingredient_name,
    i.base_unit,
    coalesce(o.qty, 0)                                as opening_qty,
    coalesce(p.purchased, 0)                          as purchased_qty,
    coalesce(p.sold, 0)                               as sold_qty,
    coalesce(p.waste, 0)                              as waste_qty,
    coalesce(p.adjustment, 0)                         as adjustment_qty,
    (coalesce(o.qty, 0)
      + coalesce(p.purchased, 0)
      - coalesce(p.sold, 0)
      - coalesce(p.waste, 0)
      + coalesce(p.adjustment, 0))                    as theoretical_qty,
    lc.counted_quantity                               as counted_qty,
    lc.variance                                       as variance_qty,
    case
      when lc.variance is null then null
      when lc.theoretical_quantity = 0 then null
      else round((lc.variance / lc.theoretical_quantity) * 100, 2)
    end                                               as variance_percent,
    case
      when lc.variance is null then null
      else round(lc.variance * i.avg_cost_kurus)::bigint
    end                                               as variance_cost_kurus,
    i.avg_cost_kurus,
    i.min_stock,
    (i.min_stock is not null
      and (coalesce(o.qty, 0)
           + coalesce(p.purchased, 0)
           - coalesce(p.sold, 0)
           - coalesce(p.waste, 0)
           + coalesce(p.adjustment, 0)) <= i.min_stock) as is_below_min
  from ingredients i
  left join opening    o  on o.ingredient_id  = i.id
  left join period     p  on p.ingredient_id  = i.id
  left join last_count lc on lc.ingredient_id = i.id
  where i.is_active
  order by i.name;
$$;

comment on function rpc_stock_report is
  'Malzeme bazli stok raporu: giren, satistan tuketim, zayi, teorik kalan ve fiili sayimla fark.';

-- >>>>>>>>>>>>>>>>>>>> migrations/20260730100700_rls.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0008 · Guvenlik: RLS politikalari ve rol yetkileri
-- ============================================================================
-- IKI ROL VAR:
--
--   anon          -> QR menu sitesi. YALNIZCA menu tablolarini, yalnizca aktif
--                    satirlari OKUR. Baska hicbir seye erisemez.
--   authenticated -> kasa programi (tek kullanici). Operasyonel tablolarda tam
--                    yetki; rol ayrimi yok (plan karari).
--
-- ONEMLI: View'larda RLS CALISMAZ. Supabase, public semasindaki nesnelere anon
-- ve authenticated rollerine varsayilan yetki verir; bu yuzden once anon'dan
-- HER SEYI geri aliyoruz, sonra sadece gerekeni veriyoruz. "Varsayilan kapali"
-- yaklasimi, ileride eklenen bir tablonun yanlislikla musteriye acilmasini
-- onler.
-- ============================================================================

-- ------------------------------------------------- 1) RLS'i her tabloda ac
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end;
$$;

-- ------------------------------- 2) anon'dan tum yetkileri geri al (kapali baslangic)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- Ileride eklenecek nesneler de anon'a kapali dogsun
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- -------------------------- 3) authenticated: operasyonel tablolarda tam yetki
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'create policy "kasa_tam_yetki" on public.%I for all to authenticated using (true) with check (true)',
      r.tablename
    );
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated',
      r.tablename
    );
  end loop;
end;
$$;

-- ------------------------------------------- 4) anon: yalnizca menu okuma
--
-- Politikalar aktiflik filtresini TASIR: pasife alinmis kategori/urun QR
-- menude hic gorunmez. "Tukendi" (is_available = false) urunler ise GORUNUR -
-- musteri fiyati gormeye devam eder, sadece tukendi etiketi alir.

grant select on public.categories           to anon;
grant select on public.products             to anon;
grant select on public.option_groups        to anon;
grant select on public.options              to anon;
grant select on public.product_option_groups to anon;
grant select on public.v_public_shop_info   to anon;

create policy "menu_okuma" on public.categories
  for select to anon using (is_active);

create policy "menu_okuma" on public.products
  for select to anon using (
    is_active
    and exists (
      select 1 from public.categories c
      where c.id = products.category_id and c.is_active
    )
  );

create policy "menu_okuma" on public.option_groups
  for select to anon using (is_active);

create policy "menu_okuma" on public.options
  for select to anon using (
    exists (
      select 1 from public.option_groups g
      where g.id = options.option_group_id and g.is_active
    )
  );

create policy "menu_okuma" on public.product_option_groups
  for select to anon using (
    exists (
      select 1 from public.products p
      where p.id = product_option_groups.product_id and p.is_active
    )
  );

-- --------------------------------------------------- 5) View guvenligi
--
-- security_invoker = true: view, cagiran rolun yetkileriyle calisir, yani
-- alttaki tablolarin RLS politikalari UYGULANIR. Varsayilan (false) davranis
-- view sahibinin yetkileriyle calisir ve RLS'i bypass eder - operasyonel
-- view'larda bu sizinti demek olurdu.

alter view v_order_item_totals set (security_invoker = true);
alter view v_order_totals      set (security_invoker = true);
alter view v_closed_orders     set (security_invoker = true);
alter view v_ingredient_stock  set (security_invoker = true);
alter view v_product_cost      set (security_invoker = true);

grant select on v_order_item_totals to authenticated;
grant select on v_order_totals      to authenticated;
grant select on v_closed_orders     to authenticated;
grant select on v_ingredient_stock  to authenticated;
grant select on v_product_cost      to authenticated;

-- v_public_shop_info BILINCLI olarak security_invoker = false kalir:
-- settings tablosu anon'a tamamen kapali, ama QR menunun dukkan adi ve
-- telefonu gostermesi gerekiyor. View yalnizca bu iki kolonu acar; yazici
-- IP'si, KDV orani, esikler disarida kalir.

-- ------------------------------------------- 6) Fonksiyon yetkileri
--
-- Varsayilan olarak EXECUTE yetkisi PUBLIC'e verilir - rapor ve kasa
-- fonksiyonlari icin bu kabul edilemez. Hepsini kapatip yalnizca
-- authenticated'a aciyoruz.

revoke execute on function rpc_daily_summary(date, date)      from public;
revoke execute on function rpc_product_sales(date, date)      from public;
revoke execute on function rpc_hourly_load(date, date)        from public;
revoke execute on function rpc_stock_report(timestamptz, timestamptz) from public;
revoke execute on function rpc_close_order(uuid, boolean)     from public;
revoke execute on function rpc_merge_orders(uuid, uuid)       from public;
revoke execute on function rpc_start_stock_count(text)        from public;
revoke execute on function rpc_apply_stock_count(uuid)        from public;
revoke execute on function rpc_adjust_stock(uuid, numeric, text, text) from public;
revoke execute on function fn_consume_stock_for_order(uuid)   from public;

grant execute on function rpc_daily_summary(date, date)      to authenticated;
grant execute on function rpc_product_sales(date, date)      to authenticated;
grant execute on function rpc_hourly_load(date, date)        to authenticated;
grant execute on function rpc_stock_report(timestamptz, timestamptz) to authenticated;
grant execute on function rpc_close_order(uuid, boolean)     to authenticated;
grant execute on function rpc_merge_orders(uuid, uuid)       to authenticated;
grant execute on function rpc_start_stock_count(text)        to authenticated;
grant execute on function rpc_apply_stock_count(uuid)        to authenticated;
grant execute on function rpc_adjust_stock(uuid, numeric, text, text) to authenticated;

-- ------------------------------------------- 7) Urun gorselleri (Storage)
--
-- Gorseller herkese acik okunur (QR menude gorunmeli), yazma yalnizca
-- oturum acmis kullaniciya aittir.

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "urun_gorseli_okuma"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "urun_gorseli_yazma"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images');

create policy "urun_gorseli_guncelleme"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-images');

create policy "urun_gorseli_silme"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images');

-- >>>>>>>>>>>>>>>>>>>> seed.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Ornek veri (seed)
-- ============================================================================
-- Gelistirme ve test icin gercekci bir kokorec menusu, malzeme listesi ve
-- baslangic receteleri. Dukkanin gercek fiyatlari ve porsiyon miktarlari
-- alindiginda bu dosya guncellenecek.
--
-- Receteler TAHMINIDIR. Stok raporunun anlamli olmasi icin ilk hafta gercek
-- porsiyonlarla kalibre edilmesi gerekir (bkz. plan: "Riskler").
-- ============================================================================

update settings
   set shop_name = 'Kokoreççi',
       phone = null,
       receipt_header = 'KOKOREÇÇİ',
       receipt_footer = 'Afiyet olsun, tekrar bekleriz!',
       vat_percent = 10,
       business_day_start_hour = 4
 where id = true;

-- ------------------------------------------------------------------ bolgeler

insert into areas (name, sort_order) values
  ('Salon', 1),
  ('Bahçe', 2);

insert into restaurant_tables (area_id, name, seats, sort_order)
select a.id, t.name, t.seats, t.sort_order
from areas a
join (values
  ('Salon', '1', 4, 1), ('Salon', '2', 4, 2), ('Salon', '3', 2, 3),
  ('Salon', '4', 4, 4), ('Salon', '5', 6, 5), ('Salon', '6', 2, 6),
  ('Bahçe', '7', 4, 1), ('Bahçe', '8', 4, 2),
  ('Bahçe', '9', 6, 3), ('Bahçe', '10', 4, 4)
) as t(area_name, name, seats, sort_order) on t.area_name = a.name;

-- ---------------------------------------------------------------- kategoriler

insert into categories (name, sort_order) values
  ('Kokoreç', 1),
  ('Yanındakiler', 2),
  ('İçecekler', 3);

-- --------------------------------------------------------------------- urunler

insert into products (category_id, name, description, price_kurus, sort_order)
select c.id, p.name, p.description, p.price_kurus, p.sort_order
from categories c
join (values
  ('Kokoreç',      'Çeyrek Ekmek Kokoreç', 'Çeyrek ekmek arasında, domates ve biberli',        8000,  1),
  ('Kokoreç',      'Yarım Ekmek Kokoreç',  'Yarım ekmek arasında, domates ve biberli',        14000,  2),
  ('Kokoreç',      'Tam Ekmek Kokoreç',    'Tam ekmek arasında, doyurucu porsiyon',           26000,  3),
  ('Kokoreç',      'Porsiyon Kokoreç',     'Tabakta servis, ekmek ayrı gelir',                22000,  4),
  ('Yanındakiler', 'Midye Dolma (6 adet)', 'Limonla servis edilir',                           12000,  1),
  ('Yanındakiler', 'Turşu',                'Karışık turşu',                                   3000,  2),
  ('İçecekler',    'Ayran',                '300 ml',                                          3000,  1),
  ('İçecekler',    'Şalgam',               'Acılı veya acısız',                                3500,  2),
  ('İçecekler',    'Kola',                 '330 ml kutu',                                     4000,  3),
  ('İçecekler',    'Su',                   '500 ml',                                          1500,  4)
) as p(category_name, name, description, price_kurus, sort_order)
  on p.category_name = c.name;

-- ------------------------------------------------------- varyant / ekstra gruplari

insert into option_groups (name, selection_type, is_required, min_select, max_select, sort_order)
values
  ('Acılık',    'single', true,  1, 1,    1),
  ('Porsiyon',  'single', false, 0, 1,    2),
  ('Ekstralar', 'multi',  false, 0, null, 3);

insert into options (option_group_id, name, price_delta_kurus, sort_order)
select g.id, o.name, o.price_delta_kurus, o.sort_order
from option_groups g
join (values
  ('Acılık',    'Acısız',          0,    1),
  ('Acılık',    'Az Acılı',        0,    2),
  ('Acılık',    'Acılı',           0,    3),
  ('Acılık',    'Çok Acılı',       0,    4),
  ('Porsiyon',  'Normal',          0,    1),
  ('Porsiyon',  'Büyük',       5000,     2),
  ('Ekstralar', 'Bol Kimyon',      0,    1),
  ('Ekstralar', 'Ekstra Kokoreç', 6000,  2),
  ('Ekstralar', 'Kaşar',          3000,  3),
  ('Ekstralar', 'Soğansız',        0,    4)
) as o(group_name, name, price_delta_kurus, sort_order) on o.group_name = g.name;

-- Hangi urunde hangi gruplar sorulacak
insert into product_option_groups (product_id, option_group_id, sort_order)
select p.id, g.id, x.sort_order
from products p
join (values
  ('Çeyrek Ekmek Kokoreç', 'Acılık',    1),
  ('Çeyrek Ekmek Kokoreç', 'Ekstralar', 2),
  ('Yarım Ekmek Kokoreç',  'Acılık',    1),
  ('Yarım Ekmek Kokoreç',  'Ekstralar', 2),
  ('Tam Ekmek Kokoreç',    'Acılık',    1),
  ('Tam Ekmek Kokoreç',    'Ekstralar', 2),
  ('Porsiyon Kokoreç',     'Acılık',    1),
  ('Porsiyon Kokoreç',     'Porsiyon',  2),
  ('Porsiyon Kokoreç',     'Ekstralar', 3),
  ('Şalgam',               'Acılık',    1)
) as x(product_name, group_name, sort_order) on x.product_name = p.name
join option_groups g on g.name = x.group_name;

-- ------------------------------------------------------------------ malzemeler

insert into ingredients (name, base_unit, min_stock) values
  ('Kokoreç',        'g',    2000),
  ('Ekmek',          'adet',   20),
  ('Kimyon',         'g',     200),
  ('Pul Biber',      'g',     200),
  ('Karabiber',      'g',     100),
  ('Tuz',            'g',     500),
  ('Domates',        'g',    1000),
  ('Yeşil Biber',    'g',     500),
  ('Maydanoz',       'g',     200),
  ('Soğan',          'g',     500),
  ('Kaşar Peyniri',  'g',     500),
  ('Midye Dolma',    'adet',   50),
  ('Turşu',          'g',    1000),
  ('Ayran',          'adet',   24),
  ('Şalgam',         'adet',   12),
  ('Kola',           'adet',   24),
  ('Su',             'adet',   24);

-- ------------------------------------------------------------------- receteler

insert into product_ingredients (product_id, ingredient_id, quantity)
select p.id, i.id, r.quantity
from (values
  -- Ceyrek ekmek
  ('Çeyrek Ekmek Kokoreç', 'Kokoreç',     100),
  ('Çeyrek Ekmek Kokoreç', 'Ekmek',      0.25),
  ('Çeyrek Ekmek Kokoreç', 'Kimyon',        2),
  ('Çeyrek Ekmek Kokoreç', 'Pul Biber',     1),
  ('Çeyrek Ekmek Kokoreç', 'Tuz',           1),
  ('Çeyrek Ekmek Kokoreç', 'Domates',      15),
  ('Çeyrek Ekmek Kokoreç', 'Yeşil Biber',  10),
  ('Çeyrek Ekmek Kokoreç', 'Maydanoz',      2),
  ('Çeyrek Ekmek Kokoreç', 'Soğan',        10),
  -- Yarim ekmek
  ('Yarım Ekmek Kokoreç',  'Kokoreç',     180),
  ('Yarım Ekmek Kokoreç',  'Ekmek',       0.5),
  ('Yarım Ekmek Kokoreç',  'Kimyon',        3),
  ('Yarım Ekmek Kokoreç',  'Pul Biber',     2),
  ('Yarım Ekmek Kokoreç',  'Tuz',           2),
  ('Yarım Ekmek Kokoreç',  'Domates',      25),
  ('Yarım Ekmek Kokoreç',  'Yeşil Biber',  15),
  ('Yarım Ekmek Kokoreç',  'Maydanoz',      3),
  ('Yarım Ekmek Kokoreç',  'Soğan',        15),
  -- Tam ekmek
  ('Tam Ekmek Kokoreç',    'Kokoreç',     350),
  ('Tam Ekmek Kokoreç',    'Ekmek',         1),
  ('Tam Ekmek Kokoreç',    'Kimyon',        5),
  ('Tam Ekmek Kokoreç',    'Pul Biber',     3),
  ('Tam Ekmek Kokoreç',    'Tuz',           3),
  ('Tam Ekmek Kokoreç',    'Domates',      45),
  ('Tam Ekmek Kokoreç',    'Yeşil Biber',  25),
  ('Tam Ekmek Kokoreç',    'Maydanoz',      5),
  ('Tam Ekmek Kokoreç',    'Soğan',        25),
  -- Porsiyon (ekmek yok)
  ('Porsiyon Kokoreç',     'Kokoreç',     250),
  ('Porsiyon Kokoreç',     'Kimyon',        4),
  ('Porsiyon Kokoreç',     'Pul Biber',     2),
  ('Porsiyon Kokoreç',     'Tuz',           2),
  ('Porsiyon Kokoreç',     'Domates',      30),
  ('Porsiyon Kokoreç',     'Yeşil Biber',  20),
  ('Porsiyon Kokoreç',     'Maydanoz',      4),
  -- Yanindakiler / icecekler: bire bir tuketim
  ('Midye Dolma (6 adet)', 'Midye Dolma',   6),
  ('Turşu',                'Turşu',       150),
  ('Ayran',                'Ayran',         1),
  ('Şalgam',               'Şalgam',        1),
  ('Kola',                 'Kola',          1),
  ('Su',                   'Su',            1)
) as r(product_name, ingredient_name, quantity)
join products p    on p.name = r.product_name
join ingredients i on i.name = r.ingredient_name;

-- Varyant/ekstra receteleri: bunlar olmadan ekstralar stoktan dusmez ve
-- stok raporu surekli acik verir.
insert into option_ingredients (option_id, ingredient_id, quantity)
select o.id, i.id, r.quantity
from (values
  ('Az Acılı',       'Pul Biber',       1),
  ('Acılı',          'Pul Biber',       2),
  ('Çok Acılı',      'Pul Biber',       4),
  ('Bol Kimyon',     'Kimyon',          3),
  ('Ekstra Kokoreç', 'Kokoreç',        80),
  ('Kaşar',          'Kaşar Peyniri',  25),
  ('Büyük',          'Kokoreç',       100)
) as r(option_name, ingredient_name, quantity)
join options o     on o.name = r.option_name
join ingredients i on i.name = r.ingredient_name;

-- --------------------------------------------------------------- acilis stogu
--
-- Mal kabul uzerinden giriliyor ki agirlikli ortalama maliyet de olussun.
-- (Gercek kurulumda patronun eldeki mali ile degistirilecek.)

do $$
declare
  v_purchase_id uuid;
begin
  insert into stock_purchases (supplier_name, invoice_no, note)
  values ('Açılış stoğu', null, 'Sistem kurulumunda girilen mevcut mal')
  returning id into v_purchase_id;

  insert into stock_purchase_items
    (purchase_id, ingredient_id, purchase_unit, purchase_quantity, unit_cost_kurus)
  select v_purchase_id, i.id, x.unit, x.qty, x.cost
  from (values
    ('Kokoreç',       'kg',    15,   32000),  -- 320 TL/kg
    ('Ekmek',         'adet', 100,     500),  -- 5 TL/adet
    ('Kimyon',        'kg',     2,   18000),
    ('Pul Biber',     'kg',     2,   16000),
    ('Karabiber',     'kg',     1,   45000),
    ('Tuz',           'kg',     5,    1500),
    ('Domates',       'kg',    10,    3500),
    ('Yeşil Biber',   'kg',     5,    4500),
    ('Maydanoz',      'kg',     2,    3000),
    ('Soğan',         'kg',     8,    2000),
    ('Kaşar Peyniri', 'kg',     3,   28000),
    ('Midye Dolma',   'adet', 200,     900),
    ('Turşu',         'kg',    10,    4000),
    ('Ayran',         'adet', 120,    1800),
    ('Şalgam',        'adet',  48,    2000),
    ('Kola',          'adet', 120,    2500),
    ('Su',            'adet', 240,     700)
  ) as x(ingredient_name, unit, qty, cost)
  join ingredients i on i.name = x.ingredient_name;
end;
$$;
