import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Check, ClipboardCheck, Pencil, Plus, ShieldCheck, Trash2, Undo2, X } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, rows, subscribe, supabase, update } from '../lib/db'
import { fmt, fmtDateTime } from '../lib/format'
import type { CheckEntry, CheckForm, CheckItem, CheckItemKind, CheckValue } from '../lib/types'
import { Avatar, Badge, Button, Checkbox, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui'

type Tab = 'today' | 'records' | 'forms'

/** İstanbul'a göre bugün (YYYY-MM-DD); kayıt günü veritabanında da böyle belirlenir. */
const istanbulDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d)
const daysAgo = (n: number) => istanbulDay(new Date(Date.now() - n * 86400000))
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

const KIND_LABEL: Record<CheckItemKind, string> = { check: 'Uygun / değil', number: 'Ölçüm', text: 'Not / metin' }

function rangeText(item: CheckItem): string {
  const unit = item.unit ? ` ${item.unit}` : ''
  const hasMin = typeof item.min === 'number'
  const hasMax = typeof item.max === 'number'
  if (hasMin && hasMax) return `${item.min}–${item.max}${unit}`
  if (hasMin) return `en az ${item.min}${unit}`
  if (hasMax) return `en çok ${item.max}${unit}`
  return item.unit ?? ''
}

/** Veritabanındaki private.check_entries_check ile aynı kural */
function isBad(item: CheckItem, value: CheckValue | undefined): boolean {
  if (item.kind === 'check') return value === false
  if (item.kind === 'number' && typeof value === 'number') {
    return (typeof item.min === 'number' && value < item.min) || (typeof item.max === 'number' && value > item.max)
  }
  return false
}

function showValue(item: CheckItem, value: CheckValue | undefined): string {
  if (value === undefined || value === '') return '—'
  if (item.kind === 'check') return value ? 'Uygun' : 'Uygun değil'
  if (item.kind === 'number') return `${String(value).replace('.', ',')}${item.unit ? ` ${item.unit}` : ''}`
  return String(value)
}

