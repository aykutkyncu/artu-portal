import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import listPlugin from '@fullcalendar/list'
import interactionPlugin, { type DateClickArg } from '@fullcalendar/interaction'
import trLocale from '@fullcalendar/core/locales/tr'
import type { EventClickArg, EventInput, EventSourceFuncArg } from '@fullcalendar/core'
import clsx from 'clsx'
import { Plus, MapPin, Clock, Users as UsersIcon, Pencil, Trash2 } from 'lucide-react'
import { addHours } from 'date-fns'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, isManager, remove as removeRecord, row, rows, subscribe, supabase, update } from '../lib/db'
import { fmt, fmtDateTime, fromLocalInput, parseDate, toLocalInput, isoDay } from '../lib/format'
import { EVENT_CATEGORY } from '../lib/labels'
import type { CalendarEvent, EventCategory } from '../lib/types'
import { DepartmentPicker, UserPicker } from '../components/pickers'
import { Avatar, Button, Checkbox, ErrorNote, Field, Input, Modal, PageHeader, Select, Textarea } from '../components/ui'

export default function CalendarPage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const calendarRef = useRef<FullCalendar>(null)
  const [hidden, setHidden] = useState<Set<EventCategory>>(new Set())
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const [editing, setEditing] = useState<Partial<CalendarEvent> | null>(null)
  const isMobile = window.matchMedia('(max-width: 640px)').matches

  const fetchEvents = useCallback(
    async (info: EventSourceFuncArg): Promise<EventInput[]> => {
      // Görünen aralığa denk gelenler: aralık bitmeden başlamış ve (aralıkta ya da sonra bitiyor / aralıkta başlıyor)
      const from = info.start.toISOString()
      const list = await rows<CalendarEvent>(
        supabase
          .from('events')
          .select('*')
          .lt('start', info.end.toISOString())
          .or(`end.gte."${from}",start.gte."${from}"`)
          .order('start'),
      )
      return list
        .filter((e) => !hidden.has(e.category))
        .map((e) => ({
          id: e.id,
          title: e.title,
          start: parseDate(e.start) ?? undefined,
          end: parseDate(e.end) ?? undefined,
          allDay: e.allDay,
          backgroundColor: EVENT_CATEGORY[e.category].color,
          borderColor: EVENT_CATEGORY[e.category].color,
          extendedProps: { record: e },
        }))
    },
    [hidden],
  )

  const refetch = () => calendarRef.current?.getApi().refetchEvents()

  // Kategori filtresi değişince görünümü/tarihi koruyarak yeniden yükle.
  useEffect(() => {
    refetch()
  }, [hidden])

  // Bildirimden gelen ?id= ile etkinliği aç.
  useEffect(() => {
    const id = params.get('id')
    if (!id) return
    row<CalendarEvent>(supabase.from('events').select('*').eq('id', id).single())
      .then((e) => {
        setSelected(e)
        calendarRef.current?.getApi().gotoDate(parseDate(e.start) ?? new Date())
      })
      .catch(() => undefined)
  }, [params])

  useEffect(() => {
    return subscribe('events', () => refetch())
  }, [])

  const openNew = (start?: Date, allDay = false) => {
    const s = start ?? new Date()
    setEditing({ title: '', start: s.toISOString(), end: addHours(s, 1).toISOString(), allDay, category: 'meeting', participants: [], departments: [] })
  }

  const canEdit = (e: CalendarEvent) => e.createdBy === me.id || isManager(me)

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Takvim"
        subtitle="Toplantılar, sevkiyatlar, izinler ve şirket etkinlikleri"
        actions={
          <Button onClick={() => openNew()}>
            <Plus className="size-4" /> Etkinlik ekle
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(EVENT_CATEGORY) as EventCategory[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setHidden((h) => (h.has(c) ? new Set([...h].filter((x) => x !== c)) : new Set([...h, c])))}
            className={clsx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', hidden.has(c) ? 'border-stone-200 text-stone-400' : 'border-stone-300 bg-white text-stone-700')}
          >
            <span className="size-2.5 rounded-full" style={{ background: hidden.has(c) ? '#d6d3d1' : EVENT_CATEGORY[c].color }} />
            {EVENT_CATEGORY[c].label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-stone-200/70 bg-white p-2 shadow-sm sm:p-4">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={trLocale}
          initialView={isMobile ? 'listWeek' : 'dayGridMonth'}
          headerToolbar={isMobile ? { left: 'prev,next', center: 'title', right: 'listWeek,dayGridMonth' } : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' }}
          height="auto"
          firstDay={1}
          nowIndicator
          dayMaxEvents={3}
          slotMinTime="06:00:00"
          slotMaxTime="23:00:00"
          events={fetchEvents}
          dateClick={(arg: DateClickArg) => openNew(arg.allDay ? new Date(arg.date.setHours(9)) : arg.date, false)}
          eventClick={(arg: EventClickArg) => setSelected(arg.event.extendedProps.record as CalendarEvent)}
        />
      </div>

      {selected && (
        <EventDetail
          event={selected}
          canEdit={canEdit(selected)}
          onClose={() => {
            setSelected(null)
            if (params.has('id')) setParams({}, { replace: true })
          }}
          onEdit={() => {
            setEditing(selected)
            setSelected(null)
          }}
          onDeleted={() => {
            setSelected(null)
            refetch()
          }}
        />
      )}
      {editing && (
        <EventEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refetch()
          }}
        />
      )}
    </div>
  )
}

