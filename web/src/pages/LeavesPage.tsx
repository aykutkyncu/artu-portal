import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Check, Pencil, Plus, TreePalm, Undo2, X } from 'lucide-react'
import { eachDayOfInterval, isSunday, parseISO } from 'date-fns'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, isManager, rows, subscribe, supabase, update } from '../lib/db'
import { fmt, fmtDateTime, isoDay } from '../lib/format'
import { LEAVE_STATUS, LEAVE_TYPE } from '../lib/labels'
import type { LeaveRequest, LeaveStatus, LeaveType, User } from '../lib/types'
import { Avatar, Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui'

type Tab = 'mine' | 'pending' | 'all'
const TYPES = Object.keys(LEAVE_TYPE) as LeaveType[]

/** 3 → "3", 2.5 → "2,5" */
const fmtDays = (n: number) => String(Number(n)).replace('.', ',')

/** Aralıktaki gün sayısı; pazar günleri sayılmaz (öneridir, talep eden değiştirebilir). */
function suggestDays(start: string, end: string): number {
  if (!start || !end || end < start) return 0
  return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).filter((d) => !isSunday(d)).length
}

function fmtRange(r: LeaveRequest): string {
  return r.startDate === r.endDate ? fmt(r.startDate, 'd MMMM yyyy') : `${fmt(r.startDate, 'd MMM')} – ${fmt(r.endDate, 'd MMM yyyy')}`
}

/** Kişinin içinde bulunulan yıldaki yıllık izin durumu. */
function balance(user: User | undefined, requests: LeaveRequest[]) {
  const year = String(new Date().getFullYear())
  const annual = requests.filter((r) => r.user === user?.id && r.type === 'annual' && r.startDate.startsWith(year))
  const sum = (status: LeaveStatus) => annual.filter((r) => r.status === status).reduce((n, r) => n + Number(r.days), 0)
  const entitled = Number(user?.annualLeaveDays ?? 0)
  const used = sum('approved')
  return { entitled, used, pending: sum('pending'), remaining: entitled - used }
}

