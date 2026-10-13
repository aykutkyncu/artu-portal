import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CalendarDays, ClipboardList, Factory, Megaphone, MessageCircle, Pin, CalendarClock, ChevronRight } from 'lucide-react'
import { endOfDay, startOfDay } from 'date-fns'
import clsx from 'clsx'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { pb } from '../lib/pb'
import { fmt, fmtShort, isoDay, parseDate } from '../lib/format'
import { EVENT_CATEGORY, PRIORITY, SHIFT_KIND, TASK_PRIORITY, TASK_STATUS } from '../lib/labels'
import type { Announcement, CalendarEvent, ProductionPlan, Shift, Task } from '../lib/types'
import { Badge } from '../components/ui'
import { PushPrompt } from '../components/PushPrompt'

interface Dashboard {
  announcements: Announcement[]
  tasks: Task[]
  events: CalendarEvent[]
  shift: Shift | null
  plans: ProductionPlan[]
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'İyi geceler'
  if (h < 12) return 'Günaydın'
  if (h < 18) return 'İyi günler'
  return 'İyi akşamlar'
}

function Card({ title, icon, to, children }: { title: string; icon: ReactNode; to: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200/70 bg-white shadow-sm">
      <Link to={to} className="flex items-center justify-between border-b border-stone-100 px-4 py-3 hover:bg-stone-50/60">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-800">
          <span className="text-cocoa-600">{icon}</span>
          {title}
        </h2>
        <ChevronRight className="size-4 text-stone-400" />
      </Link>
      <div className="p-2">{children}</div>
    </section>
  )
}

const Empty = ({ text }: { text: string }) => <p className="px-2 py-4 text-center text-sm text-stone-400">{text}</p>

