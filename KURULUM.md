# Artu Portal – Kurulum Kılavuzu

Artu Portal, depo sevk programıyla aynı düzende çalışır: **sunucuya hiçbir şey kurulmaz.**

| Parça | Nerede durur |
|---|---|
| Web arayüzü (telefona da kurulur) | Render – ücretsiz statik site, GitHub'a her push'ta kendiliğinden yayınlanır |
| Veritabanı, giriş, dosyalar, anlık mesajlaşma | Supabase – ücretsiz proje |
| Telefon bildirimleri | Supabase Edge Function (`bildirim`) |

Logo sunucusuna, modeme, FortiGate'e ve DNS'e dokunulmaz.

```
web/                              arayüz (React)
supabase/migrations/              veritabanı şeması ve yetki kuralları (numaralı, sırayla çalıştırılır)
supabase/functions/bildirim/      bildirim gönderen fonksiyon
supabase/tests/                   veritabanı kuralları ve bildirim testleri (npm test)
render.yaml                       Render yayın ayarı
```

---

## 1. Supabase projesi

1. https://supabase.com → **New project**. Bölge: **Frankfurt**. Veritabanı şifresini saklayın.
   - Portal için **ayrı bir proje** açın (depo sevk projesinin içine kurmayın). Ücretsiz hesapta proje sayısı sınırlıdır; yer yoksa panel uyarır.
2. **Authentication → Sign In / Providers → Email**: **Allow new users to sign up** seçeneğini **kapatın**. Kullanıcıları sadece admin açar.
3. **SQL Editor → New query**: `supabase/migrations/` klasöründeki dosyaları **numara sırasıyla**, her birinin tamamını yapıştırıp **Run** diyerek çalıştırın. `001_baslangic.sql` sonunda iki satır çıkmalı: tablo sayısı **13**, dosya alanı sayısı **2**. `002_kullanici_silme.sql` sonunda tek satır: **1**.
4. İlk admin hesabını açın (şifre en az 10 karakter). Aynı ekranda:
   ```sql
   select private.create_user('aykut', 'GucluBirSifre!2026', 'Aykut Koyuncu', 'admin');
   ```
   Diğer herkesi uygulamanın içinden, **Yönetim → Kullanıcılar** ekranından açarsınız.
5. **Project Settings → API** ekranından iki değeri not edin: **Project URL** ve **Publishable (anon) key**.

> Giriş kullanıcı adıyladır (ör. `ayse.kaya`). Supabase'in Users listesinde hesaplar `ayse.kaya@portal.artucikolata.com.tr` biçiminde görünür; bu adres sadece giriş kimliğidir, e-posta gönderilmez.

---

## 2. Yayın (GitHub + Render)

1. GitHub'da **gizli** bir depo açın (ör. `artu-portal`) ve bu klasörü gönderin:
   ```powershell
   git remote add origin https://github.com/<hesap>/artu-portal.git
   git push -u origin main
   ```
2. https://dashboard.render.com → **New → Blueprint** → depoyu seçin. Render `render.yaml` dosyasını okur ve üç değer sorar:

   | Değişken | Değer |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase Project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |
   | `VITE_VAPID_PUBLIC_KEY` | 3. bölümde üretilir; şimdilik boş bırakılabilir |

3. Yayın bitince adres `https://artu-portal.onrender.com` gibi olur. Açıp 1. bölümde oluşturduğunuz admin hesabıyla giriş yapın.

Bundan sonra `main` dalına her push birkaç dakika içinde yayınlanır. Açık uygulamalar bir sonraki açılışta kendini günceller.

**İsteğe bağlı – kendi adresiniz:** `portal.artucikolata.com.tr` kullanmak isterseniz Render'da **Settings → Custom Domains** ekranına adresi yazın ve Render'ın gösterdiği **CNAME** kaydını IdeaSoft DNS paneline ekleyin. Sertifikayı Render kendisi alır. Mevcut kayıtlara dokunmayın.

---

## 3. Telefon bildirimleri

Bu bölüm atlanırsa uygulama çalışır, sadece bildirim gitmez.

1. Anahtarları üretin (bir kez):
   ```powershell
   node web/scripts/vapid.mjs
   ```
   Çıktıdaki `VAPID_PRIVATE_KEY` ve `PUSH_SECRET` gizlidir; kimseyle paylaşmayın, koda yazmayın.
2. Supabase → **Edge Functions → Deploy a new function → Via Editor**:
   - Ad: `bildirim`
   - `supabase/functions/bildirim/index.ts` dosyasının tamamını yapıştırın.
   - **Verify JWT** seçeneğini **kapatın** (istek veritabanından gelir; ortak anahtarla doğrulanır).
   - **Deploy**.
