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
