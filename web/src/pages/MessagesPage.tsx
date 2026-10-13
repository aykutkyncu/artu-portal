import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import clsx from 'clsx'
import { Archive, ArrowLeft, BellOff, MessageCirclePlus, Search, Users as UsersIcon, MessageCircle } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, fromRow, insert, rows, rpc, run, subscribe, supabase, toRow } from '../lib/db'
import { fmtShort } from '../lib/format'
import type { Conversation, ConversationSettings } from '../lib/types'
import { conversationPeer, conversationTitle } from '../lib/conversations'
import { ChatView } from '../components/ChatView'
import { UserPicker } from '../components/pickers'
import { Avatar, Button, CountBadge, EmptyState, ErrorNote, Field, Input, Modal, Spinner } from '../components/ui'

const DEFAULT_SETTINGS: ConversationSettings = { muted: false, archived: false }

export default function MessagesPage() {
  const { id } = useParams()
  const me = useMe()
  const { usersById, unread } = useData()
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [q, setQ] = useState('')
  const [isNewOpen, setIsNewOpen] = useState(false)
  /** Kişinin sohbet ayarları (sessize alma, arşiv); kaydı olmayan sohbet varsayılandadır. */
  const [settings, setSettings] = useState<Record<string, ConversationSettings>>({})
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    const [list, own] = await Promise.all([
      rows<Conversation>(supabase.from('conversations').select('*').order('last_message_at', { ascending: false })),
      // Ayarlar okunamazsa sohbet listesi yine de açılsın
      rows<ConversationSettings & { conversation: string }>(supabase.from('conversation_settings').select('*').eq('user', me.id)).catch(() => []),
    ])
    setConversations(list)
    setSettings(Object.fromEntries(own.map((s) => [s.conversation, { muted: s.muted, archived: s.archived }])))
  }, [me.id])

  const changeSettings = async (conversationId: string, patch: Partial<ConversationSettings>) => {
    const next = { ...(settings[conversationId] ?? DEFAULT_SETTINGS), ...patch }
    setSettings((prev) => ({ ...prev, [conversationId]: next }))
    await run(
      supabase.from('conversation_settings').upsert(toRow({ user: me.id, conversation: conversationId, ...next }), { onConflict: 'user,conversation' }),
    ).catch(() => void load())
  }

  useEffect(() => {
    return subscribe<Conversation>('conversations', (e) => {
      setConversations((prev) => {
        if (!prev) return prev
        const rest = prev.filter((c) => c.id !== e.record.id)
        if (e.action === 'delete' || !e.record.members.includes(me.id)) return rest
        return [e.record, ...rest].sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
      })
    })
  }, [me.id])

  // Sohbet değişince (yeni sohbet, gruptan ayrılma) ve uygulama öne gelince listeyi tazele;
  // gerçek zamanlı bağlantı kopmuş olsa bile liste güncel kalır.
  useEffect(() => {
    void load().catch(() => undefined)
  }, [id, load])
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void load().catch(() => undefined)
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const filtered = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr')
    return conversations?.filter(
      (c) =>
        Boolean(settings[c.id]?.archived) === showArchived &&
        (!needle || conversationTitle(c, me.id, usersById).toLocaleLowerCase('tr').includes(needle)),
    )
  }, [conversations, settings, showArchived, q, me.id, usersById])

  const archived = conversations?.filter((c) => settings[c.id]?.archived) ?? []
  const archivedUnread = archived.reduce((sum, c) => sum + (unread.conversations[c.id] ?? 0), 0)

  const active = conversations?.find((c) => c.id === id) ?? null

  return (
    <div className="flex h-full">
      {/* Sohbet listesi: mobilde sohbet açıkken gizlenir */}
      <aside className={clsx('flex w-full flex-col border-r border-stone-200 bg-white md:w-80 lg:w-96', id && 'hidden md:flex')}>
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <h1 className="text-xl font-semibold text-stone-900">Mesajlar</h1>
          <Button size="sm" onClick={() => setIsNewOpen(true)}>
            <MessageCirclePlus className="size-4" /> Yeni
          </Button>
        </div>
        <div className="relative px-4 pb-3">
          <Search className="pointer-events-none absolute top-1/2 left-7 size-4 -translate-y-[calc(50%+6px)] text-stone-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sohbet ara…" className="pl-9" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {!filtered && <Spinner />}
          {(showArchived || archived.length > 0) && (
            <button
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className="flex w-full items-center gap-3 border-b border-stone-100 px-4 py-2.5 text-sm text-stone-600 hover:bg-stone-50"
            >
              {showArchived ? <ArrowLeft className="size-4" /> : <Archive className="size-4" />}
              <span className="flex-1 text-left">{showArchived ? 'Sohbetlere dön' : `Arşiv (${archived.length})`}</span>
              {!showArchived && <CountBadge count={archivedUnread} className="bg-stone-400!" />}
            </button>
          )}
          {filtered?.length === 0 &&
            (showArchived ? (
              <EmptyState icon={<Archive className="size-10" />} title="Arşivde sohbet yok" />
            ) : (
              <EmptyState icon={<MessageCircle className="size-10" />} title="Henüz sohbet yok">
                “Yeni” ile bir çalışma arkadaşınıza yazın.
              </EmptyState>
            ))}
          {filtered?.map((c) => {
            const peer = conversationPeer(c, me.id, usersById)
            const count = unread.conversations[c.id] ?? 0
            return (
              <Link
                key={c.id}
                to={`/mesajlar/${c.id}`}
                className={clsx('flex items-center gap-3 px-4 py-3 transition-colors', c.id === id ? 'bg-cocoa-50' : 'hover:bg-stone-50')}
              >
                {c.type === 'group' ? (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cocoa-700 text-cream">
                    <UsersIcon className="size-5" />
                  </span>
                ) : (
                  <Avatar user={peer} size={44} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={clsx('truncate text-sm', count ? 'font-semibold text-stone-900' : 'font-medium text-stone-800')}>
                      {conversationTitle(c, me.id, usersById)}
                    </span>
                    <span className={clsx('flex shrink-0 items-center gap-1 text-[11px]', count ? 'font-semibold text-cocoa-600' : 'text-stone-400')}>
                      {settings[c.id]?.muted && <BellOff className="size-3 text-stone-400" aria-label="Sessizde" />}
                      {fmtShort(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={clsx('truncate text-xs', count ? 'text-stone-700' : 'text-stone-500')}>{c.lastMessageText || 'Sohbet başladı'}</span>
                    <CountBadge count={count} className="shrink-0 bg-cocoa-600!" />
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </aside>

      <section className={clsx('min-w-0 flex-1 bg-cocoa-50', !id && 'hidden md:block')}>
        {id && active && (
          <ChatView
            key={active.id}
            conversation={active}
            settings={settings[active.id] ?? DEFAULT_SETTINGS}
            onSettings={(patch) => void changeSettings(active.id, patch)}
            onChanged={() => void load().catch(() => undefined)}
          />
        )}
        {id && conversations && !active && <EmptyState icon={<MessageCircle className="size-10" />} title="Sohbet bulunamadı" />}
        {!id && (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<MessageCircle className="size-12" />} title="Bir sohbet seçin">
              Soldaki listeden bir sohbet seçin veya yeni bir sohbet başlatın.
            </EmptyState>
          </div>
        )}
      </section>

      {isNewOpen && <NewConversationModal onClose={() => setIsNewOpen(false)} />}
    </div>
  )
}

function NewConversationModal({ onClose }: { onClose: () => void }) {
  const me = useMe()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'direct' | 'group'>('direct')
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const start = async () => {
    setError(null)
    setIsSaving(true)
    try {
      if (mode === 'direct') {
        if (!selected[0]) throw new Error('Bir kişi seçin.')
        const c = fromRow<Conversation>(await rpc('direct_conversation', { p_user: selected[0] }))
        navigate(`/mesajlar/${c.id}`)
      } else {
        if (!name.trim()) throw new Error('Grup adı yazın.')
        if (selected.length < 1) throw new Error('En az bir kişi seçin.')
        const c = await insert<Conversation>('conversations', { type: 'group', name: name.trim(), members: [me.id, ...selected], createdBy: me.id })
        navigate(`/mesajlar/${c.id}`)
      }
      onClose()
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
      title="Yeni sohbet"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={start} isLoading={isSaving}>
            {mode === 'direct' ? 'Sohbet başlat' : 'Grubu oluştur'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-1">
          {(['direct', 'group'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setSelected([])
              }}
              className={clsx('rounded-md py-1.5 text-sm font-medium', mode === m ? 'bg-white shadow-sm' : 'text-stone-500')}
            >
              {m === 'direct' ? 'Birebir' : 'Grup'}
            </button>
          ))}
        </div>
        {mode === 'group' && (
          <Field label="Grup adı">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: Sevkiyat Ekibi" maxLength={100} />
          </Field>
        )}
        <UserPicker value={selected} onChange={setSelected} exclude={[me.id]} single={mode === 'direct'} />
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}