export default function ChecksPage() {
  const me = useMe()
  const { usersById, departmentsById } = useData()
  const isAdmin = me.role === 'admin'
  const isManager = me.role === 'admin' || me.role === 'manager'
  // Veritabanındaki karşılıkları: private.can_fill_form, public.can_manage_form
  const canFill = useCallback((f: CheckForm) => f.active && (!f.department || f.department === me.department || isManager), [me.department, isManager])
  const canManage = useCallback((department: string) => isAdmin || (me.role === 'manager' && (!department || department === me.department)), [isAdmin, me.role, me.department])

  const [tab, setTab] = useState<Tab>('today')
  const [forms, setForms] = useState<CheckForm[] | null>(null)
  const [today, setToday] = useState<CheckEntry[]>([])
  const [filling, setFilling] = useState<{ form: CheckForm; entry?: CheckEntry } | null>(null)
  const [editingForm, setEditingForm] = useState<Partial<CheckForm> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    const [f, e] = await Promise.all([
      rows<CheckForm>(supabase.from('check_forms').select('*').order('sort').order('name')),
      rows<CheckEntry>(supabase.from('check_entries').select('*').eq('day', istanbulDay()).order('created', { ascending: false })),
    ])
    setForms(f)
    setToday(e)
  }, [])

  useEffect(() => {
    void load().catch((err) => {
      setError(errorMessage(err))
      setForms([])
    })
  }, [load])

  useEffect(
    () =>
      subscribe('check_entries', () => {
        void load().catch(() => undefined)
        setReloadKey((k) => k + 1)
      }),
    [load],
  )

  const formsById = useMemo(() => new Map((forms ?? []).map((f) => [f.id, f])), [forms])
  const myForms = useMemo(() => (forms ?? []).filter(canFill), [forms, canFill])
  const managed = useMemo(() => (forms ?? []).filter((f) => canManage(f.department)), [forms, canManage])

  const afterSave = () => {
    setFilling(null)
    void load()
    setReloadKey((k) => k + 1)
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'today', label: 'Bugün' },
    { key: 'records', label: 'Kayıtlar' },
    ...(isManager ? [{ key: 'forms' as Tab, label: 'Formlar' }] : []),
  ]

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Kontroller"
        subtitle="Kalite ve hijyen kontrol formları"
        actions={
          tab === 'forms' && (
            <Button onClick={() => setEditingForm({ department: isAdmin ? '' : me.department, frequency: 'daily', active: true, items: [] })}>
              <Plus className="size-4" /> Yeni form
            </Button>
          )
        }
      />

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-stone-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={clsx('shrink-0 rounded-md px-3 py-1 text-xs font-medium', tab === t.key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorNote message={error} />
      {!forms && <Spinner />}

      {forms && tab === 'today' && (
        <>
          {myForms.length === 0 && (
            <EmptyState icon={<ClipboardCheck className="size-10" />} title="Doldurmanız gereken form yok">
              {isManager && 'Formlar sekmesinden yeni form ekleyebilirsiniz.'}
            </EmptyState>
          )}
          <div className="space-y-2">
            {myForms.map((f) => {
              const entries = today.filter((e) => e.form === f.id)
              const missing = f.frequency === 'daily' && entries.length === 0
              return (
                <article key={f.id} className={clsx('rounded-xl border bg-white p-4 shadow-sm', missing ? 'border-amber-200' : 'border-stone-200/70')}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-semibold text-stone-900">{f.name}</h3>
                        {f.department && departmentsById.get(f.department) && <Badge className="bg-stone-100 text-stone-600">{departmentsById.get(f.department)!.name}</Badge>}
                        {missing ? (
                          <Badge className="bg-amber-100 text-amber-800">Bugün doldurulmadı</Badge>
                        ) : entries.length > 0 ? (
                          <Badge className="bg-green-100 text-green-700">Bugün {entries.length} kayıt</Badge>
                        ) : (
                          <Badge className="bg-stone-100 text-stone-500">Gerektikçe</Badge>
                        )}
                      </div>
                      {f.description && <p className="mt-0.5 text-xs text-stone-500">{f.description}</p>}
                    </div>
                    <Button size="sm" onClick={() => setFilling({ form: f })}>
                      <ClipboardCheck className="size-4" /> Doldur
                    </Button>
                  </div>
                  {entries.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-stone-100 pt-2">
                      {entries.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
                          <span className="font-medium text-stone-800">{timeOf(e.created)}</span>
                          {usersById.get(e.filledBy)?.name ?? 'Eski kullanıcı'}
                          {e.hasIssue ? <Badge className="bg-red-100 text-red-700">Uygunsuz</Badge> : <Badge className="bg-green-50 text-green-700">Uygun</Badge>}
                          {e.verifiedBy && <ShieldCheck className="size-3.5 text-green-700" aria-label="Onaylandı" />}
                          {e.filledBy === me.id && !e.verifiedBy && (
                            <button type="button" className="text-cocoa-700 underline" onClick={() => setFilling({ form: f, entry: e })}>
                              düzelt
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              )
            })}
          </div>
        </>
      )}

      {forms && tab === 'records' && (
        <Records
          forms={forms}
          formsById={formsById}
          canManage={canManage}
          reloadKey={reloadKey}
          onEdit={(entry) => {
            const form = formsById.get(entry.form)
            if (form) setFilling({ form, entry })
          }}
        />
      )}

      {forms && tab === 'forms' && (
        <div className="space-y-2">
          {managed.length === 0 && <EmptyState icon={<ClipboardCheck className="size-10" />} title="Yönetebileceğiniz form yok" />}
          {managed.map((f) => (
            <article key={f.id} className={clsx('flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200/70 bg-white p-4 shadow-sm', !f.active && 'opacity-60')}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-sm font-semibold text-stone-900">{f.name}</h3>
                  {!f.active && <Badge className="bg-stone-100 text-stone-500">Pasif</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  {f.department ? (departmentsById.get(f.department)?.name ?? 'Silinmiş birim') : 'Herkes'} · {f.frequency === 'daily' ? 'Her gün' : 'Gerektikçe'} · {f.items.length} madde
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditingForm(f)}>
                <Pencil className="size-4" /> Düzenle
              </Button>
            </article>
          ))}
        </div>
      )}

      {filling && <FillModal form={filling.form} entry={filling.entry} onClose={() => setFilling(null)} onSaved={afterSave} />}
      {editingForm && (
        <FormEditor
          initial={editingForm}
          onClose={() => setEditingForm(null)}
          onSaved={() => {
            setEditingForm(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function Records({
  forms,
  formsById,
  canManage,
  reloadKey,
  onEdit,
}: {
  forms: CheckForm[]
  formsById: Map<string, CheckForm>
  canManage: (department: string) => boolean
  reloadKey: number
  onEdit: (e: CheckEntry) => void
}) {
  const me = useMe()
  const { usersById } = useData()
  const [form, setForm] = useState('')
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(istanbulDay())
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [onlyUnverified, setOnlyUnverified] = useState(false)
  const [entries, setEntries] = useState<CheckEntry[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    let q = supabase.from('check_entries').select('*').gte('day', from).lte('day', to)
    if (form) q = q.eq('form', form)
    if (onlyIssues) q = q.eq('has_issue', true)
    if (onlyUnverified) q = q.is('verified_by', null)
    setEntries(await rows<CheckEntry>(q.order('day', { ascending: false }).order('created', { ascending: false }).limit(500)))
  }, [form, from, to, onlyIssues, onlyUnverified])

  useEffect(() => {
    setError(null)
    void load().catch((err) => {
      setError(errorMessage(err))
      setEntries([])
    })
  }, [load, reloadKey])

  const verify = async (e: CheckEntry, on: boolean) => {
    setError(null)
    try {
      await update('check_entries', e.id, { verifiedBy: on ? me.id : '' })
      void load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const today = istanbulDay()
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Form" className="col-span-2">
          <Select value={form} onChange={(e) => setForm(e.target.value)}>
            <option value="">Tümü</option>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Başlangıç">
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        <Field label="Bitiş">
          <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </Field>
      </div>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox label="Sadece uygunsuz" checked={onlyIssues} onChange={setOnlyIssues} />
        <Checkbox label="Onay bekleyenler" checked={onlyUnverified} onChange={setOnlyUnverified} />
      </div>

      <ErrorNote message={error} />
      {!entries && <Spinner />}
      {entries && entries.length === 0 && <EmptyState icon={<ClipboardCheck className="size-10" />} title="Bu aralıkta kayıt yok" />}
      {entries && entries.length === 500 && <p className="mb-2 text-xs text-stone-500">İlk 500 kayıt gösteriliyor; aralığı daraltın.</p>}

      <div className="space-y-2">
        {entries?.map((e) => {
          const f = formsById.get(e.form)
          const filler = usersById.get(e.filledBy)
          const isOpen = openId === e.id
          const manage = f ? canManage(f.department) : false
          const canVerify = manage && (e.filledBy !== me.id || me.role === 'admin')
          const canEdit = e.filledBy === me.id && !e.verifiedBy && e.day === today
          return (
            <article key={e.id} className={clsx('rounded-xl border bg-white shadow-sm', e.hasIssue ? 'border-red-200' : 'border-stone-200/70')}>
              <button type="button" onClick={() => setOpenId(isOpen ? null : e.id)} className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-stone-900">{f?.name ?? 'Form'}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500">
                    <Avatar user={filler} size={18} />
                    {filler?.name ?? 'Eski kullanıcı'} · {fmt(e.day, 'd MMM yyyy')} {timeOf(e.created)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {e.hasIssue ? <Badge className="bg-red-100 text-red-700">Uygunsuz</Badge> : <Badge className="bg-green-50 text-green-700">Uygun</Badge>}
                  {e.verifiedBy ? <Badge className="bg-green-100 text-green-800">Onaylı</Badge> : <Badge className="bg-stone-100 text-stone-500">Onay bekliyor</Badge>}
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-stone-100 px-3 pt-2 pb-3">
                  <table className="w-full text-sm">
                    <tbody>
                      {e.items.map((item) => {
                        const v = e.values[item.id]
                        const bad = isBad(item, v)
                        return (
                          <tr key={item.id} className="border-b border-stone-50 last:border-0">
                            <td className="py-1 pr-2 text-stone-600">
                              {item.label}
                              {item.kind === 'number' && rangeText(item) && <span className="ml-1 text-xs text-stone-400">({rangeText(item)})</span>}
                            </td>
                            <td className={clsx('py-1 text-right font-medium', bad ? 'text-red-700' : 'text-stone-900')}>{showValue(item, v)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {e.note && (
                    <p className={clsx('mt-2 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap', e.hasIssue ? 'bg-red-50 text-red-900' : 'bg-stone-50 text-stone-700')}>{e.note}</p>
                  )}
                  {e.verifiedBy && (
                    <p className="mt-2 text-xs text-green-800">
                      Onaylayan: {usersById.get(e.verifiedBy)?.name ?? 'Eski kullanıcı'} · {fmtDateTime(e.verifiedAt)}
                    </p>
                  )}
                  {(canVerify || canEdit) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canVerify && !e.verifiedBy && (
                        <Button size="sm" onClick={() => void verify(e, true)}>
                          <ShieldCheck className="size-4" /> Onayla
                        </Button>
                      )}
                      {canVerify && e.verifiedBy && (
                        <Button size="sm" variant="secondary" onClick={() => void verify(e, false)}>
                          <Undo2 className="size-4" /> Onayı geri al
                        </Button>
                      )}
                      {canEdit && (
                        <Button size="sm" variant="secondary" onClick={() => onEdit(e)}>
                          <Pencil className="size-4" /> Düzelt
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}

function FillModal({ form, entry, onClose, onSaved }: { form: CheckForm; entry?: CheckEntry; onClose: () => void; onSaved: () => void }) {
  const items = entry?.items ?? form.items
  const [values, setValues] = useState<Record<string, CheckValue>>(entry?.values ?? {})
  // Ölçümler yazılırken metin olarak tutulur (virgül de kabul edilir)
  const [numbers, setNumbers] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.filter((i) => i.kind === 'number' && typeof entry?.values[i.id] === 'number').map((i) => [i.id, String(entry!.values[i.id]).replace('.', ',')])),
  )
  const [note, setNote] = useState(entry?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const parsed = useMemo(() => {
    const out: Record<string, CheckValue> = {}
    for (const item of items) {
      if (item.kind === 'number') {
        const raw = (numbers[item.id] ?? '').trim().replace(',', '.')
        if (raw !== '' && Number.isFinite(Number(raw))) out[item.id] = Number(raw)
      } else if (values[item.id] !== undefined && values[item.id] !== '') {
        out[item.id] = item.kind === 'text' ? String(values[item.id]).trim() : values[item.id]
      }
    }
    return out
  }, [items, numbers, values])
  const hasIssue = items.some((i) => isBad(i, parsed[i.id]))

  const save = async () => {
    for (const item of items) {
      const raw = (numbers[item.id] ?? '').trim()
      if (item.kind === 'number' && raw !== '' && parsed[item.id] === undefined) return setError(`"${item.label}": sayı yazın.`)
      if (item.kind !== 'text' && parsed[item.id] === undefined) return setError(`"${item.label}" doldurulmadı.`)
    }
    if (hasIssue && !note.trim()) return setError('Uygunsuzluk var: ne yapıldığını açıklamaya yazın.')
    setIsSaving(true)
    setError(null)
    try {
      const fields = { values: parsed, note: note.trim() }
      if (entry) await update('check_entries', entry.id, fields)
      else await insert('check_entries', { form: form.id, ...fields })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={form.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            {entry ? 'Kaydet' : 'Gönder'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {form.description && <p className="text-xs text-stone-500">{form.description}</p>}
        {items.map((item) => {
          const bad = isBad(item, parsed[item.id])
          if (item.kind === 'check') {
            const v = values[item.id]
            return (
              <div key={item.id}>
                <div className="mb-1 text-sm text-stone-800">{item.label}</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setValues((prev) => ({ ...prev, [item.id]: true }))}
                    className={clsx('inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium', v === true ? 'border-green-600 bg-green-600 text-white' : 'border-stone-200 text-stone-600')}
                  >
                    <Check className="size-4" /> Uygun
                  </button>
                  <button
                    type="button"
                    onClick={() => setValues((prev) => ({ ...prev, [item.id]: false }))}
                    className={clsx('inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium', v === false ? 'border-red-600 bg-red-600 text-white' : 'border-stone-200 text-stone-600')}
                  >
                    <X className="size-4" /> Uygun değil
                  </button>
                </div>
              </div>
            )
          }
          if (item.kind === 'number') {
            const range = rangeText(item)
            return (
              <Field key={item.id} label={item.label} hint={range ? `Olması gereken: ${range}` : undefined}>
                <div className="relative">
                  <Input
                    inputMode="decimal"
                    value={numbers[item.id] ?? ''}
                    onChange={(e) => setNumbers((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    className={clsx(item.unit && 'pr-12', bad && 'border-red-400 bg-red-50 text-red-800')}
                  />
                  {item.unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-stone-400">{item.unit}</span>}
                </div>
                {bad && <span className="block text-xs font-medium text-red-700">Sınır dışında</span>}
              </Field>
            )
          }
          return (
            <Field key={item.id} label={item.label}>
              <Input maxLength={500} value={String(values[item.id] ?? '')} onChange={(e) => setValues((prev) => ({ ...prev, [item.id]: e.target.value }))} />
            </Field>
          )
        })}
        <Field label={hasIssue ? 'Uygunsuzluk açıklaması ve yapılan düzeltme (zorunlu)' : 'Açıklama (isteğe bağlı)'}>
          <Textarea
            rows={2}
            maxLength={2000}
            placeholder={hasIssue ? 'ör: Soğuk oda kapısı açık kalmış, kapatıldı; 30 dk sonra tekrar ölçülecek' : ''}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={clsx(hasIssue && !note.trim() && 'border-red-300')}
          />
        </Field>
        {hasIssue && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">Uygunsuzluk var; kaydedince birim sorumlusuna ve yöneticiye bildirim gider.</p>}
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}

const newItemId = () => crypto.randomUUID().slice(0, 8)

function FormEditor({ initial, onClose, onSaved }: { initial: Partial<CheckForm>; onClose: () => void; onSaved: () => void }) {
  const me = useMe()
  const { departments } = useData()
  const [form, setForm] = useState({
    name: initial.name ?? '',
    description: initial.description ?? '',
    department: initial.department ?? '',
    frequency: initial.frequency ?? 'daily',
    active: initial.active ?? true,
    sort: initial.sort ?? 0,
  })
  // Sınırlar yazılırken metin olarak tutulur
  const [items, setItems] = useState<Array<CheckItem & { minText: string; maxText: string }>>(() =>
    (initial.items?.length ? initial.items : [{ id: newItemId(), label: '', kind: 'check' as const }]).map((i) => ({
      ...i,
      minText: typeof i.min === 'number' ? String(i.min).replace('.', ',') : '',
      maxText: typeof i.max === 'number' ? String(i.max).replace('.', ',') : '',
    })),
  )
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const setItem = (idx: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items]
    ;[next[idx], next[idx + dir]] = [next[idx + dir], next[idx]]
    setItems(next)
  }
  // Admin değilse sadece kendi birimi ya da "herkes" seçilebilir
  const deptOptions = me.role === 'admin' ? departments : departments.filter((d) => d.id === me.department)

  const save = async () => {
    if (!form.name.trim()) return setError('Formun adını yazın.')
    const clean: CheckItem[] = []
    for (const it of items) {
      const label = it.label.trim()
      if (!label) return setError('Boş madde var; adını yazın ya da silin.')
      const item: CheckItem = { id: it.id, label, kind: it.kind }
      if (it.kind === 'number') {
        const num = (s: string) => (s.trim() === '' ? null : Number(s.trim().replace(',', '.')))
        const min = num(it.minText)
        const max = num(it.maxText)
        if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) return setError(`"${label}": sınırlar sayı olmalı.`)
        if (min !== null && max !== null && min > max) return setError(`"${label}": alt sınır üst sınırdan büyük olamaz.`)
        Object.assign(item, { unit: (it.unit ?? '').trim(), min, max })
      }
      clean.push(item)
    }
    if (clean.length === 0) return setError('Forma en az bir madde ekleyin.')
    setIsSaving(true)
    setError(null)
    try {
      const fields = { ...form, name: form.name.trim(), description: form.description.trim(), items: clean }
      if (initial.id) await update('check_forms', initial.id, fields)
      else await insert('check_forms', fields)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={initial.id ? 'Formu düzenle' : 'Yeni kontrol formu'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            Kaydet
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Form adı">
          <Input autoFocus maxLength={120} placeholder="ör: Soğuk oda sıcaklık takibi" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Açıklama / talimat">
          <Textarea rows={2} maxLength={1000} placeholder="Ne zaman, nasıl doldurulur?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kim doldurur">
            <Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              <option value="">Herkes</option>
              {deptOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sıklık">
            <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as CheckForm['frequency'] })}>
              <option value="daily">Her gün (doldurulmazsa uyarır)</option>
              <option value="free">Gerektikçe</option>
            </Select>
          </Field>
        </div>
        {initial.id && <Checkbox label="Aktif (pasif form doldurulamaz, eski kayıtları durur)" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />}

        <div>
          <div className="mb-2 text-xs font-medium text-stone-600">Maddeler</div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={it.id} className="rounded-lg border border-stone-200 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="min-w-0 flex-1" maxLength={200} placeholder="Madde" value={it.label} onChange={(e) => setItem(idx, { label: e.target.value })} aria-label="Madde adı" />
                  <Select className="w-auto" value={it.kind} onChange={(e) => setItem(idx, { kind: e.target.value as CheckItemKind })} aria-label="Madde türü">
                    {Object.entries(KIND_LABEL).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  <div className="flex">
                    <button type="button" className="p-1.5 text-stone-400 hover:text-stone-700 disabled:opacity-30" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label="Yukarı">
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" className="p-1.5 text-stone-400 hover:text-stone-700 disabled:opacity-30" disabled={idx === items.length - 1} onClick={() => move(idx, 1)} aria-label="Aşağı">
                      <ArrowDown className="size-4" />
                    </button>
                    <button type="button" className="p-1.5 text-stone-400 hover:text-red-600" onClick={() => setItems(items.filter((_, i) => i !== idx))} aria-label="Sil">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                {it.kind === 'number' && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Input inputMode="decimal" placeholder="Alt sınır" value={it.minText} onChange={(e) => setItem(idx, { minText: e.target.value })} aria-label="Alt sınır" />
                    <Input inputMode="decimal" placeholder="Üst sınır" value={it.maxText} onChange={(e) => setItem(idx, { maxText: e.target.value })} aria-label="Üst sınır" />
                    <Input maxLength={10} placeholder="Birim (°C, %)" value={it.unit ?? ''} onChange={(e) => setItem(idx, { unit: e.target.value })} aria-label="Birim" />
                  </div>
                )}
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setItems([...items, { id: newItemId(), label: '', kind: 'check', minText: '', maxText: '' }])}>
            <Plus className="size-4" /> Madde ekle
          </Button>
          <p className="mt-2 text-xs text-stone-500">“Uygun değil” işaretlenen ya da sınır dışı ölçülen madde uygunsuzluk sayılır. Değişiklik eski kayıtları etkilemez.</p>
        </div>
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}