export default function HomePage() {
  const me = useMe()
  const { unread, totalUnreadMessages } = useData()
  const [data, setData] = useState<Dashboard | null>(null)

  useEffect(() => {
    const today = new Date()
    const dayStart = startOfDay(today).toISOString().replace('T', ' ')
    const dayEnd = endOfDay(today).toISOString().replace('T', ' ')
    const todayIso = isoDay(today)

    Promise.all([
      pb.collection('announcements').getList<Announcement>(1, 4, { sort: '-pinned,-created', expand: 'author' }),
      pb.collection('tasks').getList<Task>(1, 6, {
        filter: pb.filter('assignees.id ?= {:me} && status != "done"', { me: me.id }),
        sort: 'dueDate,-created',
      }),
      pb.collection('events').getFullList<CalendarEvent>({
        filter: pb.filter('start <= {:end} && (end >= {:start} || (end = "" && start >= {:start}))', { start: dayStart, end: dayEnd }),
        sort: 'start',
      }),
      pb.collection('shifts').getFirstListItem<Shift>(pb.filter('user = {:me} && date = {:d}', { me: me.id, d: todayIso })).catch(() => null),
      pb.collection('production_plans').getFullList<ProductionPlan>({ filter: pb.filter('date = {:d}', { d: todayIso }), sort: 'line' }),
    ])
      .then(([a, t, e, s, p]) => setData({ announcements: a.items, tasks: t.items, events: e, shift: s, plans: p }))
      .catch(() => setData({ announcements: [], tasks: [], events: [], shift: null, plans: [] }))
  }, [me.id])

  const shiftInfo = data?.shift ? SHIFT_KIND[data.shift.kind] : null

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <p className="text-sm text-stone-500">{fmt(new Date(), 'd MMMM yyyy, EEEE')}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          {greeting()}, {me.name.split(' ')[0]}
        </h1>
      </div>

      <PushPrompt />

      {/* Hızlı özet şeritleri */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link to="/duyurular" className="rounded-2xl bg-cocoa-800 p-4 text-white shadow-sm">
          <Megaphone className="size-5 text-cream" />
          <div className="mt-3 text-2xl font-semibold">{unread.announcements}</div>
          <div className="text-xs text-cocoa-200">okunmamış duyuru</div>
        </Link>
        <Link to="/mesajlar" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/70">
          <MessageCircle className="size-5 text-cocoa-600" />
          <div className="mt-3 text-2xl font-semibold text-stone-900">{totalUnreadMessages}</div>
          <div className="text-xs text-stone-500">okunmamış mesaj</div>
        </Link>
        <Link to="/gorevler" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200/70">
          <ClipboardList className="size-5 text-cocoa-600" />
          <div className="mt-3 text-2xl font-semibold text-stone-900">{data?.tasks.length ?? '–'}</div>
          <div className="text-xs text-stone-500">açık görevim</div>
        </Link>
        <Link to="/vardiya" className={clsx('rounded-2xl p-4 shadow-sm ring-1 ring-stone-200/70', shiftInfo ? shiftInfo.cls : 'bg-white')}>
          <CalendarClock className="size-5" />
          <div className="mt-3 text-lg font-semibold">{shiftInfo?.label ?? 'Vardiya yok'}</div>
          <div className="text-xs opacity-75">
            {data?.shift?.startTime ? `${data.shift.startTime} – ${data.shift.endTime}` : 'bugünkü vardiyam'}
          </div>
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Son Duyurular" icon={<Megaphone className="size-4" />} to="/duyurular">
          {data?.announcements.length === 0 && <Empty text="Henüz duyuru yok" />}
          {data?.announcements.map((a) => (
            <Link key={a.id} to={`/duyurular/${a.id}`} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-stone-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {a.pinned && <Pin className="size-3.5 shrink-0 text-cocoa-500" />}
                  <span className="truncate text-sm font-medium text-stone-800">{a.title}</span>
                </div>
                <div className="text-xs text-stone-500">
                  {a.expand?.author?.name} · {fmtShort(a.created)}
                </div>
              </div>
              {a.priority !== 'normal' && <Badge className={PRIORITY[a.priority].cls}>{PRIORITY[a.priority].label}</Badge>}
            </Link>
          ))}
        </Card>

        <Card title="Görevlerim" icon={<ClipboardList className="size-4" />} to="/gorevler">
          {data?.tasks.length === 0 && <Empty text="Açık göreviniz yok 🎉" />}
          {data?.tasks.map((t) => {
            const overdue = t.dueDate && (parseDate(t.dueDate)?.getTime() ?? 0) < startOfDay(new Date()).getTime()
            return (
              <Link key={t.id} to={`/gorevler?id=${t.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-stone-50">
                <span className={clsx('text-xs font-semibold', TASK_PRIORITY[t.priority].cls)}>●</span>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-800">{t.title}</span>
                {t.dueDate && <span className={clsx('text-xs', overdue ? 'font-medium text-red-600' : 'text-stone-500')}>{fmt(t.dueDate, 'd MMM')}</span>}
                <Badge className={TASK_STATUS[t.status].cls}>{TASK_STATUS[t.status].label}</Badge>
              </Link>
            )
          })}
        </Card>

        <Card title="Bugün Takvimde" icon={<CalendarDays className="size-4" />} to="/takvim">
          {data?.events.length === 0 && <Empty text="Bugün planlanmış etkinlik yok" />}
          {data?.events.map((e) => (
            <Link key={e.id} to={`/takvim?id=${e.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-stone-50">
              <span className="h-8 w-1 rounded-full" style={{ background: EVENT_CATEGORY[e.category].color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-stone-800">{e.title}</div>
                <div className="text-xs text-stone-500">
                  {e.allDay ? 'Tüm gün' : fmt(e.start, 'HH:mm')} · {EVENT_CATEGORY[e.category].label}
                  {e.location && ` · ${e.location}`}
                </div>
              </div>
            </Link>
          ))}
        </Card>

        <Card title="Bugünkü Üretim" icon={<Factory className="size-4" />} to="/uretim">
          {data?.plans.length === 0 && <Empty text="Bugün için üretim planı girilmemiş" />}
          {data?.plans.map((p) => {
            const pct = p.quantity ? Math.min(100, Math.round(((p.producedQuantity ?? 0) / p.quantity) * 100)) : 0
            return (
              <div key={p.id} className="rounded-lg px-2 py-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate font-medium text-stone-800">{p.product}</span>
                  <span className="text-xs text-stone-500">
                    {p.producedQuantity ?? 0}/{p.quantity} {p.unit}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-stone-100">
                  <div className="h-1.5 rounded-full bg-cocoa-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </Card>
      </div>
    </div>
  )
}