function EventDetail({ event, canEdit, onClose, onEdit, onDeleted }: { event: CalendarEvent; canEdit: boolean; onClose: () => void; onEdit: () => void; onDeleted: () => void }) {
  const { usersById } = useData()
  const [error, setError] = useState<string | null>(null)
  const cat = EVENT_CATEGORY[event.category]
  const participants = event.participants.map((id) => usersById.get(id)).filter((u) => u !== undefined)
  const remove = async () => {
    if (!window.confirm('Etkinlik silinsin mi?')) return
    try {
      await removeRecord('events', event.id)
      onDeleted()
    } catch (err) {
      setError(errorMessage(err))
    }
  }
  const when = event.allDay
    ? `${fmt(event.start, 'd MMMM yyyy EEEE')}${event.end && isoDay(parseDate(event.end)!) !== isoDay(parseDate(event.start)!) ? ` – ${fmt(event.end, 'd MMMM')}` : ''}`
    : `${fmtDateTime(event.start)}${event.end ? ` – ${fmt(event.end, 'HH:mm')}` : ''}`

  return (
    <Modal
      open
      onClose={onClose}
      title={event.title}
      footer={
        canEdit && (
          <>
            <Button variant="ghost" onClick={remove} className="mr-auto text-red-600">
              <Trash2 className="size-4" /> Sil
            </Button>
            <Button onClick={onEdit}>
              <Pencil className="size-4" /> Düzenle
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white" style={{ background: cat.color }}>
          {cat.label}
        </span>
        <p className="flex items-center gap-2 text-stone-700">
          <Clock className="size-4 text-stone-400" /> {when}
        </p>
        {event.location && (
          <p className="flex items-center gap-2 text-stone-700">
            <MapPin className="size-4 text-stone-400" /> {event.location}
          </p>
        )}
        {event.description && <p className="whitespace-pre-wrap text-stone-600">{event.description}</p>}
        {participants.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-stone-500">
              <UsersIcon className="size-4" /> Katılımcılar
            </p>
            <div className="flex flex-wrap gap-1.5">
              {participants.map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 py-0.5 pr-2.5 pl-0.5 text-xs">
                  <Avatar user={u} size={20} /> {u.name}
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-stone-400">Ekleyen: {usersById.get(event.createdBy)?.name}</p>
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}

function EventEditor({ initial, onClose, onSaved }: { initial: Partial<CalendarEvent>; onClose: () => void; onSaved: () => void }) {
  const me = useMe()
  const { departments } = useData()
  const [form, setForm] = useState({
    title: initial.title ?? '',
    description: initial.description ?? '',
    start: toLocalInput(initial.start),
    end: toLocalInput(initial.end),
    allDay: initial.allDay ?? false,
    category: (initial.category ?? 'meeting') as EventCategory,
    location: initial.location ?? '',
    participants: initial.participants ?? [],
    departments: initial.departments ?? [],
  })
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.title.trim() || !form.start) return setError('Başlık ve başlangıç zorunludur.')
    if (form.end && form.end < form.start) return setError('Bitiş, başlangıçtan önce olamaz.')
    setIsSaving(true)
    setError(null)
    const payload = {
      ...form,
      title: form.title.trim(),
      start: fromLocalInput(form.allDay ? `${form.start.slice(0, 10)}T00:00` : form.start),
      end: form.end ? fromLocalInput(form.allDay ? `${form.end.slice(0, 10)}T23:59` : form.end) : '',
    }
    try {
      if (initial.id) await update('events', initial.id, payload)
      else await insert('events', { ...payload, createdBy: me.id })
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
      title={initial.id ? 'Etkinliği düzenle' : 'Yeni etkinlik'}
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Başlık" className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus maxLength={200} />
        </Field>
        <Field label="Tür">
          <Select value={form.category} onChange={(e) => set('category', e.target.value as EventCategory)}>
            {(Object.keys(EVENT_CATEGORY) as EventCategory[]).map((c) => (
              <option key={c} value={c}>
                {EVENT_CATEGORY[c].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Yer">
          <Input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Toplantı odası, depo…" />
        </Field>
        <Field label="Başlangıç">
          <Input type="datetime-local" value={form.start} onChange={(e) => set('start', e.target.value)} />
        </Field>
        <Field label="Bitiş">
          <Input type="datetime-local" value={form.end} onChange={(e) => set('end', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox label="Tüm gün" checked={form.allDay} onChange={(v) => set('allDay', v)} />
        </div>
        <Field label="Açıklama" className="sm:col-span-2">
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} />
        </Field>
        {departments.length > 0 && (
          <Field label="İlgili birimler" className="sm:col-span-2">
            <DepartmentPicker value={form.departments} onChange={(v) => set('departments', v)} emptyLabel="Genel" />
          </Field>
        )}
        <Field label="Katılımcılar (bildirim gider)" className="sm:col-span-2">
          <UserPicker value={form.participants} onChange={(v) => set('participants', v)} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorNote message={error} />
        </div>
      </div>
    </Modal>
  )
}
