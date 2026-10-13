import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Factory, Plus, Pencil } from 'lucide-react'
import { addWeeks, isToday } from 'date-fns'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, isManager, remove as removeRecord, rows, subscribe, supabase, update } from '../lib/db'
import { fmt, isoDay, weekDays } from '../lib/format'
import { PLAN_STATUS, UNITS } from '../lib/labels'
import type { PlanStatus, ProductionPlan } from '../lib/types'
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui'

const STATUSES = Object.keys(PLAN_STATUS) as PlanStatus[]

export default function ProductionPage() {
  const me = useMe()
  const { usersById } = useData()
  const canEdit = isManager(me)
  const [anchor, setAnchor] = useState(new Date())
  const [plans, setPlans] = useState<ProductionPlan[] | null>(null)
  const [editing, setEditing] = useState<Partial<ProductionPlan> | null>(null)

  const days = useMemo(() => weekDays(anchor), [anchor])
  const from = isoDay(days[0]!)
  const to = isoDay(days[6]!)

  const load = useCallback(async () => {
    setPlans(
      await rows<ProductionPlan>(
        supabase.from('production_plans').select('*').gte('date', from).lte('date', to).order('date').order('line').order('product'),
      ),
    )
  }, [from, to])

  useEffect(() => {
    void load().catch(() => setPlans([]))
    return subscribe('production_plans', () => void load().catch(() => undefined))
  }, [load])

  // Haftalık ürün toplamları
  const totals = useMemo(() => {
    const map = new Map<string, { planned: number; produced: number; unit: string }>()
    plans
      ?.filter((p) => p.status !== 'cancelled')
      .forEach((p) => {
        const key = `${p.product}|${p.unit}`
        const t = map.get(key) ?? { planned: 0, produced: 0, unit: p.unit }
        map.set(key, { ...t, planned: t.planned + (p.quantity ?? 0), produced: t.produced + (p.producedQuantity ?? 0) })
      })
    return [...map.entries()].map(([k, v]) => ({ product: k.split('|')[0]!, ...v }))
  }, [plans])

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Üretim Planı"
        subtitle={`${fmt(days[0], 'd MMMM')} – ${fmt(days[6], 'd MMMM yyyy')}`}
        actions={
          <>
            <div className="flex items-center rounded-lg border border-stone-200 bg-white">
              <button type="button" className="p-2 text-stone-500 hover:text-stone-900" onClick={() => setAnchor(addWeeks(anchor, -1))} aria-label="Önceki hafta">
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" className="px-2 text-xs font-medium text-stone-600" onClick={() => setAnchor(new Date())}>
                Bu hafta
              </button>
              <button type="button" className="p-2 text-stone-500 hover:text-stone-900" onClick={() => setAnchor(addWeeks(anchor, 1))} aria-label="Sonraki hafta">
                <ChevronRight className="size-4" />
              </button>
            </div>
            {canEdit && (
              <Button onClick={() => setEditing({ date: isoDay(new Date()), status: 'planned', unit: 'kg' })}>
                <Plus className="size-4" /> Plan ekle
              </Button>
            )}
          </>
        }
      />

      {!plans && <Spinner />}
      {plans?.length === 0 && (
        <EmptyState icon={<Factory className="size-10" />} title="Bu hafta için plan yok">
          {canEdit ? '“Plan ekle” ile üretim planı girin.' : 'Planlar yöneticiler tarafından girilir.'}
        </EmptyState>
      )}

      {plans && plans.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            {days.map((d) => {
              const date = isoDay(d)
              const dayPlans = plans.filter((p) => p.date === date)
              if (dayPlans.length === 0) return null
              return (
                <section key={date} className={clsx('rounded-2xl border bg-white shadow-sm', isToday(d) ? 'border-cocoa-300' : 'border-stone-200/70')}>
                  <h2 className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-800">
                    {fmt(d, 'd MMMM EEEE')}
                    {isToday(d) && <Badge className="bg-cocoa-700 text-white">Bugün</Badge>}
                  </h2>
                  <ul className="divide-y divide-stone-50">
                    {dayPlans.map((p) => {
                      const pct = p.quantity ? Math.min(100, Math.round(((p.producedQuantity ?? 0) / p.quantity) * 100)) : 0
                      return (
                        <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={clsx('font-medium text-stone-800', p.status === 'cancelled' && 'text-stone-400 line-through')}>{p.product}</span>
                              {p.productCode && <span className="text-xs text-stone-400">{p.productCode}</span>}
                              <Badge className={PLAN_STATUS[p.status].cls}>{PLAN_STATUS[p.status].label}</Badge>
                            </div>
                            <div className="mt-0.5 text-xs text-stone-500">
                              {p.line && `${p.line} · `}
                              {usersById.get(p.responsible) && `Sorumlu: ${usersById.get(p.responsible)!.name}`}
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-stone-100">
                                <div className={clsx('h-1.5 rounded-full', pct >= 100 ? 'bg-green-500' : 'bg-cocoa-500')} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="w-28 text-right text-xs text-stone-600 tabular-nums">
                                {p.producedQuantity ?? 0} / {p.quantity} {p.unit}
                              </span>
                            </div>
                            {p.notes && <p className="mt-1 text-xs text-stone-500">{p.notes}</p>}
                          </div>
                          {canEdit && (
                            <button type="button" onClick={() => setEditing(p)} className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Düzenle">
                              <Pencil className="size-4" />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>

          <aside className="h-fit rounded-2xl border border-stone-200/70 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-stone-800">Haftalık toplam</h2>
            <ul className="space-y-2.5">
              {totals.map((t) => (
                <li key={`${t.product}${t.unit}`}>
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-stone-700">{t.product}</span>
                    <span className="shrink-0 text-stone-500 tabular-nums">
                      {t.produced}/{t.planned} {t.unit}
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-stone-100">
                    <div className="h-1 rounded-full bg-cocoa-500" style={{ width: `${t.planned ? Math.min(100, (t.produced / t.planned) * 100) : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}

      {editing && (
        <PlanEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function PlanEditor({ initial, onClose, onSaved }: { initial: Partial<ProductionPlan>; onClose: () => void; onSaved: () => void }) {
  const me = useMe()
  const { users } = useData()
  const [form, setForm] = useState({
    date: initial.date ?? isoDay(new Date()),
    product: initial.product ?? '',
    productCode: initial.productCode ?? '',
    quantity: initial.quantity ?? 0,
    producedQuantity: initial.producedQuantity ?? 0,
    unit: initial.unit ?? 'kg',
    line: initial.line ?? '',
    status: (initial.status ?? 'planned') as PlanStatus,
    responsible: initial.responsible ?? '',
    notes: initial.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.product.trim()) return setError('Ürün adı zorunludur.')
    setIsSaving(true)
    setError(null)
    try {
      const data = { ...form, product: form.product.trim(), department: me.department }
      if (initial.id) await update('production_plans', initial.id, data)
      else await insert('production_plans', { ...data, createdBy: me.id })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async () => {
    if (!initial.id || !window.confirm('Plan silinsin mi?')) return
    try {
      await removeRecord('production_plans', initial.id)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={initial.id ? 'Planı düzenle' : 'Yeni üretim planı'}
      footer={
        <>
          {initial.id && (
            <Button variant="ghost" onClick={remove} className="mr-auto text-red-600">
              Sil
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            Kaydet
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ürün">
          <Input value={form.product} onChange={(e) => set('product', e.target.value)} autoFocus placeholder="Örn: Bitter Tablet 80g" />
        </Field>
        <Field label="Ürün kodu" hint="İleride Logo stok koduyla eşleşecek">
          <Input value={form.productCode} onChange={(e) => set('productCode', e.target.value)} />
        </Field>
        <Field label="Tarih">
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Hat / Makine">
          <Input value={form.line} onChange={(e) => set('line', e.target.value)} placeholder="Örn: Hat 1" />
        </Field>
        <div className="grid grid-cols-[1fr_100px] gap-2">
          <Field label="Planlanan miktar">
            <Input type="number" min={0} value={form.quantity} onChange={(e) => set('quantity', Number(e.target.value))} />
          </Field>
          <Field label="Birim">
            <Select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Üretilen miktar">
          <Input type="number" min={0} value={form.producedQuantity} onChange={(e) => set('producedQuantity', Number(e.target.value))} />
        </Field>
        <Field label="Durum">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as PlanStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {PLAN_STATUS[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sorumlu">
          <Select value={form.responsible} onChange={(e) => set('responsible', e.target.value)}>
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notlar" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorNote message={error} />
        </div>
      </div>
    </Modal>
  )
}
