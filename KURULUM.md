# Artu Portal – Kurulum Kılavuzu

Artu Portal tek bir programdır (`artu-portal.exe`). Veritabanı, dosyalar, giriş sistemi, anlık mesajlaşma, bildirimler, web arayüzü ve **HTTPS sertifikası** bu programın içindedir. Sunucuya **başka hiçbir şey kurmanız gerekmez** (Node, SQL Server, IIS, Cloudflare vb. gerekmez).

Adres: **https://portal.artucikolata.com.tr**

```
C:\ArtuPortal\
├── artu-portal.exe      ← program
├── pb_public\           ← web arayüzü (güncellemede değişir)
└── pb_data\             ← VERİTABANI + dosyalar + yedekler + SSL sertifikası (ilk çalıştırmada oluşur, ASLA silmeyin)
```

---

## 0. Ön kontroller (kuruluma başlamadan)

1. **Sabit dış IP:** Şirket internetinin sabit bir dış IP'si olmalı. Bilmiyorsanız internet sağlayıcınıza sorun veya sunucuda https://ifconfig.me adresine birkaç gün arayla bakın. IP değişiyorsa sağlayıcıdan sabit IP isteyin; genelde düşük ücretli veya ücretsizdir.
2. **80 ve 443 portları boş mu?** Logo sunucusunda IIS veya başka bir web servisi bu portları kullanıyor olabilir. Kontrol edin:
   ```powershell
   Get-NetTCPConnection -State Listen -LocalPort 80,443 -ErrorAction SilentlyContinue
   ```
   Sonuç boşsa portlar boştur. Doluysa bölüm 2'deki **"Portlar doluysa"** notuna bakın.

---

## 1. DNS kaydı (IdeaSoft paneli)

Alan adınızın DNS'i IdeaSoft'ta (e-ticaret siteniz). **Mevcut kayıtlara dokunmadan** sadece bir kayıt ekleyeceksiniz:

| Tür | Ad | Değer |
|---|---|---|
| A | `portal` | Şirketin sabit dış IP adresi |

Mağaza (www) ve Microsoft 365 e-posta kayıtları **değişmez**. Kaydın yayılması birkaç dakika ile birkaç saat sürebilir. Kontrol etmek için:
```powershell
Resolve-DnsName portal.artucikolata.com.tr
```

---

## 2. Modem / güvenlik duvarı

1. **Modemde port yönlendirme:** Dış 80 ve 443 numaralı TCP portlarını Logo sunucusunun iç IP'sine (ör. `192.168.1.10`) yönlendirin.
   - **Sadece bu iki portu** açın. Logo'nun SQL (1433), RDP (3389) gibi portlarını kesinlikle internete açmayın.
2. **Windows güvenlik duvarında** sadece portal programına izin verin:
   ```powershell
   New-NetFirewallRule -DisplayName "Artu Portal (HTTP/HTTPS)" -Direction Inbound -Program "C:\ArtuPortal\artu-portal.exe" -Protocol TCP -LocalPort 80,443 -Action Allow
   ```

> **Portlar doluysa** (ör. IIS 80/443 kullanıyorsa): Portal farklı iç portlarda çalışabilir. Modemde dış 80 → iç 8080, dış 443 → iç 8443 olarak yönlendirin. Servisi 3. bölümde `--http=0.0.0.0:8080 --https=0.0.0.0:8443` ekiyle kurun ve güvenlik duvarı kuralındaki portları 8080,8443 yapın. Dışarıdan görünen portların 80/443 kalması şarttır, çünkü SSL sertifikası bu portlar üzerinden alınır.

---

## 3. Sunucuya kurulum

> Komutları **Yönetici olarak açılmış** PowerShell'de çalıştırın.

1. Geliştirme bilgisayarında `build.ps1` ile oluşturulan `dist\artu-portal` klasörünü sunucuda `C:\ArtuPortal` olarak kopyalayın.
2. Veritabanını hazırlayın ve ilk yöneticiyi oluşturun (şifre en az 10 karakter):
   ```powershell
   cd C:\ArtuPortal
   .\artu-portal.exe migrate up
   .\artu-portal.exe admin create aykut "GucluBirSifre!2026" "Aykut Koyuncu"
   ```
3. (İsteğe bağlı) Teknik yönetim paneli için süper kullanıcı oluşturun:
   ```powershell
   .\artu-portal.exe superuser upsert it@artucikolata.com.tr "BaskaGucluSifre!2026"
   ```
4. Servisi alan adıyla kurup başlatın. SSL sertifikası ilk açılışta otomatik alınır ve süresi dolmadan kendiliğinden yenilenir:
   ```powershell
   .\artu-portal.exe service install --domain=portal.artucikolata.com.tr,78-188-21-132.sslip.io
   .\artu-portal.exe service start
   .\artu-portal.exe service status
   ```
   > `78-188-21-132.sslip.io`, DNS kaydı eklenene kadar kullanılan **geçici** ve ücretsiz adrestir. sslip.io, adresteki IP'yi otomatik çözen bir servistir. `portal.artucikolata.com.tr` DNS kaydı eklendiği anda ek bir ayar gerekmeden çalışmaya başlar.
