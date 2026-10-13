import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO, isValid, startOfWeek, addDays } from 'date-fns'
import { tr } from 'date-fns/locale'

/** PocketBase tarihleri "2026-10-09 12:00:00.000Z" biçimindedir. */
export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  const d = parseISO(value.replace(' ', 'T'))
  return isValid(d) ? d : null
}

export function fmt(value: string | Date | null | undefined, pattern = 'd MMMM yyyy'): string {
  const d = parseDate(value)
  return d ? format(d, pattern, { locale: tr }) : ''
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  return fmt(value, 'd MMM yyyy HH:mm')
}

/** Sohbet listesi için kısa zaman: 14:32 / Dün / 12.10 */
export function fmtShort(value: string | null | undefined): string {
  const d = parseDate(value)
  if (!d) return ''
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Dün'
  return format(d, 'dd.MM.yy')
}

export function fromNow(value: string | null | undefined): string {
  const d = parseDate(value)
  return d ? formatDistanceToNowStrict(d, { locale: tr, addSuffix: true }) : ''
}

/** Yerel tarih → YYYY-MM-DD (saat dilimi kaymadan). */
export function isoDay(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor, { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** <input type="datetime-local"> değeri ↔ PocketBase UTC tarih */
export function toLocalInput(value: string | null | undefined): string {
  const d = parseDate(value)
  return d ? format(d, "yyyy-MM-dd'T'HH:mm") : ''
}

export function fromLocalInput(value: string): string {
  if (!value) return ''
  return new Date(value).toISOString().replace('T', ' ')
}

export function initials(name: string | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase('tr'))
    .join('')
}
