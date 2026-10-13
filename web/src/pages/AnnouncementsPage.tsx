import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { Megaphone, Pin, Plus, Paperclip, Search, CheckCircle2 } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { isManager, rows, searchFilter, subscribe, supabase } from '../lib/db'
import { fromNow } from '../lib/format'
import { PRIORITY } from '../lib/labels'
import { sanitize } from '../lib/richtext'
import type { Announcement, AnnouncementRead } from '../lib/types'
import { AnnouncementEditor } from '../components/AnnouncementEditor'
import { Avatar, Badge, Button, EmptyState, Input, PageHeader, Spinner } from '../components/ui'

const PER_PAGE = 20
type FilterKey = 'all' | 'unread' | 'pinned' | 'mine'

function excerpt(html: string): string {
  const text = new DOMParser().parseFromString(sanitize(html), 'text/html').body.textContent ?? ''
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}

export default function AnnouncementsPage() {
  const me = useMe()
  const { departmentsById, usersById } = useData()
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [filterKey, setFilterKey] = useState<FilterKey>('all')
  const [q, setQ] = useState('')
  const [isEditorOpen, setIsEditorOpen] = useState(false)

  const load = useCallback(
    async (p: number) => {
      let query = supabase.from('announcements').select('*')
      if (filterKey === 'pinned') query = query.eq('pinned', true)
      if (filterKey === 'mine') query = query.eq('author', me.id)
      // "Okunmamış" sunucuda değil, okunma kayıtları geldikten sonra istemcide süzülür.
      if (q.trim()) query = query.or(searchFilter(['title', 'body'], q))
      const found = await rows<Announcement>(
        query
          .order('pinned', { ascending: false })
          .order('created', { ascending: false })
          .range((p - 1) * PER_PAGE, p * PER_PAGE - 1),
      )
      const ids = found.map((a) => a.id)
      const reads = ids.length ? await rows<AnnouncementRead>(supabase.from('announcement_reads').select('*').eq('user', me.id).in('announcement', ids)) : []
      const nextRead = new Set(reads.map((r) => r.announcement))
      setReadIds((prev) => (p === 1 ? nextRead : new Set([...prev, ...nextRead])))
      const visible = filterKey === 'unread' ? found.filter((a) => a.author !== me.id && !nextRead.has(a.id)) : found
      setItems((prev) => (p === 1 || !prev ? visible : [...prev, ...visible]))
      setHasMore(found.length === PER_PAGE)
      setPage(p)
    },
    [filterKey, q, me.id],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(1).catch(() => setItems([])), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  // Yeni duyurular canlı olarak listenin başına eklenir.
  useEffect(() => {
    return subscribe<Announcement>('announcements', (e) => {
      if (e.action === 'create') setItems((prev) => (prev ? [e.record, ...prev.filter((a) => a.id !== e.record.id)] : prev))
      if (e.action === 'update') setItems((prev) => prev?.map((a) => (a.id === e.record.id ? e.record : a)) ?? prev)
      if (e.action === 'delete') setItems((prev) => prev?.filter((a) => a.id !== e.record.id) ?? prev)
    })
  }, [])

  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: 'all', label: 'Tümü' },
    { key: 'unread', label: 'Okunmamış' },
    { key: 'pinned', label: 'Sabitlenen' },
    ...(isManager(me) ? [{ key: 'mine' as const, label: 'Benim yazdıklarım' }] : []),
  ]

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Duyurular"
        subtitle="Şirket ve birim duyuruları"
        actions={
          isManager(me) && (
            <Button onClick={() => setIsEditorOpen(true)}>
              <Plus className="size-4" /> Yeni duyuru
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilterKey(f.key)}
              className={clsx('rounded-md px-3 py-1 text-xs font-medium', filterKey === f.key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Duyurularda ara…" className="pl-9" />
        </div>
      </div>

      {!items && <Spinner />}
      {items?.length === 0 && <EmptyState icon={<Megaphone className="size-10" />} title="Duyuru bulunamadı" />}

      <div className="space-y-3">
        {items?.map((a) => {
          const isUnread = a.author !== me.id && !readIds.has(a.id)
          const audience = a.departments?.length ? a.departments.map((d) => departmentsById.get(d)?.name).filter(Boolean).join(', ') : 'Tüm şirket'
          return (
            <Link
              key={a.id}
              to={`/duyurular/${a.id}`}
              className={clsx(
                'block rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5',
                a.priority === 'urgent' ? 'border-red-200' : 'border-stone-200/70',
                isUnread && 'ring-2 ring-cocoa-300/60',
              )}
            >
              <div className="mb-2 flex items-center gap-2.5">
                <Avatar user={usersById.get(a.author)} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-stone-800">{usersById.get(a.author)?.name}</div>
                  <div className="text-xs text-stone-500">
                    {fromNow(a.created)} · {audience}
                  </div>
                </div>
                {a.pinned && <Pin className="size-4 text-cocoa-500" />}
                {a.priority !== 'normal' && <Badge className={PRIORITY[a.priority].cls}>{PRIORITY[a.priority].label}</Badge>}
                {isUnread && <span className="size-2.5 rounded-full bg-cocoa-500" title="Okunmadı" />}
              </div>
              <h2 className="text-base font-semibold text-stone-900">{a.title}</h2>
              <p className="mt-1 line-clamp-3 text-sm text-stone-600">{excerpt(a.body)}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-stone-400">
                {a.attachments?.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Paperclip className="size-3.5" /> {a.attachments.length} ek
                  </span>
                )}
                {a.requireAck && (
                  <span className={clsx('flex items-center gap-1', readIds.has(a.id) ? 'text-green-600' : 'text-amber-600')}>
                    <CheckCircle2 className="size-3.5" /> {readIds.has(a.id) ? 'Onayladınız' : 'Onay bekliyor'}
                  </span>
                )}
              </div>
            </Link>
          )
        })}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => void load(page + 1)}>
            Daha fazla göster
          </Button>
        </div>
      )}

      {isEditorOpen && (
        <AnnouncementEditor open onClose={() => setIsEditorOpen(false)} onSaved={(a) => setItems((prev) => [a, ...(prev ?? []).filter((x) => x.id !== a.id)])} />
      )}
    </div>
  )
}
