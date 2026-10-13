import { useState } from 'react'
import { useMe } from '../context/AuthContext'
import { errorMessage, pb } from '../lib/pb'
import { htmlToPlain, plainToHtml } from '../lib/richtext'
import { toFormData } from '../lib/upload'
import { PRIORITY } from '../lib/labels'
import type { Announcement, Priority } from '../lib/types'
import { DepartmentPicker } from './pickers'
import { Button, Checkbox, ErrorNote, Field, FilePicker, Input, Modal, Textarea } from './ui'

export function AnnouncementEditor({
  open,
  onClose,
  onSaved,
  existing,
}: {
  open: boolean
  onClose: () => void
  onSaved: (a: Announcement) => void
  existing?: Announcement | null
}) {
  const me = useMe()
  const [title, setTitle] = useState(existing?.title ?? '')
  const [body, setBody] = useState(existing ? htmlToPlain(existing.body) : '')
  const [departments, setDepartments] = useState<string[]>(existing?.departments ?? [])
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? 'normal')
  const [pinned, setPinned] = useState(existing?.pinned ?? false)
  const [requireAck, setRequireAck] = useState(existing?.requireAck ?? false)
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    if (!title.trim()) return setError('Başlık zorunludur.')
    setError(null)
    setIsSaving(true)
    try {
      const data = await toFormData(
        {
          title: title.trim(),
          body: plainToHtml(body),
          departments,
          priority,
          pinned,
          requireAck,
          ...(existing ? {} : { author: me.id }),
        },
        files,
      )
      const saved = existing
        ? await pb.collection('announcements').update<Announcement>(existing.id, data, { expand: 'author' })
        : await pb.collection('announcements').create<Announcement>(data, { expand: 'author' })
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Duyuruyu düzenle' : 'Yeni duyuru'}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            {existing ? 'Kaydet' : 'Yayınla'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Başlık">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Örn: Pazartesi bakım çalışması" autoFocus />
        </Field>
        <Field label="İçerik" hint="Boş satır = yeni paragraf · “- ” ile madde listesi · **kalın** · linkler otomatik tıklanır">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9} />
        </Field>
        <Field label="Kimler görecek?">
          <DepartmentPicker value={departments} onChange={setDepartments} />
        </Field>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex gap-1.5">
            {(Object.keys(PRIORITY) as Priority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${priority === p ? `${PRIORITY[p].cls} ring-current` : 'bg-white text-stone-500 ring-stone-200'}`}
              >
                {PRIORITY[p].label}
              </button>
            ))}
          </div>
          <Checkbox label="Üste sabitle" checked={pinned} onChange={setPinned} />
          <Checkbox label="Okudum onayı iste" checked={requireAck} onChange={setRequireAck} />
        </div>
        <FilePicker files={files} onChange={setFiles} />
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}