export default function LeavesPage() {
  const me = useMe()
  const { usersById, reloadUnread } = useData()
  const canDecide = isManager(me)
  const [requests, setRequests] = useState<LeaveRequest[] | null>(null)
  const [tab, setTab] = useState<Tab>('mine')
  const [editing, setEditing] = useState<Partial<LeaveRequest> | null>(null)
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; status: LeaveStatus } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Kişi kendi taleplerini, birim sorumlusu kendi birimini, admin herkesi görür (veritabanı kuralı).
    setRequests(await rows<LeaveRequest>(supabase.from('leave_requests').select('*').order('start_date', { ascending: false }).limit(500)))
  }, [])

  useEffect(() => {
    void load().catch((err) => {
      setError(errorMessage(err))
      setRequests([])
    })
  }, [load])

  useEffect(() => {
    return subscribe('leave_requests', () => void load().catch(() => undefined))
  }, [load])

  const awaiting = useMemo(() => (requests ?? []).filter((r) => r.status === 'pending' && r.user !== me.id), [requests, me.id])
  const shown = useMemo(() => {
    if (tab === 'pending') return awaiting
    if (tab === 'all') return requests ?? []
    return (requests ?? []).filter((r) => r.user === me.id)
  }, [tab, requests, awaiting, me.id])

  // Hak, rehberdeki güncel kayıttan okunur (oturumdaki profil eski olabilir).
  const mine = balance(usersById.get(me.id) ?? me, requests ?? [])
  const today = isoDay(new Date())

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'mine', label: 'Taleplerim' },
    ...(canDecide
      ? [
          { key: 'pending' as const, label: `Onay bekleyenler (${awaiting.length})` },
          { key: 'all' as const, label: 'Tüm talepler' },
        ]
      : []),
  ]

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="İzinler"
        subtitle="İzin talebi ve onayı"
        actions={
          <Button onClick={() => setEditing({ type: 'annual', startDate: today, endDate: today })}>
            <Plus className="size-4" /> İzin talebi
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Yıllık izin hakkı" value={fmtDays(mine.entitled)} />
        <Stat label="Bu yıl kullanılan" value={fmtDays(mine.used)} />
        <Stat label="Onay bekleyen" value={fmtDays(mine.pending)} />
        <Stat label="Kalan" value={fmtDays(mine.remaining)} highlight />
      </div>

      {tabs.length > 1 && (
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
      )}

      <ErrorNote message={error} />
      {!requests && <Spinner />}
      {requests && shown.length === 0 && (
        <EmptyState icon={<TreePalm className="size-10" />} title={tab === 'pending' ? 'Onay bekleyen talep yok' : 'İzin talebi yok'}>
          {tab === 'mine' && '“İzin talebi” ile yeni bir talep oluşturun.'}
        </EmptyState>
      )}

      <div className="space-y-2">
        {shown.map((r) => {
          const owner = usersById.get(r.user)
          const isMine = r.user === me.id
          const ownerBalance = !isMine && r.type === 'annual' ? balance(owner, requests ?? []) : null
          // Kimin neyi yapabileceğini veritabanı da denetler (private.leave_requests_check).
          const canApprove = r.status === 'pending' && canDecide && (!isMine || me.role === 'admin')
          const canCancel = (isMine && (r.status === 'pending' || (r.status === 'approved' && r.startDate > today))) || (!isMine && canDecide && r.status === 'approved')
          return (
            <article key={r.id} className="rounded-xl border border-stone-200/70 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  {!isMine && <Avatar user={owner} size={36} />}
                  <div className="min-w-0">
                    {!isMine && <div className="truncate text-sm font-semibold text-stone-900">{owner?.name ?? 'Eski kullanıcı'}</div>}
                    <div className="text-sm font-medium text-stone-800">
                      {LEAVE_TYPE[r.type]} · {fmtDays(r.days)} gün
                    </div>
                    <div className="text-xs text-stone-500">{fmtRange(r)}</div>
                  </div>
                </div>
                <Badge className={LEAVE_STATUS[r.status].cls}>{LEAVE_STATUS[r.status].label}</Badge>
              </div>
              {r.note && <p className="mt-2 text-sm whitespace-pre-wrap text-stone-600">{r.note}</p>}
              {ownerBalance && r.status === 'pending' && (
                <p className="mt-2 text-xs text-stone-500">
                  Yıllık izin: hak {fmtDays(ownerBalance.entitled)}, kullanılan {fmtDays(ownerBalance.used)}, kalan {fmtDays(ownerBalance.remaining)} gün
                </p>
              )}
              {r.decidedBy && (
                <p className="mt-2 text-xs text-stone-500">
                  {r.status === 'rejected' ? 'Reddeden' : 'Onaylayan'}: {usersById.get(r.decidedBy)?.name ?? 'Eski kullanıcı'} · {fmtDateTime(r.decidedAt)}
                  {r.decisionNote && ` · “${r.decisionNote}”`}
                </p>
              )}
              {(canApprove || canCancel || (isMine && r.status === 'pending')) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canApprove && (
                    <>
                      <Button size="sm" onClick={() => setDeciding({ request: r, status: 'approved' })}>
                        <Check className="size-4" /> Onayla
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeciding({ request: r, status: 'rejected' })}>
                        <X className="size-4" /> Reddet
                      </Button>
                    </>
                  )}
                  {isMine && r.status === 'pending' && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                      <Pencil className="size-4" /> Düzenle
                    </Button>
                  )}
                  {canCancel && (
                    <Button size="sm" variant="secondary" onClick={() => setDeciding({ request: r, status: 'cancelled' })}>
                      <Undo2 className="size-4" /> İptal et
                    </Button>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {editing && (
        <LeaveEditor
          initial={editing}
          remaining={mine.remaining - mine.pending}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setTab('mine')
            void load()
          }}
        />
      )}
      {deciding && (
        <DecisionModal
          request={deciding.request}
          status={deciding.status}
          ownerName={usersById.get(deciding.request.user)?.name ?? ''}
          onClose={() => setDeciding(null)}
          onSaved={() => {
            setDeciding(null)
            void load()
            void reloadUnread().catch(() => undefined)
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={clsx('rounded-xl border p-3', highlight ? 'border-cocoa-200 bg-cocoa-50' : 'border-stone-200/70 bg-white')}>
      <div className="text-[11px] text-stone-500">{label}</div>
      <div className="text-lg font-semibold text-stone-900">
        {value} <span className="text-xs font-normal text-stone-500">gün</span>
      </div>
    </div>
  )
}

function LeaveEditor({ initial, remaining, onClose, onSaved }: { initial: Partial<LeaveRequest>; remaining: number; onClose: () => void; onSaved: () => void }) {
  const me = useMe()
  const [form, setForm] = useState({
    type: (initial.type ?? 'annual') as LeaveType,
    startDate: initial.startDate ?? '',
    endDate: initial.endDate ?? '',
    days: Number(initial.days ?? suggestDays(initial.startDate ?? '', initial.endDate ?? '')),
    note: initial.note ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Tarih değişince gün sayısı yeniden önerilir.
  const setDates = (startDate: string, endDate: string) => {
    const end = endDate < startDate ? startDate : endDate
    setForm((f) => ({ ...f, startDate, endDate: end, days: suggestDays(startDate, end) }))
  }

  // Düzenlenen talebin günleri kalan hesabında zaten "bekleyen" olarak düşülmüştür.
  const available = remaining + (initial.id && initial.type === 'annual' ? Number(initial.days ?? 0) : 0)
  const exceeds = form.type === 'annual' && form.days > available

  const save = async () => {
    if (!form.startDate || !form.endDate) return setError('Başlangıç ve bitiş tarihini seçin.')
    if (!(form.days >= 0.5)) return setError('Gün sayısı en az yarım gün olmalıdır.')
    setIsSaving(true)
    setError(null)
    try {
      if (initial.id) await update('leave_requests', initial.id, form)
      else await insert('leave_requests', { ...form, user: me.id })
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
      title={initial.id ? 'İzin talebini düzenle' : 'İzin talebi'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            {initial.id ? 'Kaydet' : 'Talebi gönder'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="İzin türü" className="sm:col-span-2">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LeaveType })}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Başlangıç">
          <Input type="date" value={form.startDate} onChange={(e) => setDates(e.target.value, form.endDate)} />
        </Field>
        <Field label="Bitiş (son izin günü)">
          <Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setDates(form.startDate, e.target.value)} />
        </Field>
        <Field label="Gün sayısı" hint="Pazar günleri sayılmadan önerilir; yarım gün için 0,5 yazın." className="sm:col-span-2">
          <Input type="number" min={0.5} step={0.5} value={form.days || ''} onChange={(e) => setForm({ ...form, days: Number(e.target.value) })} />
        </Field>
        <Field label="Açıklama (opsiyonel)" className="sm:col-span-2">
          <Textarea rows={3} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        {exceeds && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:col-span-2">
            Kalan yıllık izniniz {fmtDays(Math.max(available, 0))} gün. Talebi yine de gönderebilirsiniz; karar birim sorumlunuzundur.
          </p>
        )}
        <div className="sm:col-span-2">
          <ErrorNote message={error} />
        </div>
      </div>
    </Modal>
  )
}

const DECISION: Partial<Record<LeaveStatus, { title: string; button: string; danger?: boolean }>> = {
  approved: { title: 'İzni onayla', button: 'Onayla' },
  rejected: { title: 'İzni reddet', button: 'Reddet', danger: true },
  cancelled: { title: 'İzni iptal et', button: 'İptal et', danger: true },
}

function DecisionModal({ request, status, ownerName, onClose, onSaved }: { request: LeaveRequest; status: LeaveStatus; ownerName: string; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const texts = DECISION[status]!
  const withNote = status !== 'cancelled'

  const save = async () => {
    if (status === 'rejected' && !note.trim()) return setError('Ret gerekçesini yazın.')
    setIsSaving(true)
    setError(null)
    try {
      await update('leave_requests', request.id, withNote ? { status, decisionNote: note.trim() } : { status })
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
      title={texts.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant={texts.danger ? 'danger' : 'primary'} onClick={save} isLoading={isSaving}>
            {texts.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-stone-700">
          {ownerName && <span className="font-semibold">{ownerName} · </span>}
          {LEAVE_TYPE[request.type]} · {fmtRange(request)} · {fmtDays(request.days)} gün
        </p>
        {status === 'approved' && <p className="text-xs text-stone-500">Onaylanan izin vardiya çizelgesine kendiliğinden işlenir.</p>}
        {status === 'cancelled' && request.status === 'approved' && <p className="text-xs text-stone-500">İzin vardiya çizelgesinden de kaldırılır.</p>}
        {withNote && (
          <Field label={status === 'rejected' ? 'Ret gerekçesi' : 'Not (opsiyonel)'}>
            <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}
