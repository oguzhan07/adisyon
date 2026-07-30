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