5. Telefonunuzun mobil verisinden (Wi-Fi kapalıyken) **https://portal.artucikolata.com.tr** adresini açın ve giriş yapın. İlk açılışta sertifika alınırken birkaç saniye bekleyebilir.

### Teknik yönetim paneli (`/_/`)
Güvenlik için bu panel **sadece sunucunun kendisinden** açılır; internetten ve şirket ağından kapalıdır. Sunucuda bir kez şu satırı `C:\Windows\System32\drivers\etc\hosts` dosyasına ekleyin:
```
127.0.0.1   portal.artucikolata.com.tr
```
Sonra sunucunun tarayıcısında `https://portal.artucikolata.com.tr/_/` adresini açın.

### Şirket içinden erişim
Ofisteki bilgisayarlar da aynı adresi kullanır. Bazı modemler, iç ağdan şirketin kendi dış IP'sine gidişi ("NAT loopback") desteklemez. Ofiste adres açılmıyor ama mobil veriden açılıyorsa iki çözüm var:
- Modemde **NAT loopback / hairpin** ayarını açın, ya da
- İç DNS sunucunuza (veya modemin DNS ayarına) `portal.artucikolata.com.tr → sunucunun iç IP'si` kaydını ekleyin.

### Logo sunucusu için ek güvenlik önlemleri (önerilir)
- Servis varsayılan olarak `LocalSystem` hesabıyla çalışır. Daha güvenli bir yapı için:
  1. Ayrı, yetkisiz bir Windows kullanıcısı açın (ör. `svc-artuportal`).
  2. Bu kullanıcıya sadece `C:\ArtuPortal` klasöründe okuma/yazma izni verin; Logo klasörlerine ve SQL'e hiçbir izin vermeyin.
  3. `services.msc` → Artu Portal → Oturum Aç sekmesinden servisi bu hesapla çalıştırın.
- Portal verisini (`pb_data`) mümkünse Logo veritabanından **farklı bir diskte veya bölümde** tutun. Böylece disk dolarsa Logo etkilenmez. Diskte en az %15 boş alan kalmasını takip edin.
- Windows Update'i açık tutun ve portal güncellemelerini uygulayın.

---

## 4. Çalışanların kurulumu

1. Admin olarak giriş yapın: **Yönetim → Birimler**'den birimleri ekleyin, ardından **Kullanıcılar → Kullanıcı ekle** ile çalışanları açın. Kullanıcı adı, isimden otomatik önerilir (ör. `ayse.kaya`).
2. Çalışanlara `https://portal.artucikolata.com.tr` linkini ve geçici şifreyi iletin. İlk girişte **Profil → Şifre değiştir** yapmalarını isteyin.
3. Kurulum:
   - **Android:** Chrome'da linki açın, menüden (⋮) **Uygulamayı yükle** seçin.
   - **iPhone:** Safari'de linki açın, **Paylaş → Ana Ekrana Ekle** seçin. Ardından uygulamayı **ana ekrandan** açın; bildirimler sadece bu şekilde çalışır (iOS 16.4 ve üzeri).
   - **Bilgisayar:** Chrome veya Edge'de adres çubuğundaki **Yükle** simgesine tıklayın.
4. Uygulama ilk açıldığında **Bildirimleri aç** butonuna basın.

**Roller:**

| Rol | Neler yapabilir |
|---|---|
| Personel | Duyuruları okur, mesajlaşır, takvime etkinlik ekler, kendine atanan görevin durumunu değiştirir |
| Birim Sorumlusu | Bunlara ek olarak duyuru yayınlar, vardiya ve üretim planı girer, tüm görevleri görür |
| Admin | Her şeyi yapar; kullanıcı ve birimleri yönetir |

İşten ayrılan çalışanı **silmeyin, pasifleştirin**. Pasif kullanıcının oturumu anında kapanır ve tekrar giriş yapamaz, ama mesaj geçmişi korunur.

---

## 5. Yedekleme

- Portal her gece **03:00**'te `C:\ArtuPortal\pb_data\backups` klasörüne otomatik yedek (zip) alır ve son 14 yedeği saklar.
- Bu yedekler aynı diskte durur. Kendi yedekleme düzeninize `pb_data\backups` klasörünü (veya tüm `pb_data` klasörünü) dahil edin.
- Tam geri yükleme için: servisi durdurun, `pb_data` klasörünü yedekteki haliyle değiştirin, servisi başlatın.

---

## 6. Güncelleme

```powershell
cd C:\ArtuPortal
.\artu-portal.exe service stop
# yeni artu-portal.exe ve pb_public klasörünü kopyalayın (pb_data'ya DOKUNMAYIN)
.\artu-portal.exe migrate up
.\artu-portal.exe service start
```

Kullanıcıların telefonundaki uygulama bir sonraki açılışta kendini otomatik günceller.

---

## 7. Sorun giderme

