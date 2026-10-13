import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import clsx from 'clsx'
import { MessageCirclePlus, Search, Users as UsersIcon, MessageCircle } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, fromRow, insert, rows, rpc, subscribe, supabase } from '../lib/db'
import { fmtShort } from '../lib/format'
import type { Conversation } from '../lib/types'
import { conversationPeer, conversationTitle } from '../lib/conversations'
import { ChatView } from '../components/ChatView'
import { UserPicker } from '../components/pickers'
import { Avatar, Button, CountBadge, EmptyState, ErrorNote, Field, Input, Modal, Spinner } from '../components/ui'

export default function MessagesPage() {
  const { id } = useParams()
  const me = useMe()
  const { usersById, unread } = useData()
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [q, setQ] = useState('')
  const [isNewOpen, setIsNewOpen] = useState(false)

  const load = useCallback(async () => {
    setConversations(await rows<Conversation>(supabase.from('conversations').select('*').order('last_message_at', { ascending: false })))
  }, [])

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
    if (!conversations || !needle) return conversations
    return conversations.filter((c) => conversationTitle(c, me.id, usersById).toLocaleLowerCase('tr').includes(needle))
  }, [conversations, q, me.id, usersById])

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
          {filtered?.length === 0 && (
            <EmptyState icon={<MessageCircle className="size-10" />} title="Henüz sohbet yok">
              “Yeni” ile bir çalışma arkadaşınıza yazın.
            </EmptyState>
          )}
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
                    <span className={clsx('shrink-0 text-[11px]', count ? 'font-semibold text-cocoa-600' : 'text-stone-400')}>{fmtShort(c.lastMessageAt)}</span>
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
        {id && active && <ChatView key={active.id} conversation={active} />}
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
