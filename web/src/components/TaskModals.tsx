import { useEffect, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { CalendarDays, Pencil, SendHorizontal, Trash2 } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, isAdmin, isManager, remove as removeRecord, row, rows, supabase, update } from '../lib/db'
import { MAX_ATTACHMENTS, removeAttachments, uploadAttachments } from '../lib/files'
import { fmt, fmtDateTime, fromNow } from '../lib/format'
import { TASK_PRIORITY, TASK_STATUS } from '../lib/labels'
import type { Task, TaskComment, TaskPriority, TaskStatus } from '../lib/types'
import { UserPicker } from './pickers'
import { Attachments, Avatar, Badge, Button, ErrorNote, Field, FilePicker, Input, Modal, Select, Spinner, Textarea } from './ui'

export function TaskDetail({ taskId, onClose, onEdit, onChanged }: { taskId: string; onClose: () => void; onEdit: (t: Task) => void; onChanged: () => void }) {
  const me = useMe()
  const { departmentsById, usersById } = useData()
  const [task, setTask] = useState<Task | null>(null)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    row<Task>(supabase.from('tasks').select('*').eq('id', taskId).single())
      .then(setTask)
      .catch((err) => setError(errorMessage(err)))
    rows<TaskComment>(supabase.from('task_comments').select('*').eq('task', taskId).order('created'))
      .then(setComments)
      .catch(() => undefined)
  }, [taskId])

  const canEdit = task && (task.createdBy === me.id || isManager(me))
  const canDelete = task && (task.createdBy === me.id || isAdmin(me))

  const setStatus = async (status: TaskStatus) => {
    if (!task) return
    try {
      setTask(await update<Task>('tasks', task.id, { status }))
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const addComment = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    setIsSending(true)
    try {
      const c = await insert<TaskComment>('task_comments', { task: taskId, author: me.id, text: text.trim() })
      setComments((prev) => [...prev, c])
      setText('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSending(false)
    }
  }

  const remove = async () => {
    if (!task || !window.confirm('Görev silinsin mi?')) return
    try {
      await removeRecord('tasks', task.id)
      void removeAttachments(task.attachments)
      onChanged()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={task?.title ?? 'Görev'}
      footer={
        task && (canEdit || canDelete) ? (
          <>
            {canDelete && (
              <Button variant="ghost" onClick={remove} className="mr-auto text-red-600">
                <Trash2 className="size-4" /> Sil
              </Button>
            )}
            {canEdit && (
              <Button variant="secondary" onClick={() => onEdit(task)}>
                <Pencil className="size-4" /> Düzenle
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {!task ? (
        error ? <ErrorNote message={error} /> : <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void setStatus(s)}
                className={clsx('rounded-full px-3 py-1 text-xs font-medium ring-1', task.status === s ? `${TASK_STATUS[s].cls} ring-current` : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50')}
              >
                {TASK_STATUS[s].label}
              </button>
            ))}
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-stone-500">Öncelik</dt>
              <dd className={clsx('font-medium', TASK_PRIORITY[task.priority].cls)}>{TASK_PRIORITY[task.priority].label}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Son tarih</dt>
              <dd className="flex items-center gap-1 text-stone-800">
                <CalendarDays className="size-3.5 text-stone-400" /> {task.dueDate ? fmt(task.dueDate, 'd MMM yyyy') : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Birim</dt>
              <dd className="text-stone-800">{departmentsById.get(task.department)?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Oluşturan</dt>
              <dd className="text-stone-800">{usersById.get(task.createdBy)?.name}</dd>
            </div>
          </dl>

          {task.description && <p className="rounded-xl bg-stone-50 p-3 text-sm whitespace-pre-wrap text-stone-700">{task.description}</p>}
          <Attachments files={task.attachments} />

          <div>
            <p className="mb-1.5 text-xs font-medium text-stone-500">Atananlar</p>
            <div className="flex flex-wrap gap-1.5">
              {task.assignees.map((id) => (
                <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 py-0.5 pr-2.5 pl-0.5 text-xs">
                  <Avatar user={usersById.get(id)} size={20} /> {usersById.get(id)?.name ?? 'Eski kullanıcı'}
                </span>
              ))}
              {!task.assignees?.length && <span className="text-sm text-stone-400">Atanmamış</span>}
            </div>
          </div>

          {task.completedAt && <Badge className="bg-green-50 text-green-700">Tamamlandı: {fmtDateTime(task.completedAt)}</Badge>}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-stone-800">Yorumlar</h3>
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2.5">
                  <Avatar user={usersById.get(c.author)} size={28} />
                  <div className="flex-1 rounded-xl bg-stone-50 px-3 py-2">
                    <div className="text-xs">
                      <span className="font-medium text-stone-800">{usersById.get(c.author)?.name}</span> <span className="text-stone-400">· {fromNow(c.created)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap text-stone-700">{c.text}</p>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <p className="text-sm text-stone-400">Henüz yorum yok.</p>}
            </div>
            <form onSubmit={addComment} className="mt-3 flex gap-2">
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Yorum yazın…" />
              <Button type="submit" isLoading={isSending} aria-label="Gönder">
                <SendHorizontal className="size-4" />
              </Button>
            </form>
          </section>
          <ErrorNote message={error} />
        </div>
      )}
    </Modal>
  )
}

export function TaskEditor({ initial, onClose, onSaved }: { initial: Partial<Task>; onClose: () => void; onSaved: () => void }) {
  const me = useMe()
  const { departments } = useData()
  const [form, setForm] = useState({
    title: initial.title ?? '',
    description: initial.description ?? '',
    status: (initial.status ?? 'todo') as TaskStatus,
    priority: (initial.priority ?? 'normal') as TaskPriority,
    dueDate: initial.dueDate ? initial.dueDate.slice(0, 10) : '',
    assignees: initial.assignees ?? [],
    department: initial.department ?? me.department ?? '',
  })
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.title.trim()) return setError('Başlık zorunludur.')
    const kept = initial.attachments ?? []
    if (kept.length + files.length > MAX_ATTACHMENTS) return setError(`Bir göreve en fazla ${MAX_ATTACHMENTS} dosya eklenebilir.`)
    setIsSaving(true)
    setError(null)
    // Ekler kaydın klasörüne yüklenir; yeni görevin id'si bu yüzden burada üretilir.
    const id = initial.id ?? crypto.randomUUID()
    let uploaded: string[] = []
    try {
      uploaded = await uploadAttachments('tasks', id, files)
      const fields = {
        ...form,
        title: form.title.trim(),
        // Gün sonu: yerel 23:59 → son tarih o günün tamamını kapsar
        dueDate: form.dueDate ? new Date(`${form.dueDate}T23:59:00`).toISOString() : '',
        attachments: [...kept, ...uploaded],
      }
      if (initial.id) await update('tasks', id, fields)
      else await insert('tasks', { id, ...fields, createdBy: me.id })
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
      wide
      onClose={onClose}
      title={initial.id ? 'Görevi düzenle' : 'Yeni görev'}
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
        <Field label="Açıklama" className="sm:col-span-2">
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={4} />
        </Field>
        <Field label="Öncelik">
          <Select value={form.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
            {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY[p].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Son tarih">
          <Input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label="Durum">
          <Select value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Birim">
          <Select value={form.department} onChange={(e) => set('department', e.target.value)}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Atanacak kişiler (bildirim gider)" className="sm:col-span-2">
          <UserPicker value={form.assignees} onChange={(v) => set('assignees', v)} />
        </Field>
        <div className="sm:col-span-2">
          <FilePicker files={files} onChange={setFiles} />
        </div>
        <div className="sm:col-span-2">
          <ErrorNote message={error} />
        </div>
      </div>
    </Modal>
  )
}
