# Kokoreççi — QR Menü + Adisyon + Stok Sistemi

İki uygulama, tek veritabanı:

| Parça | Ne | Nerede çalışır |
|---|---|---|
| **QR Menü** | Müşterinin telefonda gördüğü menü (sadece görüntüleme) | Next.js → Vercel |
| **Adisyon/Kasa** | Masa, sipariş, ödeme, stok, rapor, fiş basma | Electron → kasa PC'si (Windows) |
| **Veritabanı** | Postgres + Auth + Storage | Supabase |

Kasa programının masaüstü olmasının sebebi yazıcı: tarayıcı termal yazıcıya ham ESC/POS gönderemez, Vercel'deki bir sayfa da dükkânın yerel ağına ulaşamaz.

## Klasör yapısı

```
adisyon/
├── packages/shared/     Para (kuruş), birim dönüşümü, fiyat hesabı, iş günü, tasarım token'ları
├── apps/menu/           QR menü sitesi (Next.js)
├── apps/pos/            Kasa programı (Electron + React)
└── supabase/            Veritabanı şeması (migrations) + örnek veri (seed)
```

`packages/shared` iki uygulamanın ortak doğruluk kaynağıdır: fiyat hesabı, kuruş aritmetiği ve birim dönüşümü tek yerde durur, böylece müşterinin telefonda gördüğü tutar ile adisyona işlenen tutar ayrışamaz.

---

## Kurulum

### 0) Gereksinimler

- Node.js 20+ (bu projede 24 ile geliştirildi)
- Git
- Bir Supabase hesabı (ücretsiz plan yeterli)
- Bir Vercel hesabı (ücretsiz plan yeterli)

```bash
npm install
```

> **Not:** npm 11, güvenlik gereği paketlerin install script'lerini engelliyor. Electron ikilisi bu yüzden otomatik inmez; bir kez şunu çalıştırın:
> ```bash
> node node_modules/electron/install.js
> ```

### 1) Supabase projesi

1. [supabase.com](https://supabase.com) üzerinde yeni bir proje oluşturun (bölge: **Frankfurt** — Türkiye'ye en yakın olanı).
2. Veritabanı şifresini güvenli bir yere kaydedin.
3. Proje referansını (`Project Settings > General > Reference ID`) alın.

Şemayı yüklemenin **iki yolu** var:

**A) Tek dosya (en kolay — CLI/Docker gerekmez):**
`supabase/COMBINED_SETUP.sql` dosyasının tamamını **Supabase paneli → SQL Editor**'a yapıştırıp **Run** deyin. Tüm şema + örnek kokoreç menüsü tek seferde kurulur.

**B) Supabase CLI ile:**
```bash
npx supabase link --project-ref BURAYA_REFERANS_ID
```
```bash
npx supabase db push
```
Örnek veriyi ayrıca yüklemek için `supabase/seed.sql`'i SQL Editor'da çalıştırın.

### 2) Tek kullanıcı hesabını oluştur

Sistemde rol ayrımı yok, tek kullanıcı tam yetkili. Hesabı elle açıyoruz:

**Supabase Studio > Authentication > Users > Add user**
- E-posta ve şifre girin
- **Auto Confirm User** işaretli olsun

Kayıt ekranı bilinçli olarak yok (`supabase/config.toml` içinde `enable_signup = false`).

### 3) Anahtarları al

**Project Settings > API** bölümünden:
- `Project URL`
- `anon public` anahtarı

> ⚠️ **`service_role` anahtarını hiçbir uygulamaya koymayın.** İki uygulama da yalnızca `anon` anahtarı kullanır; yetkiler RLS ile sınırlanmıştır.

Ortak bir gizli anahtar üretin ("Menüyü yayınla" özelliği için):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4) QR menü sitesi

```bash
cp apps/menu/.env.example apps/menu/.env.local
```

`apps/menu/.env.local` dosyasını doldurun, sonra:

```bash
npm run dev:menu
```

### 5) Kasa programı

```bash
cp apps/pos/.env.example apps/pos/.env
```

`apps/pos/.env` dosyasını doldurun, sonra:

```bash
npm run dev:pos
```

### 6) Vercel dağıtımı

1. Projeyi GitHub'a push edin.
2. Vercel'de **New Project** → repoyu seçin.
3. **Root Directory: `apps/menu`** (bu ayar önemli — monorepo).
4. Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `REVALIDATE_SECRET`.

### 7) Kurulum `.exe`'si

```bash
npm run dist:pos
```

Çıktı: `apps/pos/release/`. Kod imzalama sertifikası olmadığı için Windows SmartScreen ilk kurulumda uyarı gösterir; **Daha fazla bilgi → Yine de çalıştır** ile geçilir.

---

## Yazıcı (POSA 80mm termal)

**Bağlantı için ağı (Ethernet) tercih edin.** Windows yazıcı sürücüsünden ve oturum durumundan bağımsız olduğu için belirgin şekilde daha kararlıdır.

1. Yazıcıya ağ kablosunu takın, yazıcının kendi menüsünden IP adresini öğrenin.
2. Ulaşılabilirliği sınayın:
   ```bash
   ping YAZICI_IP
   ```
3. Kasa programı → **Ayarlar → Yazıcı**: bağlantı türü *Ağ*, IP ve port (9100) girin, **Kaydet**.
4. **Bağlantıyı sına** → ardından **Test fişi bas**.

### Test fişinde kontrol edilecekler

