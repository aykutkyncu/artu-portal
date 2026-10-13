import { useEffect, useState } from 'react'
import PocketBase, { ClientResponseError, type RecordModel } from 'pocketbase'
import type { User } from './types'

// Arayüz ve API aynı adresten sunulur (PocketBase pb_public).
export const pb = new PocketBase(window.location.origin)
pb.autoCancellation(false)

export function currentUser(): User | null {
  return (pb.authStore.record as User | null) ?? null
}

export function isManager(user: User | null): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin'
}

export function fileUrl(record: RecordModel, filename: string, thumb?: string, token?: string): string {
  return pb.files.getURL(record, filename, { ...(thumb ? { thumb } : {}), ...(token ? { token } : {}) })
}

// Ekler korumalıdır: indirmek için kısa ömürlü (≈3 dk) dosya anahtarı gerekir.
const FILE_TOKEN_TTL_MS = 2 * 60 * 1000
let cachedToken: { value: string; at: number } | null = null
let pending: Promise<string> | null = null

export async function getFileToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.at < FILE_TOKEN_TTL_MS) return cachedToken.value
  pending ??= pb.files
    .getToken()
    .then((value) => {
      cachedToken = { value, at: Date.now() }
      return value
    })
    .finally(() => {
      pending = null
    })
  return pending
}

/** Bileşenlerde korumalı dosya bağlantıları için güncel anahtar. */
export function useFileToken(): string | null {
  const [token, setToken] = useState<string | null>(cachedToken && Date.now() - cachedToken.at < FILE_TOKEN_TTL_MS ? cachedToken.value : null)
  useEffect(() => {
    let alive = true
    const refresh = () => void getFileToken().then((t) => alive && setToken(t)).catch(() => undefined)
    refresh()
    const id = setInterval(refresh, FILE_TOKEN_TTL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return token
}

export function avatarUrl(user: User | undefined | null): string | null {
  if (!user?.avatar) return null
  return fileUrl(user, user.avatar, '100x100')
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif)$/i
export function isImage(filename: string): boolean {
  return IMAGE_EXT.test(filename)
}

/** PocketBase dosya adlarındaki rastgele soneki temizler: rapor_ab12cd34ef.pdf → rapor.pdf */
export function displayFilename(filename: string): string {
  return filename.replace(/_[a-z0-9]{10}(\.[^.]+)$/i, '$1')
}

/** Kullanıcıya gösterilecek Türkçe hata mesajı. */
export function errorMessage(err: unknown): string {
  if (err instanceof ClientResponseError) {
    if (err.status === 0) return 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.'
    const fieldErrors = Object.entries(err.response?.data ?? {})
      .map(([field, v]) => `${field}: ${(v as { message?: string })?.message ?? ''}`)
      .join(', ')
    const base = err.response?.message || err.message
    return fieldErrors ? `${base} (${fieldErrors})` : base
  }
  if (err instanceof Error) return err.message
  return 'Beklenmeyen bir hata oluştu.'
}

/** Filtre değerlerini güvenli şekilde gömmek için. */
export const filter = (expr: string, params: Record<string, unknown>) => pb.filter(expr, params)
