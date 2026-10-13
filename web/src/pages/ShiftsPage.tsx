import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { addDays, addWeeks, isToday } from 'date-fns'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, isManager, remove as removeRecord, rows as fetchRows, run, supabase, toRow, update } from '../lib/db'
import { fmt, isoDay, weekDays } from '../lib/format'
import { SHIFT_KIND } from '../lib/labels'
import type { Shift, ShiftKind, User } from '../lib/types'
import { Avatar, Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui'

const KINDS = Object.keys(SHIFT_KIND) as ShiftKind[]

export default function ShiftsPage() {
  const me = useMe()
  const { users, departments } = useData()
  const canEdit = isManager(me)
  const [anchor, setAnchor] = useState(new Date())
  const [department, setDepartment] = useState(me.department ?? '')
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [cell, setCell] = useState<{ user: User; date: string; shift?: Shift } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCopying, setIsCopying] = useState(false)

  const days = useMemo(() => weekDays(anchor), [anchor])
  const from = isoDay(days[0]!)
  const to = isoDay(days[6]!)

  const load = useCallback(async () => {
    setShifts(await fetchRows<Shift>(supabase.from('shifts').select('*').gte('date', from).lte('date', to)))
  }, [from, to])

  useEffect(() => {
    void load().catch(() => setShifts([]))
  }, [load])

  const rows = useMemo(() => users.filter((u) => !department || u.department === department), [users, department])
  const index = useMemo(() => new Map((shifts ?? []).map((s) => [`${s.user}|${s.date}`, s])), [shifts])

  /** Geçen haftanın vardiyasını bu haftaya kopyalar (boş günlere). */
  const copyLastWeek = async () => {
    if (!window.confirm('Geçen haftanın vardiyaları bu haftadaki boş günlere kopyalansın mı?')) return
    setIsCopying(true)
    setError(null)
    try {
      const prevFrom = isoDay(addDays(days[0]!, -7))
      const prevTo = isoDay(addDays(days[6]!, -7))
      const prev = await fetchRows<Shift>(supabase.from('shifts').select('*').gte('date', prevFrom).lte('date', prevTo))
      const rowIds = new Set(rows.map((r) => r.id))
      const copies: Array<Record<string, unknown>> = []
      for (const s of prev) {
        if (!rowIds.has(s.user)) continue
        const date = isoDay(addDays(new Date(`${s.date}T12:00:00`), 7))
        if (index.has(`${s.user}|${date}`)) continue
        copies.push(toRow({ user: s.user, date, kind: s.kind, startTime: s.startTime, endTime: s.endTime, department: s.department, note: s.note }))
      }
      if (copies.length) await run(supabase.from('shifts').insert(copies))
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsCopying(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Vardiya Planı"
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
              <Button variant="secondary" onClick={copyLastWeek} isLoading={isCopying}>
                <Copy className="size-4" /> Geçen haftayı kopyala
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-auto py-1.5 text-xs">
          <option value="">Tüm birimler</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <span key={k} className={clsx('rounded px-1.5 py-0.5 text-[10px] font-medium', SHIFT_KIND[k].cls)}>
              {SHIFT_KIND[k].short} = {SHIFT_KIND[k].label}
            </span>
          ))}
        </div>
      </div>
      <ErrorNote message={error} />

      {!shifts ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-100">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-medium text-stone-500">Personel</th>
                {days.map((d) => (
                  <th key={d.toISOString()} className={clsx('px-1 py-2 text-center text-xs font-medium', isToday(d) ? 'text-cocoa-700' : 'text-stone-500')}>
                    <div>{fmt(d, 'EEE')}</div>
                    <div className={clsx('mx-auto mt-0.5 w-7 rounded-full', isToday(d) && 'bg-cocoa-700 text-white')}>{fmt(d, 'd')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={clsx('border-b border-stone-50', u.id === me.id && 'bg-cocoa-50/60')}>
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5">
                    <div className="flex items-center gap-2 bg-inherit">
                      <Avatar user={u} size={26} />
                      <span className="max-w-36 truncate text-xs font-medium text-stone-700">{u.name}</span>
                    </div>
                  </td>
                  {days.map((d) => {
                    const date = isoDay(d)
                    const s = index.get(`${u.id}|${date}`)
                    const kind = s ? SHIFT_KIND[s.kind] : null
                    return (
                      <td key={date} className="p-1 text-center">
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => setCell({ user: u, date, shift: s })}
                          className={clsx(
                            'flex h-11 w-full flex-col items-center justify-center rounded-lg text-[11px] leading-tight transition',
                            kind ? kind.cls : 'text-stone-300',
                            canEdit && 'hover:ring-2 hover:ring-cocoa-300',
                          )}
                          title={s?.note || undefined}
                        >
                          {kind ? (
                            <>
                              <span className="font-semibold">{kind.short}</span>
                              {s?.startTime && (
                                <span className="opacity-80">
                                  {s.startTime}-{s.endTime}
                                </span>
                              )}
                            </>
                          ) : canEdit ? (
                            '+'
                          ) : (
                            '·'
                          )}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cell && (
        <ShiftEditor
          cell={cell}
          onClose={() => setCell(null)}
          onSaved={() => {
            setCell(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function ShiftEditor({ cell, onClose, onSaved }: { cell: { user: User; date: string; shift?: Shift }; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<ShiftKind>(cell.shift?.kind ?? 'morning')
  const [startTime, setStartTime] = useState(cell.shift?.startTime ?? SHIFT_KIND.morning.start ?? '')
  const [endTime, setEndTime] = useState(cell.shift?.endTime ?? SHIFT_KIND.morning.end ?? '')
  const [note, setNote] = useState(cell.shift?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const hasTimes = Boolean(SHIFT_KIND[kind].start)

  const pickKind = (k: ShiftKind) => {
    setKind(k)
    setStartTime(SHIFT_KIND[k].start ?? '')
    setEndTime(SHIFT_KIND[k].end ?? '')
  }

  const save = async () => {
    setIsSaving(true)
    setError(null)
    const data = { user: cell.user.id, date: cell.date, kind, startTime: hasTimes ? startTime : '', endTime: hasTimes ? endTime : '', note, department: cell.user.department }
    try {
      if (cell.shift) await update('shifts', cell.shift.id, data)
      else await insert('shifts', data)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  const clear = async () => {
    if (!cell.shift) return onClose()
    try {
      await removeRecord('shifts', cell.shift.id)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${cell.user.name} · ${fmt(new Date(`${cell.date}T12:00:00`), 'd MMMM EEEE')}`}
      footer={
        <>
          {cell.shift && (
            <Button variant="ghost" onClick={clear} className="mr-auto text-red-600">
              Temizle
            </Button>
          )}
          <Button onClick={save} isLoading={isSaving}>
            Kaydet
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pickKind(k)}
              className={clsx('rounded-lg px-2 py-2 text-xs font-medium ring-1', kind === k ? `${SHIFT_KIND[k].cls} ring-current` : 'bg-white text-stone-600 ring-stone-200')}
            >
              {SHIFT_KIND[k].label}
            </button>
          ))}
        </div>
        {hasTimes && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Başlangıç">
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="Bitiş">
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Not">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Opsiyonel" />
        </Field>
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}