- Türkçe karakterler: `ç ğ ı i ö ş ü` ve `Ç Ğ I İ Ö Ş Ü` bozuk çıkmamalı
- Fişin sonu otomatik kesilmeli
- Kasa çekmecesi ayarı açıksa çekmece açılmalı
- Sağdaki tutarlar sağ kenara hizalı olmalı

Karakterler bozuk çıkarsa yazıcı farklı bir kod sayfası kullanıyor demektir (varsayılan: **PC857 Türkçe**).

**USB kullanmak zorundaysanız:** yazıcıyı Windows'ta paylaşıma açın (Yazıcı özellikleri → Paylaşım), paylaşım adını ayarlara girin. Bu yol native modül kullanmaz; ham veri `copy /b` ile paylaşıma gönderilir.

---

## Önemli tasarım kararları

Bunlar sonradan "neden böyle yapılmış?" sorusunu doğuran, bilinçli seçimlerdir.

**Para tam sayı kuruş olarak saklanır.** Ondalıklı para ile aritmetik yapılmaz; JS'in kayan nokta hatası kasa toplamlarında kuruş kaymasına yol açar. Hesap bölmede artan kuruş ilk paylara dağıtılır (`splitEvenly`) — 3'e bölünen 100 TL'de 1 kuruş buharlaşmaz.

**Adisyon satırı fiyatı snapshot'lar.** `order_items`, sipariş anındaki ürün adını ve fiyatını kendi içinde tutar. Patron yarın zam yaparsa dünün adisyonu ve raporu değişmez.

**Toplamlar tabloda tutulmaz, view ile hesaplanır.** Kalem eklendiğinde güncellenmeyi unutulan bir `total` kolonu yüzünden kasanın tutmaması en klasik POS hatasıdır.

**Stok, hareket defterinin toplamıdır.** Anlık stok bir kolonda durmaz (`v_ingredient_stock`). Böylece "bu gram nereden geldi, nereye gitti" izlenebilir ve düzeltmeler geçmişi silmez.

**Stok düşümü adisyon kapanışında, trigger ile yapılır.** Kapanışta olması iptalleri doğru işler (vazgeçilen ürünün malzemesi harcanmamıştır); trigger olması uygulama kodunun düşümü atlamasını imkânsız kılar. İki kez çalışmaya karşı hem fonksiyon içinde hem veritabanı indeksiyle korumalı.

**Miktarlar tek temel birimde (g/ml/adet) saklanır.** Dönüşüm veritabanında yapılır (`fn_to_base_quantity`); uygulamada bir hata olsa bile stoğa karışık birim yazılamaz.

**İş günü ayarlanabilir bir saatte başlar (varsayılan 04:00).** Dükkân 02:00'de kapanıyorsa o satış önceki iş gününe yazılır. Ham `created_at::date` kullanmak gün sonu ciroyu sessizce ikiye böler.

**Ciro, adisyonun kapandığı iş gününe yazılır.** Para kasaya o an girer; gün sonu sayımı da o günle karşılaştırılır.

**`anon` rolü varsayılan olarak her şeye kapalıdır.** Önce tüm yetkiler geri alınır, sonra yalnızca menü tabloları açılır. Böylece ileride eklenen bir tablo yanlışlıkla müşteri tarafına açılmaz. Stok tabloları ve reçeteler `anon`'a tamamen kapalıdır — ticari sır.

**View'larda `security_invoker = true`.** Varsayılan davranış view sahibinin yetkileriyle çalışıp RLS'i bypass eder; operasyonel view'larda bu sızıntı olurdu.

**Renderer'da Node erişimi yok.** `contextIsolation` açık, `nodeIntegration` kapalı; arayüz yalnızca `preload`'daki dar IPC kanallarını çağırır.

**Oturum jetonu `safeStorage` ile şifreli saklanır.** localStorage diskte düz metin durur; kasa bilgisayarına fiziksel erişen biri jetonu okuyup veritabanına bağlanabilirdi.

**Yazıcı hatası adisyonu asla bloke etmez.** Sipariş veritabanına yazılır, fiş sonra basılır; kâğıt bitse bile satış durmaz.

---

## Bilinen sınırlar

- **Sadece online.** İnternet kesilirse sipariş girişi durur. Dükkânda yedek bağlantı (telefon hotspot) bulundurulması önerilir.
- **Rol ayrımı yok.** Tek kullanıcı tam yetkili. İptal, indirim ve stok düzeltmeleri `audit_log` tablosuna iz bırakır.
- **Bastığımız fiş bilgi fişidir.** Yazarkasa/ÖKC fişinin yerini almaz; fişin altında bu ibare basılır. Mali müşavir teyidi işletmenin sorumluluğundadır.
- **Stok raporunun değeri reçetelerin doğruluğuna bağlıdır.** İlk hafta sık sayım yapıp reçeteleri gerçek porsiyonlara göre kalibre etmek gerekir. Rapor farkı gösterir, sebebini iddia etmez.
- **Kod imzalama sertifikası yok.** Windows SmartScreen ilk kurulumda uyarı gösterir.

## Bakım

**Yedekleme:** Supabase günlük otomatik yedek alır. Buna ek olarak haftalık manuel dışa aktarma alışkanlığı önerilir (Studio > Database > Backups).

**Sürüm notu:** `vite` ve `@vitejs/plugin-react` bilinçli olarak sabitlendi — `electron-vite` 5 henüz Vite 8'i desteklemiyor. Bu üçlü birlikte yükseltilmelidir.

**Güvenlik override'ları:** `package.json > overrides` içindeki `postcss`, `sharp` ve `brace-expansion` girdileri, üst paketlerin henüz geçmediği yamalı sürümlere sabitler. Üst paketler güncellenince kaldırılabilir.