| Belirti | Çözüm |
|---|---|
| Servis başlamıyor / sürekli yeniden başlıyor | `C:\ArtuPortal\servis-hata.log` dosyasına bakın veya servisi durdurup `.\artu-portal.exe serve portal.artucikolata.com.tr` ile elle çalıştırın; hata ekranda görünür |
| "address already in use" hatası | 80/443 başka bir programda. Bölüm 2'deki "Portlar doluysa" notunu uygulayın |
| Sertifika alınamıyor / tarayıcı güvenli değil diyor | DNS kaydı doğru IP'yi gösteriyor mu (`Resolve-DnsName`)? Modemde 80 ve 443 yönlendirmesi var mı? Güvenlik duvarı kuralı eklendi mi? |
| Mobil veriden açılıyor, ofisten açılmıyor | Bölüm 3, "Şirket içinden erişim" |
| Bildirim gelmiyor | Adres https ile mi açılıyor? iPhone'da uygulama ana ekrandan mı açıldı? Profil sayfasındaki bildirim durumunu kontrol edin |
| Şifresini unutan çalışan | Admin → Yönetim → Kullanıcılar → düzenle → yeni şifre |
| Sistem kayıtları | Sunucuda `https://portal.artucikolata.com.tr/_/` → Logs (bölüm 3'teki hosts ayarı gerekli) |

---

## Ek A – FortiGate 40F ayarı

Ağ bilgileri: dış IP `78.188.21.132` (internet `lan3` bacağında, PPPoE), iç ağ `lan` (192.168.2.0/24), Logo sunucusu `192.168.2.116`. Dikkat: `wan` bacağı kullanılmıyor.

**Önce kontrol edin (çakışma olmasın):** FortiGate'in kendi yönetim paneli wan bacağında 443 veya 80 portunu kullanıyorsa, portal ile çakışır. FortiGate CLI'de (panelde sağ üstteki `>_` simgesi) şunları çalıştırın:
```
get system global | grep admin-sport
show system interface lan3 | grep allowaccess
```
- `allowaccess` satırında `https` veya `http` varsa yönetim paneli internete açık demektir. Bu hem çakışma yaratır hem de güvenlik riskidir. Çıkarın:
  ```
  config system interface
      edit "lan3"
          set allowaccess ping
      next
  end
  ```
  Bu komut `allowaccess` satırını tamamen yeniden yazar. Satırda `ping` dışında tutmak istediğiniz başka bir değer varsa (ör. `fgfm`), onu da komuta ekleyin.
  Bundan sonra FortiGate paneline sadece ofis içinden (FortiGate'in iç IP adresinden) erişilir.

**Kurallar:** CLI'ye aşağıdakini olduğu gibi yapıştırın.
```
config firewall vip
    edit "artu-portal-80"
        set extip 78.188.21.132
        set mappedip "192.168.2.116"
        set extintf "any"
        set portforward enable
        set extport 80
        set mappedport 80
    next
    edit "artu-portal-443"
        set extip 78.188.21.132
        set mappedip "192.168.2.116"
        set extintf "any"
        set portforward enable
        set extport 443
        set mappedport 443
    next
end
config firewall policy
    edit 0
        set name "Artu Portal - Internetten"
        set srcintf "lan3"
        set dstintf "lan"
        set srcaddr "all"
        set dstaddr "artu-portal-80" "artu-portal-443"
        set action accept
        set schedule "always"
        set service "HTTP" "HTTPS"
        set logtraffic all
    next
    edit 0
        set name "Artu Portal - Ofis ici"
        set srcintf "lan"
        set dstintf "lan"
        set srcaddr "all"
        set dstaddr "artu-portal-80" "artu-portal-443"
        set action accept
        set schedule "always"
        set service "HTTP" "HTTPS"
        set nat enable
    next
end
```
- İlk kural internetten gelenleri sunucuya iletir.
- İkinci kural, ofis içinden `portal.artucikolata.com.tr` adresinin açılmasını sağlar (NAT loopback).
- `edit 0` yeni kural oluşturur; mevcut kurallarınıza dokunmaz.
- Kurallar listenin sonuna eklenir. Daha üstte, bu trafiği engelleyen bir "deny" kuralınız varsa, panelde **Policy & Objects → Firewall Policy** ekranında yeni kuralları onun üstüne sürükleyin.
- Arayüzlerinizin adı `wan` / `lan` değilse (ör. `wan1`, `internal`), komutlardaki adları kendi adlarınızla değiştirin. Adları görmek için: `get system interface | grep name`.

**İsteğe bağlı – saldırı koruması:** FortiGate lisansınızda IPS varsa, internet kuralına IPS profili ekleyebilirsiniz. Bunun için panelde kuralı açıp **Security Profiles → IPS → default** seçin.

---

## Kaynak kullanımı

50 kullanıcı için yaklaşık 50–150 MB RAM ve çok düşük CPU kullanır, Logo'yu etkilemez. Disk kullanımı çoğunlukla yüklenen fotoğraf ve dosyalardan gelir. Fotoğraflar telefonda yüklenmeden önce otomatik küçültülür (yaklaşık 300–600 KB). Dosya başına sınır 10 MB'dır.
