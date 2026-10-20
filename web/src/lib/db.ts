import { createClient } from '@supabase/supabase-js'
import type { User } from './types'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Supabase bilgileri girilmemişse uygulama kurulum uyarısı gösterir (bkz. KURULUM.md). */
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'eksik')

// Giriş kullanıcı adıyladır; Supabase'deki hesap e-postası bu alan adıyla üretilir
// (veritabanındaki karşılığı: private.login_email).
const LOGIN_DOMAIN = 'portal.artucikolata.com.tr'
export function loginEmail(identity: string): string {
  const value = identity.trim().toLowerCase()
  return value.includes('@') ? value : `${value}@${LOGIN_DOMAIN}`
}

export function isManager(user: User | null): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin'
}

// ---------------------------------------------------------------- satır dönüşümü
// Veritabanı sütunları snake_case, arayüz alanları camelCase'tir. Boş değerler arayüzde '' olarak taşınır.

const camel = (key: string) => key.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())
const snake = (key: string) => key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`)

/** Boş bırakılınca veritabanına NULL yazılan sütunlar (ilişkiler ve tarihler). */
const NULLABLE = new Set(['department', 'responsible', 'due_date', 'end', 'completed_at', 'assignee', 'downtime_minutes', 'verified_by'])

export function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) out[camel(key)] = value ?? ''
  return out as T
}

export function toRow(data: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    const column = snake(key)
    out[column] = value === '' && NULLABLE.has(column) ? null : value
  }
  return out
}

// ---------------------------------------------------------------- sorgular

interface QueryResult {
  data: unknown
  error: unknown
}

/** Sorguyu çalıştırır; hata varsa fırlatır, satırları arayüz biçimine çevirir. */
export async function rows<T>(query: PromiseLike<QueryResult>): Promise<T[]> {
  const { data, error } = await query
  if (error) throw error
  return ((data as Record<string, unknown>[] | null) ?? []).map((r) => fromRow<T>(r))
}

/** Tek satır bekleyen sorgu (.single() ile); satır yoksa hata fırlatır. */
export async function row<T>(query: PromiseLike<QueryResult>): Promise<T> {
  const { data, error } = await query
  if (error) throw error
  return fromRow<T>(data as Record<string, unknown>)
}

/** Tek satır ya da hiç (.maybeSingle() ile). */
export async function maybeRow<T>(query: PromiseLike<QueryResult>): Promise<T | null> {
  const { data, error } = await query
  if (error) throw error
  return data ? fromRow<T>(data as Record<string, unknown>) : null
}

export async function run(query: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await query
  if (error) throw error
}

export function insert<T>(table: string, data: object): Promise<T> {
  return row<T>(supabase.from(table).insert(toRow(data)).select().single())
}

export function update<T>(table: string, id: string, data: object): Promise<T> {
  return row<T>(supabase.from(table).update(toRow(data)).eq('id', id).select().single())
}

export function remove(table: string, id: string): Promise<void> {
  return run(supabase.from(table).delete().eq('id', id))
}

/** Metin araması için `.or()` süzgeci: sütunlardan herhangi biri aranan ifadeyi içersin. */
export function searchFilter(columns: string[], text: string): string {
  const needle = text.replace(/[%_\\"(),]/g, ' ').trim()
  return columns.map((column) => `${column}.ilike."%${needle}%"`).join(',')
}

/** Veritabanı fonksiyonu çağırır (supabase/migrations içindeki public.* fonksiyonları). */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data as T
}

// ---------------------------------------------------------------- canlı değişiklikler

export interface Change<T> {
  action: 'create' | 'update' | 'delete'
  /** Silmede sadece `id` doludur. */
  record: T
}

const ACTIONS = { INSERT: 'create', UPDATE: 'update', DELETE: 'delete' } as const
let channelSeq = 0

/**
 * Tablodaki değişiklikleri canlı dinler; dönen fonksiyon aboneliği kapatır.
 * Kullanıcı sadece görme yetkisi olan satırların değişikliğini alır (RLS).
 */
export function subscribe<T>(table: string, onChange: (change: Change<T>) => void, filter?: string): () => void {
  const channel = supabase
    .channel(`${table}-${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, (payload) => {
      const raw = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>
      onChange({ action: ACTIONS[payload.eventType], record: fromRow<T>(raw) })
    })
    .subscribe()
  return () => void supabase.removeChannel(channel)
}

// ---------------------------------------------------------------- hata mesajları

const KNOWN_ERRORS: Array<[RegExp, string]> = [
  [/failed to fetch|networkerror|load failed|fetch failed/i, 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.'],
  [/invalid login credentials/i, 'Kullanıcı adı veya şifre hatalı.'],
  [/user is banned/i, 'Hesabınız pasif. Yöneticinize başvurun.'],
  [/new password should be different/i, 'Yeni şifre eskisinden farklı olmalı.'],
  [/password should be|weak password/i, 'Şifre yeterince güçlü değil.'],
  [/rate limit|too many requests/i, 'Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.'],
  [/row-level security|permission denied/i, 'Bu işlem için yetkiniz yok.'],
  [/duplicate key/i, 'Bu kayıt zaten var.'],
  [/violates foreign key/i, 'Bu kayıt başka kayıtlarda kullanıldığı için işlem yapılamadı.'],
  [/violates check constraint|invalid input|value too long/i, 'Girilen değer geçersiz ya da çok uzun.'],
  [/mime type|not supported/i, 'Bu dosya türü desteklenmiyor.'],
  [/exceeded the maximum allowed size|payload too large/i, 'Dosya 10 MB sınırını aşıyor.'],
  [/jwt expired|invalid jwt/i, 'Oturumunuzun süresi doldu. Yeniden giriş yapın.'],
]

/** Kullanıcıya gösterilecek Türkçe hata mesajı. Veritabanının kendi Türkçe mesajları aynen gösterilir. */
export function errorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  if (code === 'PGRST116') return 'Kayıt bulunamadı ya da bu işlem için yetkiniz yok.'
  const message = (err as { message?: unknown } | null)?.message
  if (typeof message !== 'string' || !message) return 'Beklenmeyen bir hata oluştu.'
  return KNOWN_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? message
}
