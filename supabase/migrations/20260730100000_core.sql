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
