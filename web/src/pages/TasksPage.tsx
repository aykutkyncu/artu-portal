import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import clsx from 'clsx'
import { CalendarDays, ClipboardList, MessageSquare, Plus } from 'lucide-react'
import { startOfDay } from 'date-fns'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { isManager, pb } from '../lib/pb'
import { fmt, parseDate } from '../lib/format'
import { TASK_PRIORITY, TASK_STATUS } from '../lib/labels'
import type { Task, TaskStatus } from '../lib/types'
import { TaskDetail, TaskEditor } from '../components/TaskModals'
import { Avatar, Button, EmptyState, PageHeader, Select, Spinner } from '../components/ui'

type Scope = 'mine' | 'created' | 'all'
const STATUSES = Object.keys(TASK_STATUS) as TaskStatus[]

export default function TasksPage() {
  const me = useMe()
  const { departments } = useData()
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [scope, setScope] = useState<Scope>('mine')
  const [department, setDepartment] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>('todo')
  const [editing, setEditing] = useState<Partial<Task> | null>(null)
  const openId = params.get('id')

  const load = useCallback(async () => {
    const parts: string[] = []
    if (scope === 'mine') parts.push(pb.filter('assignees.id ?= {:me}', { me: me.id }))
    if (scope === 'created') parts.push(pb.filter('createdBy = {:me}', { me: me.id }))
    if (department) parts.push(pb.filter('department = {:d}', { d: department }))
    // Tamamlananlardan sadece son 30 gün
    if (!showDone) parts.push(pb.filter('(status != "done" || completedAt >= {:since})', { since: new Date(Date.now() - 30 * 864e5).toISOString().replace('T', ' ') }))
    const list = await pb.collection('tasks').getFullList<Task>({ filter: parts.join(' && '), sort: 'dueDate,-created', expand: 'assignees,createdBy' })
    setTasks(list)
  }, [scope, department, showDone, me.id])

  useEffect(() => {
    void load().catch(() => setTasks([]))
  }, [load])

  useEffect(() => {
    const unsub = pb.collection('tasks').subscribe('*', () => void load().catch(() => undefined))
    return () => void unsub.then((fn) => fn()).catch(() => undefined)
  }, [load])

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(STATUSES.map((s) => [s, [] as Task[]])) as Record<TaskStatus, Task[]>
    tasks?.forEach((t) => map[t.status].push(t))
    return map
  }, [tasks])

  const changeStatus = async (t: Task, status: TaskStatus) => {
    setTasks((prev) => prev?.map((x) => (x.id === t.id ? { ...x, status } : x)) ?? prev)
    await pb.collection('tasks').update(t.id, { status }).catch(() => void load())
  }

  const scopes: Array<{ key: Scope; label: string }> = [
    { key: 'mine', label: 'Bana atanan' },
    { key: 'created', label: 'Oluşturduklarım' },
    ...(isManager(me) ? [{ key: 'all' as const, label: 'Tümü' }] : []),
  ]

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Görevler"
        subtitle="İş takibi ve atamalar"
        actions={
          <Button onClick={() => setEditing({ status: 'todo', priority: 'normal', assignees: isManager(me) ? [] : [me.id] })}>
            <Plus className="size-4" /> Yeni görev
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
          {scopes.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setScope(s.key)}
              className={clsx('rounded-md px-3 py-1 text-xs font-medium', scope === s.key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500')}
            >
              {s.label}
            </button>
          ))}
        </div>
        <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-auto py-1.5 text-xs">
          <option value="">Tüm birimler</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-stone-600">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-cocoa-700" />
          Eski tamamlananları da göster
        </label>
      </div>

      {!tasks && <Spinner />}
      {tasks?.length === 0 && <EmptyState icon={<ClipboardList className="size-10" />} title="Görev yok" />}

      {tasks && tasks.length > 0 && (
        <>
          {/* Mobil: durum sekmeleri */}
          <div className="mb-3 flex gap-1 overflow-x-auto md:hidden">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMobileStatus(s)}
                className={clsx('shrink-0 rounded-full px-3 py-1 text-xs font-medium', mobileStatus === s ? 'bg-cocoa-700 text-white' : 'bg-white text-stone-600 ring-1 ring-stone-200')}
              >
                {TASK_STATUS[s].label} ({byStatus[s].length})
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            {STATUSES.map((s) => (
              <section key={s} className={clsx('rounded-2xl bg-stone-100/70 p-2', mobileStatus !== s && 'hidden md:block')}>
                <h2 className="mb-2 hidden items-center justify-between px-2 pt-1 text-xs font-semibold tracking-wide text-stone-600 uppercase md:flex">
                  {TASK_STATUS[s].label}
                  <span className="rounded-full bg-white px-2 text-stone-500">{byStatus[s].length}</span>
                </h2>
                <div className="space-y-2">
                  {byStatus[s].map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={() => setParams({ id: t.id })} onStatus={(st) => void changeStatus(t, st)} />
                  ))}
                  {byStatus[s].length === 0 && <p className="py-6 text-center text-xs text-stone-400">Boş</p>}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {openId && (
        <TaskDetail
          taskId={openId}
          onClose={() => setParams({}, { replace: true })}
          onEdit={(t) => {
            setParams({}, { replace: true })
            setEditing(t)
          }}
          onChanged={() => void load()}
        />
      )}
      {editing && (
        <TaskEditor
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

function TaskCard({ task, onOpen, onStatus }: { task: Task; onOpen: () => void; onStatus: (s: TaskStatus) => void }) {
  const due = parseDate(task.dueDate)
  const overdue = due && task.status !== 'done' && due.getTime() < startOfDay(new Date()).getTime()
  return (
    <article className="rounded-xl border border-stone-200/70 bg-white p-3 shadow-sm">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="flex items-start gap-2">
          <span className={clsx('mt-0.5 text-[10px] font-bold uppercase', TASK_PRIORITY[task.priority].cls)}>{task.priority !== 'normal' && TASK_PRIORITY[task.priority].label}</span>
        </div>
        <h3 className={clsx('text-sm font-medium text-stone-800', task.status === 'done' && 'text-stone-400 line-through')}>{task.title}</h3>
        {task.description && <p className="mt-0.5 line-clamp-2 text-xs text-stone-500">{task.description}</p>}
      </button>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex -space-x-1.5">
          {task.expand?.assignees?.slice(0, 4).map((u) => <Avatar key={u.id} user={u} size={22} className="ring-2 ring-white" />)}
        </div>
        <div className="flex items-center gap-2">
          {due && (
            <span className={clsx('flex items-center gap-1 text-[11px]', overdue ? 'font-semibold text-red-600' : 'text-stone-500')}>
              <CalendarDays className="size-3" /> {fmt(due, 'd MMM')}
            </span>
          )}
          <MessageSquare className="size-3 text-stone-300" />
        </div>
      </div>
      <select
        value={task.status}
        onChange={(e) => onStatus(e.target.value as TaskStatus)}
        aria-label="Durum"
        className={clsx('mt-2 w-full rounded-md border-0 px-2 py-1 text-xs font-medium', TASK_STATUS[task.status].cls)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS[s].label}
          </option>
        ))}
      </select>
    </article>
  )
}
