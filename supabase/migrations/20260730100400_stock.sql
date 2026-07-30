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