3. Supabase → **Edge Functions → Secrets**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_SECRET` değerlerini ekleyin.
4. **SQL Editor**'de fonksiyonun adresini ve ortak anahtarı veritabanına tanıtın (`<proje-kodu>` Project URL'deki koddur):
   ```sql
   update private.settings
      set push_url = 'https://<proje-kodu>.supabase.co/functions/v1/bildirim',
          push_secret = '<PUSH_SECRET>';
   ```
5. Render → **Environment**: `VITE_VAPID_PUBLIC_KEY` = `VAPID_PUBLIC_KEY` değeri. Kaydedip **Manual Deploy** deyin.
6. Deneme: telefonda uygulamayı açıp **Bildirimleri aç**'a basın, başka bir hesaptan kendinize mesaj gönderin. Gelmezse Supabase → Edge Functions → bildirim → **Logs** ekranına bakın.

Fonksiyonun kodu değişirse panelde yeniden yapıştırıp Deploy etmek gerekir; `git push` fonksiyonu yayınlamaz.

---

## 4. Çalışanların kurulumu

1. Admin olarak giriş yapın: **Yönetim → Birimler**'den birimleri ekleyin, ardından **Kullanıcılar → Kullanıcı ekle** ile çalışanları açın. Kullanıcı adı, isimden otomatik önerilir (ör. `ayse.kaya`).
2. Çalışanlara portal adresini ve geçici şifreyi iletin. İlk girişte **Profil → Şifre değiştir** yapmalarını isteyin.
3. Kurulum:
   - **Android:** Chrome'da adresi açın, menüden (⋮) **Uygulamayı yükle** seçin.
   - **iPhone:** Safari'de adresi açın, **Paylaş → Ana Ekrana Ekle** seçin. Ardından uygulamayı **ana ekrandan** açın; bildirimler sadece bu şekilde çalışır (iOS 16.4 ve üzeri).
   - **Bilgisayar:** Chrome veya Edge'de adres çubuğundaki **Yükle** simgesine tıklayın.
4. Uygulama ilk açıldığında **Bildirimleri aç** butonuna basın.

**Roller:**

| Rol | Neler yapabilir |
|---|---|
| Personel | Duyuruları okur, mesajlaşır, takvime etkinlik ekler, kendine atanan görevin durumunu değiştirir |
| Birim Sorumlusu | Bunlara ek olarak duyuru yayınlar, vardiya ve üretim planı girer, tüm görevleri görür |
| Admin | Her şeyi yapar; kullanıcı ve birimleri yönetir |

İşten ayrılan çalışanı **pasifleştirin**: pasif kullanıcı hiçbir veriye erişemez ve tekrar giriş yapamaz, mesaj geçmişi korunur. **Kullanıcıyı sil** düğmesi sadece hiç kayıt bırakmamış hesaplarda (ör. yanlış açılmış hesap) çalışır; mesajı, duyurusu ya da görevi olan hesap silinemez. Admin, düzenleme ekranından herkesin şifresini değiştirebilir.

Mesajlar özeldir: bir sohbeti sadece üyeleri görür, admin de göremez.

---

## 5. Ücretsiz plan sınırları

| | Sınır | Not |
|---|---|---|
| Supabase veritabanı | 500 MB | Mesaj ve kayıtlar için yıllarca yeter |
| Supabase dosya alanı | 1 GB | Fotoğraflar yüklenmeden önce küçültülür (≈300–600 KB). Yaklaşık 2.000–3.000 fotoğraf. Dosya başına sınır 10 MB |
| Supabase veri çıkışı | 5 GB / ay | |
| Supabase anlık bağlantı | 200 kişi aynı anda | |
| Render | ≈5 GB / ay bant genişliği | Aşılırsa ay sonuna kadar askıya alınır |

Sınırlar değişebilir; güncel değerler Supabase ve Render panellerindeki **Usage** ekranlarında görünür. Bir hafta boyunca hiç kullanılmayan ücretsiz Supabase projesi duraklatılır; panelden tek tıkla yeniden açılır.

**Yedek:** ücretsiz planda Supabase otomatik yedek vermez ve portal için henüz yedek düzeni kurulmadı. Depo sevk programındaki gibi haftalık GitHub yedeği istenirse eklenebilir.

---

## 6. Güncelleme

- **Arayüz:** kod değişikliği `main`'e push edilir, Render yayınlar.
- **Veritabanı:** yeni numaralı dosya (`supabase/migrations/002_….sql`) yazılır, içeriği SQL Editor'de çalıştırılır, **sonra** kod push edilir. SQL çalışmadan push edilirse canlı uygulama hata verir.
- **Bildirim fonksiyonu:** panelde yeniden yapıştırılıp Deploy edilir.

---

## 7. Sorun giderme

| Belirti | Çözüm |
|---|---|
| "Kurulum tamamlanmamış" ekranı | Render'da `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` girilmemiş. Girip Manual Deploy deyin |
| Giriş: "Kullanıcı adı veya şifre hatalı" | Hesap 1. bölümdeki SQL ile ya da Yönetim ekranından mı açıldı? Admin yeni şifre verebilir |
| Giriş: "Hesabınız pasif" | Yönetim → Kullanıcılar → "Pasifleri göster" → düzenle → Hesap aktif |
| Giriş yapılıyor ama her yer boş | `001_baslangic.sql` çalıştırılmamış ya da yarım kalmış. Yeniden çalıştırın (veriyi silmez) |
| Bildirim gelmiyor | 3. bölümün her adımı tamam mı? "Verify JWT" kapalı mı? iPhone'da uygulama ana ekrandan mı açıldı? Edge Functions → bildirim → Logs |
| Dosya yüklenmiyor | Dosya 10 MB'tan büyük ya da türü desteklenmiyor olabilir. Dosya alanı (1 GB) dolmuş olabilir: Supabase → Usage |
| Şifresini unutan çalışan | Admin → Yönetim → Kullanıcılar → düzenle → yeni şifre |
| Proje duraklatılmış | Supabase paneli → **Restore project** |

---

## 8. Geliştirme

```powershell
cd web
copy .env.example .env.local     # Supabase bilgilerini girin
npm install
npm run dev                      # http://localhost:5173
npm run build                    # Render de bunu çalıştırır; hata vermemeli
npm run lint
```

Veritabanı kuralları ve bildirim testleri (canlı sisteme dokunmaz, bellekte çalışır):

```powershell
cd supabase/tests
npm install
npm test
```

Yetkiler hem arayüzde hem veritabanında (RLS) uygulanır; biri değişirse diğeri de güncellenmelidir.
