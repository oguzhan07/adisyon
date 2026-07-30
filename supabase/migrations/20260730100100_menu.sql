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
