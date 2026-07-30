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
