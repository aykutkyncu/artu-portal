import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Ban, Camera, Check, Hand, Pencil, Plus, RotateCcw, UserCog, Wrench } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, rows, subscribe, supabase, update } from '../lib/db'
import { MAX_ATTACHMENTS, removeAttachments, uploadAttachments } from '../lib/files'
import { fmtDateTime, fromNow } from '../lib/format'
import { FAULT_STATUS } from '../lib/labels'
import type { Fault, FaultStatus, User } from '../lib/types'
import { Attachments, Avatar, Badge, Button, Checkbox, EmptyState, ErrorNote, Field, FilePicker, Input, Modal, PageHeader, Select, Spinner, Textarea } from '../components/ui'

type Tab = 'active' | 'mine' | 'closed'

/** 95 → "1 sa 35 dk" */
export function fmtMinutes(m: number): string {
  if (m < 60) return `${m} dk`
  return `${Math.floor(m / 60)} sa${m % 60 ? ` ${m % 60} dk` : ''}`
}

const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))

export default function FaultsPage() {
  const me = useMe()
  const { users, usersById, departments, departmentsById, reloadUnread } = useData()
  // Bakım ekibi: bakım birimindekiler + admin (veritabanında private.is_maintenance_user)
  const isTeamMember = useCallback((u: User | undefined) => !!u && u.active && (u.role === 'admin' || !!departmentsById.get(u.department)?.maintenance), [departmentsById])
  const onTeam = isTeamMember(usersById.get(me.id) ?? me)
  const team = useMemo(() => users.filter(isTeamMember), [users, isTeamMember])
  const hasMaintenanceDept = departments.some((d) => d.maintenance)

  const [faults, setFaults] = useState<Fault[] | null>(null)
  const [tab, setTab] = useState<Tab>('active')
  const [editing, setEditing] = useState<Partial<Fault> | null>(null)
  const [action, setAction] = useState<{ fault: Fault; kind: 'resolve' | 'assign' } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFaults(await rows<Fault>(supabase.from('faults').select('*').order('created', { ascending: false }).limit(500)))
  }, [])

  useEffect(() => {
    void load().catch((err) => {
      setError(errorMessage(err))
      setFaults([])
    })
  }, [load])

  useEffect(() => subscribe('faults', () => void load().catch(() => undefined)), [load])

  const shown = useMemo(() => {
    const all = faults ?? []
    if (tab === 'mine') return all.filter((f) => f.reportedBy === me.id || f.assignee === me.id)
    if (tab === 'closed') return all.filter((f) => f.status === 'resolved' || f.status === 'cancelled')
    // Açıklar: acil ve makine duranlar üstte
    return all
      .filter((f) => f.status === 'open' || f.status === 'in_progress')
      .sort((a, b) => Number(b.urgent || b.machineStopped) - Number(a.urgent || a.machineStopped))
  }, [faults, tab, me.id])

  const stats = useMemo(() => {
    const all = faults ?? []
    const month = new Date().toISOString().slice(0, 7)
    const resolved = all.filter((f) => f.status === 'resolved' && f.resolvedAt.startsWith(month))
    return {
      open: all.filter((f) => f.status === 'open').length,
      inProgress: all.filter((f) => f.status === 'in_progress').length,
      resolved: resolved.length,
      downtime: resolved.reduce((n, f) => n + Number(f.downtimeMinutes || 0), 0),
    }
  }, [faults])

  const changeStatus = async (f: Fault, status: FaultStatus, question?: string) => {
    if (question && !window.confirm(question)) return
    setError(null)
    try {
      await update('faults', f.id, { status })
      void load()
      void reloadUnread().catch(() => undefined)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'active', label: `Açık arızalar (${stats.open + stats.inProgress})` },
    { key: 'mine', label: onTeam ? 'Bildirdiklerim / bana atananlar' : 'Bildirdiklerim' },
    { key: 'closed', label: 'Kapananlar' },
  ]

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Arızalar"
        subtitle="Arıza ve bakım bildirimi"
        actions={
          <Button onClick={() => setEditing({ department: me.department })}>
            <Plus className="size-4" /> Arıza bildir
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Bekleyen" value={String(stats.open)} highlight={stats.open > 0} />
        <Stat label="Bakımda" value={String(stats.inProgress)} />
        <Stat label="Bu ay giderilen" value={String(stats.resolved)} />
        <Stat label="Bu ay duruş" value={stats.downtime ? fmtMinutes(stats.downtime) : '—'} />
      </div>

      {!hasMaintenanceDept && me.role === 'admin' && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Henüz bakım birimi seçilmedi; arıza bildirimleri adminlere gidiyor. <b>Yönetim → Birimler</b> ekranından bakım birimini işaretleyin.
        </p>
      )}

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
      {!faults && <Spinner />}
      {faults && shown.length === 0 && (
        <EmptyState icon={<Wrench className="size-10" />} title={tab === 'active' ? 'Açık arıza yok' : 'Kayıt yok'}>
          {tab === 'active' && 'Bir arıza görürseniz “Arıza bildir” ile fotoğraflı bildirin.'}
        </EmptyState>
      )}

      <div className="space-y-2">
        {shown.map((f) => {
          const reporter = usersById.get(f.reportedBy)
          const isMine = f.reportedBy === me.id
          const open = f.status === 'open'
          const active = open || f.status === 'in_progress'
          // Kimin neyi yapabileceğini veritabanı da denetler (private.faults_check).
          const canEdit = (open && isMine) || (onTeam && active)
          const canCancel = (open && isMine) || (onTeam && active)
          const canReopen = f.status === 'resolved' && (isMine || onTeam)
          return (
            <article
              key={f.id}
              className={clsx('rounded-xl border bg-white p-4 shadow-sm', active && (f.urgent || f.machineStopped) ? 'border-red-200' : 'border-stone-200/70')}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-stone-900">{f.location}</h3>
                    {f.urgent && <Badge className="bg-red-100 text-red-700">Acil</Badge>}
                    {f.machineStopped && <Badge className="bg-red-50 text-red-700">Makine durdu</Badge>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500">
                    <Avatar user={reporter} size={18} />
                    {reporter?.name ?? 'Eski kullanıcı'}
                    {f.department && departmentsById.get(f.department) && ` · ${departmentsById.get(f.department)!.name}`}
                    {' · '}
                    <span title={fmtDateTime(f.created)}>{fromNow(f.created)}</span>
                  </div>
                </div>
                <Badge className={FAULT_STATUS[f.status].cls}>{FAULT_STATUS[f.status].label}</Badge>
              </div>

              <p className="mt-2 text-sm whitespace-pre-wrap text-stone-700">{f.description}</p>
              <Attachments files={f.photos} compact />

              {f.status === 'in_progress' && f.assignee && (
                <p className="mt-2 text-xs text-sky-800">
                  🛠️ {usersById.get(f.assignee)?.name ?? 'Eski kullanıcı'} ilgileniyor · {fromNow(f.takenAt)}
                </p>
              )}
              {f.status === 'resolved' && (
                <div className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">
                  <div className="whitespace-pre-wrap">{f.resolution}</div>
                  <div className="mt-1 text-xs text-green-800/80">
                    {usersById.get(f.resolvedBy)?.name ?? 'Eski kullanıcı'} · {fmtDateTime(f.resolvedAt)}
                    {f.downtimeMinutes !== '' && ` · Duruş ${fmtMinutes(Number(f.downtimeMinutes))}`}
                  </div>
                </div>
              )}

              {(canEdit || canCancel || canReopen || (onTeam && active)) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {onTeam && open && (
                    <Button size="sm" onClick={() => void changeStatus(f, 'in_progress')}>
                      <Hand className="size-4" /> Üstlen
                    </Button>
                  )}
                  {onTeam && active && (
                    <Button size="sm" onClick={() => setAction({ fault: f, kind: 'resolve' })}>
                      <Check className="size-4" /> Giderildi
                    </Button>
                  )}
                  {onTeam && active && team.length > 1 && (
                    <Button size="sm" variant="secondary" onClick={() => setAction({ fault: f, kind: 'assign' })}>
                      <UserCog className="size-4" /> {f.assignee ? 'Başkasına ata' : 'Ata'}
                    </Button>
                  )}
                  {onTeam && f.status === 'in_progress' && (
                    <Button size="sm" variant="secondary" onClick={() => void changeStatus(f, 'open', 'Arıza tekrar “bekliyor” durumuna alınsın mı?')}>
                      <RotateCcw className="size-4" /> Bırak
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>
                      <Pencil className="size-4" /> Düzenle
                    </Button>
                  )}
                  {canReopen && (
                    <Button size="sm" variant="secondary" onClick={() => void changeStatus(f, 'open', 'Arıza giderilmemiş mi? Yeniden açılıp bakım ekibine bildirilecek.')}>
                      <RotateCcw className="size-4" /> Yeniden aç
                    </Button>
                  )}
                  {canCancel && (
                    <Button size="sm" variant="secondary" onClick={() => void changeStatus(f, 'cancelled', 'Arıza bildirimi iptal edilsin mi?')}>
                      <Ban className="size-4" /> İptal et
                    </Button>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {editing && (
        <FaultEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setTab('active')
            void load()
          }}
        />
      )}
      {action?.kind === 'resolve' && (
        <ResolveModal
          fault={action.fault}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null)
            void load()
            void reloadUnread().catch(() => undefined)
          }}
        />
      )}
      {action?.kind === 'assign' && (
        <AssignModal
          fault={action.fault}
          team={team}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null)
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
    <div className={clsx('rounded-xl border p-3', highlight ? 'border-amber-200 bg-amber-50' : 'border-stone-200/70 bg-white')}>
      <div className="text-[11px] text-stone-500">{label}</div>
      <div className="text-lg font-semibold text-stone-900">{value}</div>
    </div>
  )
}

function FaultEditor({ initial, onClose, onSaved }: { initial: Partial<Fault>; onClose: () => void; onSaved: () => void }) {
  const { departments } = useData()
  const [form, setForm] = useState({
    location: initial.location ?? '',
    description: initial.description ?? '',
    department: initial.department ?? '',
    urgent: initial.urgent ?? false,
    machineStopped: initial.machineStopped ?? false,
  })
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const kept = initial.photos ?? []

  const save = async () => {
    if (!form.location.trim()) return setError('Makine ya da yeri yazın.')
    if (!form.description.trim()) return setError('Arızayı kısaca anlatın.')
    if (kept.length + files.length > MAX_ATTACHMENTS) return setError(`En fazla ${MAX_ATTACHMENTS} fotoğraf eklenebilir.`)
    setIsSaving(true)
    setError(null)
    // Fotoğraflar kaydın klasörüne yüklenir; yeni kaydın id'si bu yüzden burada üretilir.
    const id = initial.id ?? crypto.randomUUID()
    let uploaded: string[] = []
    try {
      uploaded = await uploadAttachments('faults', id, files)
      const fields = { ...form, location: form.location.trim(), description: form.description.trim(), photos: [...kept, ...uploaded] }
      if (initial.id) await update('faults', id, fields)
      else await insert('faults', { id, ...fields })
      onSaved()
    } catch (err) {
      void removeAttachments(uploaded)
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial.id ? 'Arıza bildirimini düzenle' : 'Arıza bildir'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            {initial.id ? 'Kaydet' : 'Bildir'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Makine / yer">
          <Input autoFocus maxLength={150} placeholder="ör: Dolum hattı 2, kompresör, soğuk oda kapısı" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label="Arıza">
          <Textarea rows={3} maxLength={2000} placeholder="Ne oldu? Ne zamandan beri?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Birim">
          <Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox label="Makine durdu / üretim etkileniyor" checked={form.machineStopped} onChange={(v) => setForm({ ...form, machineStopped: v })} />
          <Checkbox label="Acil" checked={form.urgent} onChange={(v) => setForm({ ...form, urgent: v })} />
        </div>
        <Field label={`Fotoğraf (en fazla ${MAX_ATTACHMENTS})`}>
          {kept.length > 0 && <Attachments files={kept} compact />}
          <div className="mt-1 flex flex-wrap items-start gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50">
              <Camera className="size-4" /> Fotoğraf çek
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  setFiles([...files, ...Array.from(e.target.files ?? [])])
                  e.target.value = ''
                }}
              />
            </label>
            <FilePicker files={files} onChange={setFiles} accept="image/*" />
          </div>
        </Field>
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}

function ResolveModal({ fault, onClose, onSaved }: { fault: Fault; onClose: () => void; onSaved: () => void }) {
  const [resolution, setResolution] = useState('')
  const [downtime, setDowntime] = useState(fault.machineStopped ? String(minutesSince(fault.created)) : '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    if (!resolution.trim()) return setError('Yapılan işlemi yazın.')
    const minutes = downtime.trim() === '' ? '' : Number(downtime)
    if (minutes !== '' && !(Number.isInteger(minutes) && minutes >= 0)) return setError('Duruş süresini dakika olarak tam sayı yazın.')
    setIsSaving(true)
    setError(null)
    try {
      await update('faults', fault.id, { status: 'resolved', resolution: resolution.trim(), ...(fault.machineStopped ? { downtimeMinutes: minutes } : {}) })
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
      title="Arıza giderildi"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            Kapat
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-semibold text-stone-800">{fault.location}</p>
        <Field label="Yapılan işlem">
          <Textarea autoFocus rows={3} maxLength={2000} placeholder="ör: Rulman değiştirildi, kayış gerildi" value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </Field>
        {fault.machineStopped && (
          <Field label="Duruş süresi (dakika)" hint={`Bildirimden bu yana ${fmtMinutes(minutesSince(fault.created))} geçti. Makine daha geç durduysa ya da önce çalıştıysa düzeltin.`}>
            <Input type="number" min={0} step={1} value={downtime} onChange={(e) => setDowntime(e.target.value)} />
          </Field>
        )}
        <p className="text-xs text-stone-500">Bildiren kişiye haber gider.</p>
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}

function AssignModal({ fault, team, onClose, onSaved }: { fault: Fault; team: User[]; onClose: () => void; onSaved: () => void }) {
  const [assignee, setAssignee] = useState(fault.assignee || team[0]?.id || '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    if (!assignee) return
    setIsSaving(true)
    setError(null)
    try {
      // Bekleyen arıza atanınca üstlenilmiş sayılır
      await update('faults', fault.id, fault.status === 'open' ? { status: 'in_progress', assignee } : { assignee })
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
      title="Arızayı ata"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            Ata
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-semibold text-stone-800">{fault.location}</p>
        <Field label="Bakım ekibinden">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs text-stone-500">Atanan kişiye ve bildirene haber gider.</p>
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}
