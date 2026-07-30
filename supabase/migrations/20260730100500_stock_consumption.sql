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
