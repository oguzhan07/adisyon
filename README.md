# Kokoreççi — QR Menü + Adisyon + Stok Sistemi

> **In English:** A point-of-sale, QR menu and stock control system built for a kokoreç
> restaurant in Turkey. It has been running the shop's daily operation since it was installed.
>
> Two applications share one PostgreSQL database: a **Next.js QR menu** that customers open by
> scanning the code on their table, and an **Electron cash register** on the shop's Windows PC
> that handles orders, split payments, recipe-based stock consumption, reporting and thermal
> receipt printing.
>
> About 13,000 lines · a 23-table schema with views, triggers and stored functions · Row Level
> Security · money and unit-conversion logic unit-tested in a package shared by both apps.
>
> The "Önemli tasarım kararları" section below explains why each of these choices was made.
>
> 
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

Çıktı: `%USERPROFILE%\adisyon-release\` (örn. `C:\Users\oguzh\adisyon-release\`).

> **Neden OneDrive dışında:** Proje OneDrive klasöründe. Paketleme sırasında OneDrive senkronizasyonu dosyaları kilitliyor ve derleme `EPERM: rename win-unpacked.tmp` hatasıyla düşüyor. Bu yüzden çıktı klasörü OneDrive dışına alındı. Kod imzalama sertifikası olmadığı için Windows SmartScreen ilk kurulumda uyarı gösterir; **Daha fazla bilgi → Yine de çalıştır** ile geçilir.

---

## Yazıcı (80mm termal — sahada ACLAS PP7_M3 ile test edildi)

İki bağlantı yolu desteklenir.

### USB — yeni bir bilgisayarda sıfırdan kurulum

**1. Yazıcıyı bağla.** USB kablosunu tak, yazıcıyı aç. Windows cihazı görür ama
yazdırma kuyruğunu otomatik oluşturmayabilir; o yüzden elle oluşturuyoruz.

**2. Windows'ta yazıcı kuyruğu oluştur.**

*Arayüzle:* Başlat → Ayarlar → Bluetooth ve cihazlar → Yazıcılar ve tarayıcılar →
**Cihaz ekle** → yazıcı bulunamazsa **"İstediğim yazıcı listede yok"** →
**"El ile yapılan ayarlarla yerel yazıcı ekle"** →
Bağlantı noktası: **USB001** (birden fazla USB portu varsa USB002/USB003 denenir) →
Üretici **Generic**, yazıcı **Generic / Text Only** →
Ad: **ACLAS80** (bu adı programa gireceksiniz) →
Paylaşım sorarsa **"Bu yazıcıyı paylaşma"** → Test sayfası yazdırmadan **Son**.

*PowerShell ile (yönetici olarak):*
```powershell
Add-PrinterDriver -Name "Generic / Text Only"
Add-Printer -Name "ACLAS80" -DriverName "Generic / Text Only" -PortName "USB001"
```

Hangi USB portunun doğru olduğundan emin değilseniz:
```powershell
Get-PrinterPort | Where-Object Name -like "USB*" | Select-Object Name
```

**3. Programda seç.** Kasa programı → **Ayarlar → Yazıcı** → bağlantı türü **USB** →
açılır menüden yazıcıyı **seçin** (elle yazmaya gerek yok; liste Windows'tan gelir,
yeni yazıcı eklediyseniz **Yenile**'ye basın) → satır genişliği **48** → **Kaydet**.

**4. Test et.** **Test fişi bas** → fiş çıkmalı ve otomatik kesilmeli.

> Paylaşım (`\localhostyazıcı`) **gerekmez** ve **yönetici izni istemez**.
> Ham veri, Windows spooler API'sine (winspool, datatype=RAW) küçük bir yardımcı
> program üzerinden gönderilir; native npm modülü de kullanılmaz.

### Sık karşılaşılan sorunlar

| Belirti | Sebep / çözüm |
|---|---|
| Kağıt çıkıyor ama boş | Termal kağıt ters takılı. Tırnakla sürtün — koyu iz bırakan yüz yazıcı kafasına bakmalı |
| "Yazıcı bulunamadı" | Seçili yazıcı Windows'tan kaldırılmış. Ayarlar → Yazıcı → **Yenile** → tekrar seçin |
| Hiç tepki yok | Yanlış USB portu. Başka `USB00x` ile kuyruk oluşturun |
| Çekmece açılmıyor | Kablo LAN portuna takılı olabilir; **DK** portuna takılmalı. Çekmecenin anahtarı kilitli olmasın |

### Ağ (Ethernet)

Yazıcının IP'sini öğrenin, `ping` ile erişimi doğrulayın, ayarlarda *Ağ* seçip
IP ve portu (9100) girin. Birden fazla kasa olacaksa bu yol daha taşınabilirdir.

### Kasa çekmecesi

Çekmecenin RJ11/RJ12 kablosu **yazıcının DK / CASH DRAWER portuna** takılır
(bilgisayara değil; gücü yazıcı verir). Çekmece şu durumlarda açılır:

- Nakit **ödeme eklendiğinde** (para üstü için)
- **Kapat ve fiş bas** / **Ödeme almadan kapat**
- Ödeme ekranındaki **Kasayı aç** butonuyla elle

Ayarlar → Yazıcı bölümünden kapatılabilir.

### Türkçe karakterler

Sahadaki cihaz standart `ESC t 13` (PC857) komutunu uygulamadığı için Türkçe
karakterler bozuk çıkıyordu. Bu yüzden fiş metinleri **ASCII'ye sadeleştiriliyor**
("Yarım Ekmek Kokoreç" → "Yarim Ekmek Kokorec"). Tek kapı:
`apps/pos/electron/printer/templates.ts` içindeki `asciify()`. Doğru kod sayfası
bulunursa bu fonksiyonu kaldırmak yeterli.

### Fiş düzeni

Başlık ve TOPLAM iri (çift genişlik+yükseklik), ürün satırları çift yükseklik,
satır genişliği 48 karakter. Fişte yazdırma tarih+saati de basılır.

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
