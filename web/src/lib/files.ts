import { useEffect, useState } from 'react'
import { supabase } from './db'
import type { User } from './types'
import { compressImage, resizeImage } from './upload'

// Dosya alanları ve erişim kuralları: supabase/migrations/001_baslangic.sql ("dosyalar" bölümü).
const ATTACHMENTS = 'ekler' // gizli; kaydı görebilen eki de görür
const AVATARS = 'avatars' // herkese açık adres

export type AttachmentFolder = 'messages' | 'announcements' | 'tasks'
export const MAX_ATTACHMENTS = 5

const THUMB_SUFFIX = '.t.jpg'
const THUMB_WIDTH = 480
const SIGNED_URL_SECONDS = 60 * 60
const SIGNED_URL_REUSE_MS = 45 * 60 * 1000

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif)$/i
export function isImage(path: string): boolean {
  return IMAGE_EXT.test(path)
}

const TURKISH: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' }

/** Depolama anahtarında sorun çıkarmayan dosya adı: "Üretim Planı (2).pdf" → "Uretim_Plani_2.pdf" */
function safeName(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : ''
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => TURKISH[ch] ?? ch)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
  return `${base || 'dosya'}${ext ? `.${ext}` : ''}`
}

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10)
}

/** Dosya yolundan kullanıcıya gösterilecek ad: messages/<id>/ab12cd34ef_rapor.pdf → rapor.pdf */
export function displayFilename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/^[a-z0-9]{10}_/, '')
}

/**
 * Ekleri yükler ve kayda yazılacak dosya yollarını döndürür. Fotoğraflar önce küçültülür;
 * listelerde hızlı açılsın diye ayrıca küçük bir önizleme kaydedilir.
 * `recordId`: mesajda sohbetin, duyuru ve görevde kaydın kendi id'si.
 */
export async function uploadAttachments(folder: AttachmentFolder, recordId: string, files: File[]): Promise<string[]> {
  const paths: string[] = []
  for (const original of files) {
    const file = await compressImage(original)
    const path = `${folder}/${recordId}/${randomId()}_${safeName(file.name)}`
    const { error } = await supabase.storage.from(ATTACHMENTS).upload(path, file, { contentType: file.type || undefined, cacheControl: '31536000' })
    if (error) {
      await removeAttachments(paths)
      throw error
    }
    paths.push(path)

    const thumb = await resizeImage(file, THUMB_WIDTH, 0.7)
    if (thumb) await supabase.storage.from(ATTACHMENTS).upload(path + THUMB_SUFFIX, thumb, { contentType: 'image/jpeg', cacheControl: '31536000' })
  }
  return paths
}

/** Silinen kaydın dosyalarını kaldırır (yer açmak için; başarısız olursa sessizce geçer). */
export async function removeAttachments(paths: string[]): Promise<void> {
  if (!paths?.length) return
  await supabase.storage
    .from(ATTACHMENTS)
    .remove(paths.flatMap((p) => [p, p + THUMB_SUFFIX]))
    .catch(() => undefined)
}

// Ekler gizlidir: indirmek için kısa ömürlü imzalı bağlantı alınır.
const signedCache = new Map<string, { url: string | null; at: number }>()

async function signPaths(paths: string[]): Promise<void> {
  const now = Date.now()
  const missing = paths.filter((p) => {
    const hit = signedCache.get(p)
    return !hit || now - hit.at > SIGNED_URL_REUSE_MS
  })
  if (missing.length === 0) return
  const { data, error } = await supabase.storage.from(ATTACHMENTS).createSignedUrls(missing, SIGNED_URL_SECONDS)
  if (error) throw error
  data.forEach((item, i) => signedCache.set(missing[i]!, { url: item.error ? null : item.signedUrl, at: now }))
}

export interface AttachmentLink {
  path: string
  /** Dosyanın kendisi */
  url: string | null
  /** Fotoğraflarda küçük önizleme (yoksa dosyanın kendisi) */
  preview: string | null
}

/** Eklerin bağlantıları; hazır olana kadar `null` döner. */
export function useAttachmentLinks(paths: string[] | undefined): AttachmentLink[] | null {
  const key = (paths ?? []).join('|')
  const [links, setLinks] = useState<AttachmentLink[] | null>(null)

  useEffect(() => {
    const list = key ? key.split('|') : []
    if (list.length === 0) return setLinks([])
    let alive = true
    const load = async () => {
      await signPaths(list.flatMap((p) => (isImage(p) ? [p, p + THUMB_SUFFIX] : [p]))).catch(() => undefined)
      if (!alive) return
      setLinks(
        list.map((path) => {
          const url = signedCache.get(path)?.url ?? null
          return { path, url, preview: signedCache.get(path + THUMB_SUFFIX)?.url ?? url }
        }),
      )
    }
    void load()
    // Açık kalan sayfada bağlantıların süresi dolmadan yenilenir.
    const timer = setInterval(() => void load(), SIGNED_URL_REUSE_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [key])

  return links
}

// ---------------------------------------------------------------- profil fotoğrafı

export function avatarUrl(user: User | undefined | null): string | null {
  if (!user?.avatar) return null
  return supabase.storage.from(AVATARS).getPublicUrl(user.avatar).data.publicUrl
}

/** Profil fotoğrafını küçültüp yükler; profile yazılacak dosya yolunu döndürür. */
export async function uploadAvatar(userId: string, file: File, previousPath: string): Promise<string> {
  const small = await resizeImage(file, 320, 0.85)
  if (!small) throw new Error('Fotoğraf okunamadı. JPG ya da PNG bir dosya seçin.')
  const path = `${userId}/${randomId()}.jpg`
  const { error } = await supabase.storage.from(AVATARS).upload(path, small, { contentType: 'image/jpeg', cacheControl: '31536000' })
  if (error) throw error
  if (previousPath) await supabase.storage.from(AVATARS).remove([previousPath]).catch(() => undefined)
  return path
}
