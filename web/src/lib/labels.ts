import type { EventCategory, PlanStatus, Priority, Role, ShiftKind, TaskPriority, TaskStatus } from './types'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Yönetici (Admin)',
  manager: 'Birim Sorumlusu',
  staff: 'Personel',
}

export const PRIORITY: Record<Priority, { label: string; cls: string }> = {
  normal: { label: 'Normal', cls: 'bg-stone-100 text-stone-600' },
  important: { label: 'Önemli', cls: 'bg-amber-100 text-amber-800' },
  urgent: { label: 'Acil', cls: 'bg-red-100 text-red-700' },
}

export const EVENT_CATEGORY: Record<EventCategory, { label: string; color: string }> = {
  meeting: { label: 'Toplantı', color: '#7d5236' },
  shipment: { label: 'Sevkiyat', color: '#2563eb' },
  production: { label: 'Üretim', color: '#b45309' },
  leave: { label: 'İzin', color: '#16a34a' },
  training: { label: 'Eğitim', color: '#7c3aed' },
  visit: { label: 'Ziyaret', color: '#0891b2' },
  other: { label: 'Diğer', color: '#57534e' },
}

export const TASK_STATUS: Record<TaskStatus, { label: string; cls: string }> = {
  todo: { label: 'Yapılacak', cls: 'bg-stone-100 text-stone-700' },
  in_progress: { label: 'Devam Ediyor', cls: 'bg-blue-100 text-blue-700' },
  review: { label: 'Kontrolde', cls: 'bg-amber-100 text-amber-800' },
  done: { label: 'Tamamlandı', cls: 'bg-green-100 text-green-700' },
}

export const TASK_PRIORITY: Record<TaskPriority, { label: string; cls: string }> = {
  low: { label: 'Düşük', cls: 'text-stone-500' },
  normal: { label: 'Normal', cls: 'text-stone-700' },
  high: { label: 'Yüksek', cls: 'text-amber-700' },
  urgent: { label: 'Acil', cls: 'text-red-600' },
}

export const SHIFT_KIND: Record<ShiftKind, { label: string; short: string; cls: string; start?: string; end?: string }> = {
  morning: { label: 'Sabah', short: 'S', cls: 'bg-amber-100 text-amber-800', start: '08:00', end: '16:00' },
  evening: { label: 'Akşam', short: 'A', cls: 'bg-orange-100 text-orange-800', start: '16:00', end: '00:00' },
  night: { label: 'Gece', short: 'G', cls: 'bg-indigo-100 text-indigo-800', start: '00:00', end: '08:00' },
  office: { label: 'Ofis', short: 'O', cls: 'bg-sky-100 text-sky-800', start: '08:30', end: '18:00' },
  off: { label: 'Hafta Tatili', short: 'T', cls: 'bg-stone-100 text-stone-500' },
  leave: { label: 'Yıllık İzin', short: 'İ', cls: 'bg-green-100 text-green-800' },
  sick: { label: 'Rapor', short: 'R', cls: 'bg-red-100 text-red-700' },
  holiday: { label: 'Resmi Tatil', short: 'RT', cls: 'bg-purple-100 text-purple-800' },
}

export const PLAN_STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  planned: { label: 'Planlandı', cls: 'bg-stone-100 text-stone-700' },
  in_progress: { label: 'Üretimde', cls: 'bg-blue-100 text-blue-700' },
  done: { label: 'Tamamlandı', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'İptal', cls: 'bg-red-100 text-red-700 line-through' },
}

export const UNITS = ['kg', 'adet', 'koli', 'ton', 'paket'] as const
