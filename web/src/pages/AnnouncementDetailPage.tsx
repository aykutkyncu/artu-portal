import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, CheckCircle2, Pencil, Pin, Trash2, Eye } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, isAdmin, maybeRow, remove as removeRecord, row, rows, supabase } from '../lib/db'
import { removeAttachments } from '../lib/files'
import { fmtDateTime } from '../lib/format'
import { PRIORITY } from '../lib/labels'
import { sanitize } from '../lib/richtext'
import type { Announcement, AnnouncementRead } from '../lib/types'
import { AnnouncementEditor } from '../components/AnnouncementEditor'
import { Attachments, Avatar, Badge, Button, ErrorNote, IconButton, Spinner } from '../components/ui'

export default function AnnouncementDetailPage() {
  const { id = '' } = useParams()
  const me = useMe()
  const navigate = useNavigate()
  const { users, usersById, departmentsById, reloadUnread } = useData()
  const [item, setItem] = useState<Announcement | null>(null)
  const [reads, setReads] = useState<AnnouncementRead[]>([])
  const [isRead, setIsRead] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  const canManage = item && (item.author === me.id || isAdmin(me))

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const a = await row<Announcement>(supabase.from('announcements').select('*').eq('id', id).single())
        if (cancelled) return
        setItem(a)

        const mine = await maybeRow<AnnouncementRead>(
          supabase.from('announcement_reads').select('*').eq('announcement', id).eq('user', me.id).maybeSingle(),
        ).catch(() => null)
        const alreadyRead = Boolean(mine) || a.author === me.id
        setIsRead(alreadyRead)

        // Onay istenmeyen duyurular açıldığında otomatik okundu sayılır.
        if (!alreadyRead && !a.requireAck) await markRead()

        if (a.author === me.id || isAdmin(me)) {
          const all = await rows<AnnouncementRead>(supabase.from('announcement_reads').select('*').eq('announcement', id).order('created'))
          if (!cancelled) setReads(all)
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, me.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function markRead() {
    await insert('announcement_reads', { announcement: id, user: me.id }).catch(() => undefined)
    setIsRead(true)
    void reloadUnread()
  }

  // Duyurunun hedef kitlesi; kimlerin okumadığını göstermek için.
  const audience = useMemo(() => {
    if (!item) return []
    return users.filter((u) => u.id !== item.author && (!item.departments?.length || item.departments.includes(u.department) || u.role === 'admin'))
  }, [item, users])
  const readSet = new Set(reads.map((r) => r.user))
  const notRead = audience.filter((u) => !readSet.has(u.id))

  const remove = async () => {
    if (!item || !window.confirm('Bu duyuru silinsin mi?')) return
    try {
      await removeRecord('announcements', item.id)
      void removeAttachments(item.attachments)
      navigate('/duyurular')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (error && !item) return <ErrorNote message={error} />
  if (!item) return <Spinner />

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <Link to="/duyurular" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
          <ArrowLeft className="size-4" /> Duyurular
        </Link>
        {canManage && (
          <div className="flex gap-1">
            <IconButton label="Düzenle" onClick={() => setIsEditing(true)}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Sil" onClick={remove} className="hover:text-red-600">
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        )}
      </div>

      <article className="rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {item.pinned && (
            <Badge className="bg-cocoa-100 text-cocoa-700">
              <Pin className="mr-1 size-3" /> Sabit
            </Badge>
          )}
          {item.priority !== 'normal' && <Badge className={PRIORITY[item.priority].cls}>{PRIORITY[item.priority].label}</Badge>}
          <Badge className="bg-stone-100 text-stone-600">
            {item.departments?.length ? item.departments.map((d) => departmentsById.get(d)?.name).join(', ') : 'Tüm şirket'}
          </Badge>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">{item.title}</h1>
        <div className="mt-3 flex items-center gap-2.5 border-b border-stone-100 pb-4">
          <Avatar user={usersById.get(item.author)} size={34} />
          <div className="text-sm">
            <div className="font-medium text-stone-800">{usersById.get(item.author)?.name}</div>
            <div className="text-xs text-stone-500">{fmtDateTime(item.created)}</div>
          </div>
        </div>
        <div className="prose-artu mt-4 text-[15px] leading-relaxed text-stone-700" dangerouslySetInnerHTML={{ __html: sanitize(item.body) }} />
        <Attachments files={item.attachments} />

        {item.requireAck && item.author !== me.id && (
          <div className="mt-6 rounded-xl bg-cocoa-50 p-4">
            {isRead ? (
              <p className="flex items-center gap-2 text-sm font-medium text-green-700">
                <CheckCircle2 className="size-5" /> Okuduğunuzu onayladınız.
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-stone-700">Bu duyuru için okuma onayı isteniyor.</p>
                <Button onClick={() => void markRead()}>
                  <CheckCircle2 className="size-4" /> Okudum, anladım
                </Button>
              </div>
            )}
          </div>
        )}
      </article>

      {canManage && (
        <section className="mt-4 rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-800">
            <Eye className="size-4 text-cocoa-600" /> Okunma durumu
            <span className="font-normal text-stone-500">
              {reads.length} / {audience.length} kişi
            </span>
          </h2>
          <div className="mb-3 h-2 rounded-full bg-stone-100">
            <div className="h-2 rounded-full bg-green-500" style={{ width: `${audience.length ? (reads.length / audience.length) * 100 : 0}%` }} />
          </div>
          {notRead.length > 0 && (
            <>
              <p className="mb-2 text-xs font-medium text-stone-500">Henüz okumayanlar</p>
              <div className="flex flex-wrap gap-1.5">
                {notRead.map((u) => (
                  <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 py-0.5 pr-2.5 pl-0.5 text-xs text-stone-700">
                    <Avatar user={u} size={20} /> {u.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {isEditing && <AnnouncementEditor open existing={item} onClose={() => setIsEditing(false)} onSaved={setItem} />}
    </div>
  )
}
