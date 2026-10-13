import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'
import { ArrowLeft, Info, Paperclip, SendHorizontal, Trash2, Users as UsersIcon, X, Loader2 } from 'lucide-react'
import { isSameDay } from 'date-fns'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, maybeRow, remove, rows, rpc, subscribe, supabase, update } from '../lib/db'
import { MAX_ATTACHMENTS, removeAttachments, uploadAttachments } from '../lib/files'
import { fmt, fromNow, parseDate } from '../lib/format'
import { conversationPeer, conversationTitle } from '../lib/conversations'
import type { Conversation, Message, User } from '../lib/types'
import { UserPicker } from './pickers'
import { Attachments, Avatar, Button, ErrorNote, Field, IconButton, Input, Modal } from './ui'

const PAGE_SIZE = 50
const ONLINE_WINDOW_MS = 5 * 60 * 1000
const PRESENCE_REFRESH_MS = 60 * 1000

/** Mesajları id'ye göre tekilleştirip gönderim zamanına göre sıralar. */
function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  incoming.forEach((m) => byId.set(m.id, m))
  return [...byId.values()].sort((a, b) => Date.parse(a.created) - Date.parse(b.created))
}

export function ChatView({ conversation }: { conversation: Conversation }) {
  const me = useMe()
  const { usersById, setActiveConversation, markConversationRead } = useData()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isLoadingOlder = useRef(false)

  const isGroup = conversation.type === 'group'
  const peer = conversationPeer(conversation, me.id, usersById)
  const title = conversationTitle(conversation, me.id, usersById)

  // Masaüstünde sohbet açılınca doğrudan yazmaya başlanabilsin (mobilde klavye açılmasın).
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) textareaRef.current?.focus()
  }, [conversation.id])

  const markRead = useCallback(() => {
    if (document.visibilityState === 'visible') void markConversationRead(conversation.id)
  }, [conversation.id, markConversationRead])

  // Karşı tarafın "son görülme" bilgisini taze tut.
  const [freshPeer, setFreshPeer] = useState(peer)
  const peerId = peer?.id
  useEffect(() => {
    if (!peerId) return
    const refresh = () =>
      void maybeRow<User>(supabase.from('profiles').select('*').eq('id', peerId).maybeSingle())
        .then((u) => u && setFreshPeer(u))
        .catch(() => undefined)
    refresh()
    const t = setInterval(refresh, PRESENCE_REFRESH_MS)
    return () => clearInterval(t)
  }, [peerId])
  const lastSeen = freshPeer?.lastSeen ?? peer?.lastSeen
  const peerOnline = lastSeen && Date.now() - (parseDate(lastSeen)?.getTime() ?? 0) < ONLINE_WINDOW_MS

  // İlk yükleme + canlı abonelik. Uygulama arka plandan dönünce (bağlantı kopmuş olabilir)
  // son mesajlar yeniden çekilip mevcut listeyle birleştirilir.
  useEffect(() => {
    let cancelled = false
    setActiveConversation(conversation.id)
    markRead()

    const fetchLatest = async () => {
      try {
        const latest = await rows<Message>(
          supabase.from('messages').select('*').eq('conversation', conversation.id).order('created', { ascending: false }).limit(PAGE_SIZE),
        )
        if (cancelled) return
        setMessages((prev) => mergeMessages(prev ?? [], latest))
        setHasOlder((h) => h || latest.length === PAGE_SIZE)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      }
    }
    void fetchLatest()

    // Silme bildiriminde sadece mesajın id'si gelir; bu yüzden sohbete göre süzme burada yapılır.
    const unsub = subscribe<Message>('messages', (e) => {
      if (e.action === 'delete') return setMessages((prev) => prev?.filter((m) => m.id !== e.record.id) ?? prev)
      if (e.record.conversation !== conversation.id) return
      if (e.action === 'create') {
        // İlk sorgu dönmeden gelen mesaj kaybolmasın: boş listeye de eklenir, sonra birleştirilir.
        setMessages((prev) => mergeMessages(prev ?? [], [e.record]))
        if (e.record.sender !== me.id) markRead()
      }
      if (e.action === 'update') setMessages((prev) => prev?.map((m) => (m.id === e.record.id ? e.record : m)) ?? prev)
    })

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void fetchLatest()
      markRead()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      setActiveConversation(null)
      document.removeEventListener('visibilitychange', onVisible)
      unsub()
    }
  }, [conversation.id, me.id, markRead, setActiveConversation])

  // Yeni mesajda en alta kaydır (kullanıcı yukarıda eski mesajları okumuyorsa).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const loadOlder = async () => {
    if (!messages?.length || isLoadingOlder.current) return
    isLoadingOlder.current = true
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    try {
      const older = await rows<Message>(
        supabase
          .from('messages')
          .select('*')
          .eq('conversation', conversation.id)
          .lt('created', messages[0]!.created)
          .order('created', { ascending: false })
          .limit(PAGE_SIZE),
      )
      stickToBottom.current = false
      setMessages((prev) => mergeMessages(prev ?? [], older))
      setHasOlder(older.length === PAGE_SIZE)
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      isLoadingOlder.current = false
    }
  }

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    if (isSending || (!text.trim() && files.length === 0)) return
    if (files.length > MAX_ATTACHMENTS) return setError(`Bir mesaja en fazla ${MAX_ATTACHMENTS} dosya eklenebilir.`)
    setIsSending(true)
    setError(null)
    try {
      const attachments = await uploadAttachments('messages', conversation.id, files)
      const created = await insert<Message>('messages', { conversation: conversation.id, sender: me.id, text: text.trim(), attachments })
      stickToBottom.current = true
      setMessages((prev) => (prev && !prev.some((m) => m.id === created.id) ? [...prev, created] : prev))
      setText('')
      setFiles([])
      textareaRef.current?.focus()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Masaüstünde Enter gönderir, Shift+Enter yeni satır. Mobilde Enter yeni satırdır.
    const isTouch = window.matchMedia('(pointer: coarse)').matches
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault()
      void send()
    }
  }

  const removeMessage = async (m: Message) => {
    if (!window.confirm('Mesaj silinsin mi?')) return
    try {
      await remove('messages', m.id)
      setMessages((prev) => prev?.filter((x) => x.id !== m.id) ?? prev)
      void removeAttachments(m.attachments)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Başlık */}
      <header className="safe-top flex items-center gap-3 border-b border-stone-200 bg-white px-3 py-2.5">
        <Link to="/mesajlar" className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 md:hidden" aria-label="Geri">
          <ArrowLeft className="size-5" />
        </Link>
        {isGroup ? (
          <span className="flex size-10 items-center justify-center rounded-full bg-cocoa-700 text-cream">
            <UsersIcon className="size-5" />
          </span>
        ) : (
          <Avatar user={peer} size={40} />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-stone-900">{title}</div>
          <div className="truncate text-xs text-stone-500">
            {isGroup
              ? `${conversation.members.length} üye`
              : peerOnline
                ? 'çevrimiçi'
                : lastSeen
                  ? `son görülme ${fromNow(lastSeen)}`
                  : peer?.title || ''}
          </div>
        </div>
        {isGroup && (
          <IconButton label="Grup bilgisi" onClick={() => setIsInfoOpen(true)}>
            <Info className="size-5" />
          </IconButton>
        )}
      </header>

      {/* Mesajlar */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex-1 overflow-y-auto px-3 py-4 sm:px-6"
      >
        {hasOlder && (
          <div className="mb-3 flex justify-center">
            <Button size="sm" variant="secondary" onClick={() => void loadOlder()}>
              Önceki mesajlar
            </Button>
          </div>
        )}
        {!messages && <Loader2 className="mx-auto mt-10 size-6 animate-spin text-cocoa-400" />}
        {messages?.length === 0 && <p className="mt-10 text-center text-sm text-stone-400">İlk mesajı siz yazın 👋</p>}
        <div className="mx-auto max-w-3xl space-y-1">
          {messages?.map((m, i) => {
            const prev = messages[i - 1]
            const mine = m.sender === me.id
            const newDay = !prev || !isSameDay(parseDate(prev.created)!, parseDate(m.created)!)
            const grouped = prev && !newDay && prev.sender === m.sender
            const sender = usersById.get(m.sender)
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-white/80 px-3 py-0.5 text-[11px] text-stone-500 shadow-sm">{fmt(m.created, 'd MMMM EEEE')}</span>
                  </div>
                )}
                <div className={clsx('group flex items-end gap-2', mine ? 'justify-end' : 'justify-start', !grouped && 'mt-2')}>
                  {!mine && isGroup && (grouped ? <span className="w-7" /> : <Avatar user={sender} size={28} />)}
                  {mine && (
                    <button
                      type="button"
                      onClick={() => void removeMessage(m)}
                      className="mb-1 hidden text-stone-300 group-hover:block hover:text-red-500"
                      aria-label="Mesajı sil"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                  <div
                    className={clsx(
                      'max-w-[80%] rounded-2xl px-3 py-2 shadow-sm sm:max-w-[65%]',
                      mine ? 'rounded-br-md bg-cocoa-700 text-white' : 'rounded-bl-md bg-white text-stone-800',
                    )}
                  >
                    {!mine && isGroup && !grouped && <div className="mb-0.5 text-xs font-semibold text-cocoa-600">{sender?.name ?? 'Eski kullanıcı'}</div>}
                    {m.text && <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>}
                    <Attachments files={m.attachments} compact />
                    <div className={clsx('mt-0.5 text-right text-[10px]', mine ? 'text-cocoa-200' : 'text-stone-400')}>{fmt(m.created, 'HH:mm')}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Yazma alanı */}
      <form onSubmit={send} className="safe-bottom border-t border-stone-200 bg-white px-3 py-2">
        {error && (
          <div className="mx-auto mb-2 max-w-3xl">
            <ErrorNote message={error} />
          </div>
        )}
        {files.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-cocoa-50 px-2 py-1 text-xs text-stone-700">
                <span className="max-w-40 truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Kaldır">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <label className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-stone-500 hover:bg-stone-100" aria-label="Dosya ekle">
            <Paperclip className="size-5" />
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                setFiles([...files, ...Array.from(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </label>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Mesaj yazın…"
            className="max-h-36 min-h-10 flex-1 resize-none rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2 text-base sm:text-sm focus:border-cocoa-400 focus:bg-white focus:outline-none [field-sizing:content]"
          />
          <button
            type="submit"
            disabled={isSending || (!text.trim() && files.length === 0)}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cocoa-700 text-white disabled:opacity-40"
            aria-label="Gönder"
          >
            {isSending ? <Loader2 className="size-5 animate-spin" /> : <SendHorizontal className="size-5" />}
          </button>
        </div>
      </form>

      {isInfoOpen && <GroupInfoModal conversation={conversation} onClose={() => setIsInfoOpen(false)} />}
    </div>
  )
}

function GroupInfoModal({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  const me = useMe()
  const navigate = useNavigate()
  const { usersById } = useData()
  const canEdit = conversation.createdBy === me.id || me.role === 'admin'
  const [name, setName] = useState(conversation.name)
  const [members, setMembers] = useState<string[]>(conversation.members)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    setIsSaving(true)
    setError(null)
    try {
      await update('conversations', conversation.id, { name: name.trim(), members: Array.from(new Set([me.id, ...members])) })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  const leave = async () => {
    if (!window.confirm('Gruptan ayrılmak istiyor musunuz?')) return
    try {
      await rpc('leave_conversation', { p_conversation: conversation.id })
      navigate('/mesajlar')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Grup bilgisi"
      footer={
        <>
          <Button variant="danger" onClick={leave} className="mr-auto">
            Gruptan ayrıl
          </Button>
          {canEdit && (
            <Button onClick={save} isLoading={isSaving}>
              Kaydet
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {canEdit ? (
          <>
            <Field label="Grup adı">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <Field label="Üyeler">
              <UserPicker value={members.filter((m) => m !== me.id)} onChange={(ids) => setMembers([me.id, ...ids])} exclude={[me.id]} />
            </Field>
          </>
        ) : (
          <ul className="space-y-2">
            {conversation.members.map((id) => {
              const u = usersById.get(id)
              return (
                <li key={id} className="flex items-center gap-2 text-sm">
                  <Avatar user={u} size={28} /> {u?.name ?? 'Eski kullanıcı'}
                  {id === conversation.createdBy && <span className="text-xs text-stone-400">(yönetici)</span>}
                </li>
              )
            })}
          </ul>
        )}
        <ErrorNote message={error} />
      </div>
    </Modal>
  )
}
