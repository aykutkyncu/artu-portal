// Bildirim anahtarlarını üretir (bir kez çalıştırılır): node web/scripts/vapid.mjs
// Çıktıdaki değerlerin nereye yazılacağı KURULUM.md'de anlatılır.
// VAPID_PRIVATE_KEY ve PUSH_SECRET gizlidir: koda, git'e ya da sohbete yapıştırmayın.
// Anahtarlar değişirse herkesin "Bildirimleri aç" düğmesine yeniden basması gerekir.
import { createECDH, randomBytes } from 'node:crypto'

const ecdh = createECDH('prime256v1')
ecdh.generateKeys()
const privateKey = Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32)

console.log(`
Supabase > Edge Functions > Secrets (üçü de):
  VAPID_PUBLIC_KEY   = ${ecdh.getPublicKey().toString('base64url')}
  VAPID_PRIVATE_KEY  = ${privateKey.toString('base64url')}
  PUSH_SECRET        = ${randomBytes(32).toString('hex')}

Render > Environment (ve yerelde web/.env.local):
  VITE_VAPID_PUBLIC_KEY = (yukarıdaki VAPID_PUBLIC_KEY ile aynı)

Supabase > SQL Editor (PUSH_SECRET yukarıdakiyle aynı olmalı):
  update private.settings
     set push_url = 'https://<proje-kodu>.supabase.co/functions/v1/bildirim',
         push_secret = '<PUSH_SECRET>';
`)
