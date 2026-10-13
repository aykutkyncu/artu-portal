// PWA ve tarayıcı ikonlarını şirket logosundan (public/logo.webp) üretir: node scripts/icons.mjs
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../public/logo.webp', import.meta.url))
const out = (name) => fileURLToPath(new URL(`../public/icons/${name}`, import.meta.url))
const BRAND_BG = '#4a2c1d' // uygulamanın çikolata kahvesi; sarı logo üzerinde net görünür

/** Logoyu kare zemin üzerine ortalar. ratio: logonun kare genişliğine oranı. */
async function square(size, ratio, file, { radius = 0 } = {}) {
  const logo = await sharp(src).resize({ width: Math.round(size * ratio), fit: 'inside' }).png().toBuffer()
  const bg = radius
    ? Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND_BG}"/></svg>`)
    : { create: { width: size, height: size, channels: 4, background: BRAND_BG } }
  await sharp(bg).composite([{ input: logo, gravity: 'center' }]).png().toFile(out(file))
}

await square(192, 0.86, 'icon-192.png', { radius: 40 })
await square(512, 0.86, 'icon-512.png', { radius: 108 })
await square(180, 0.84, 'apple-touch-icon.png') // iOS köşeleri kendisi yuvarlar
await square(512, 0.68, 'icon-maskable-512.png') // Android maskesi için güvenli alan
await square(64, 0.92, 'favicon-64.png', { radius: 12 })
console.log('ikonlar üretildi')
