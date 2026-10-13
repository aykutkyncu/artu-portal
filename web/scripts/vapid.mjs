// Bildirim anahtarlarını üretir (bir kez çalıştırılır): node web/scripts/vapid.mjs [supabase-proje-kodu]
// Gizli anahtarlar ekrana YAZILMAZ; proje klasöründeki "bildirim-anahtarlari.txt" dosyasına kaydedilir
// (git'e gönderilmez). Ekrana sadece herkese açık anahtar yazılır. Adımlar KURULUM.md 3. bölümde.
// Anahtarlar değişirse herkesin "Bildirimleri aç" düğmesine yeniden basması gerekir; bu yüzden dosya varken üzerine yazılmaz.
import { createECDH, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const target = fileURLToPath(new URL('../../bildirim-anahtarlari.txt', import.meta.url))
if (existsSync(target)) {
  console.error(`Anahtarlar zaten üretilmiş: ${target}\nYeniden üretmek için önce bu dosyayı silin (mevcut bildirim abonelikleri geçersiz olur).`)
  process.exit(1)
}

const project = process.argv[2] ?? '<proje-kodu>'
const ecdh = createECDH('prime256v1')
ecdh.generateKeys()
const publicKey = ecdh.getPublicKey().toString('base64url')
const privateKey = Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32).toString('base64url')
const pushSecret = randomBytes(32).toString('hex')

writeFileSync(
  target,
  `ARTU PORTAL - BİLDİRİM ANAHTARLARI (GİZLİ: kimseyle paylaşmayın, sohbete yapıştırmayın)

1) Supabase > Edge Functions > Secrets ekranına şu üçünü ekleyin:

VAPID_PUBLIC_KEY
${publicKey}

VAPID_PRIVATE_KEY
${privateKey}

PUSH_SECRET
${pushSecret}

2) Supabase > SQL Editor > New query ekranında şunu çalıştırın:

update private.settings
   set push_url = 'https://${project}.supabase.co/functions/v1/bildirim',
       push_secret = '${pushSecret}';
select 'bildirim ayarı' as kontrol, case when push_url <> '' and push_secret <> '' then 'tamam' else 'eksik' end as sonuc from private.settings;
`,
)

console.log(`Anahtarlar kaydedildi: ${target}`)
console.log(`VAPID_PUBLIC_KEY (gizli değil): ${publicKey}`)
