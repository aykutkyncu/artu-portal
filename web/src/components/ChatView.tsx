import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import clsx from 'clsx'
import { Archive, ArchiveRestore, ArrowLeft, Bell, BellOff, EllipsisVertical, EyeOff, Info, Paperclip, Pencil, SendHorizontal, Smile, Trash2, Users as UsersIcon, X, Loader2 } from 'lucide-react'
import { isSameDay } from 'date-fns'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, insert, maybeRow, remove, rows, rpc, run, subscribe, supabase, toRow, update } from '../lib/db'
import { MAX_ATTACHMENTS, removeAttachments, uploadAttachments } from '../lib/files'
import { fmt, fromNow, parseDate } from '../lib/format'
import { conversationPeer, conversationTitle } from '../lib/conversations'
import type { Conversation, ConversationSettings, Message, User } from '../lib/types'
import { UserPicker } from './pickers'
import { Attachments, Avatar, Button, ErrorNote, Field, IconButton, Input, Modal } from './ui'

const PAGE_SIZE = 50
const ONLINE_WINDOW_MS = 5 * 60 * 1000
const PRESENCE_REFRESH_MS = 60 * 1000
/** Başlıktaki sohbet menüsünün `menu` durumundaki kimliği (mesaj id'leriyle çakışmaz). */
const HEADER_MENU = 'header'

/** Mesajları id'ye göre tekilleştirip gönderim zamanına göre sıralar. */
function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  incoming.forEach((m) => byId.set(m.id, m))
  return [...byId.values()].sort((a, b) => Date.parse(a.created) - Date.parse(b.created))
}

// Emoji seçici ağırdır; ilk kez açıldığında yüklenir.
const EmojiPanel = lazy(() => import('./EmojiPanel'))

/** Mesajın üç nokta menüsündeki satır. */
function MenuItem({ danger, onClick, children }: { danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm whitespace-nowrap', danger ? 'text-red-600 hover:bg-red-50' : 'text-stone-700 hover:bg-stone-50')}
    >
      {children}
    </button>
  )
}

export function ChatView({
  conversation,
  settings,
  onSettings,
  onChanged,
  onCleared,
}: {
  conversation: Conversation
  settings: ConversationSettings
  onSettings: (patch: Partial<ConversationSettings>) => void
  /** Mesaj gönderildi, düzenlendi ya da silindi: sohbet listesindeki özet tazelensin. */
  onChanged: () => void
  /** Kişi sohbeti kendi görünümünden sildi. */
  onCleared: () => void
}) {
  const me = useMe()
  const navigate = useNavigate()
  const { usersById, setActiveConversation, markConversationRead } = useData()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  /** Üç nokta menüsü açık olan mesaj. Menü ekrandan taşmasın diye yönü düğmenin yerine göre seçilir. */
  const [menu, setMenu] = useState<{ id: string; up: boolean; alignRight: boolean } | null>(null)
  const [isEmojiOpen, setIsEmojiOpen] = useState(false)
  /** Metni düzenlenmekte olan mesaj */
  const [editing, setEditing] = useState<Message | null>(null)
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
    if (isSending || !canSend) return
    if (files.length > MAX_ATTACHMENTS) return setError(`Bir mesaja en fazla ${MAX_ATTACHMENTS} dosya eklenebilir.`)
    setIsSending(true)
    setError(null)
    try {
      if (editing) {
        const saved = await update<Message>('messages', editing.id, { text: text.trim() })
        setMessages((prev) => prev?.map((m) => (m.id === saved.id ? saved : m)) ?? prev)
        setEditing(null)
        setText('')
        onChanged()
        return
      }
      const attachments = await uploadAttachments('messages', conversation.id, files)
      const created = await insert<Message>('messages', { conversation: conversation.id, sender: me.id, text: text.trim(), attachments })
      stickToBottom.current = true
      setMessages((prev) => (prev && !prev.some((m) => m.id === created.id) ? [...prev, created] : prev))
      setText('')
      setFiles([])
      setIsEmojiOpen(false)
      onChanged()
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

  // Ekli mesajın metni tamamen silinebilir; eksiz mesaj boş bırakılamaz.
  const canSend = editing ? Boolean(text.trim()) || editing.attachments.length > 0 : Boolean(text.trim()) || files.length > 0

  // Menü dışına dokununca ya da Esc ile kapanır.
  useEffect(() => {
    if (!menu) return
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('[data-message-menu]')) setMenu(null)
    }
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const startEdit = (m: Message) => {
    setEditing(m)
    setText(m.text)
    setFiles([])
    setMenu(null)
    textareaRef.current?.focus()
  }

  /** Emojiyi imlecin olduğu yere ekler. */
  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    setText(text.slice(0, start) + emoji + text.slice(end))
    requestAnimationFrame(() => el?.setSelectionRange(start + emoji.length, start + emoji.length))
  }

  const cancelEdit = () => {
    setEditing(null)
    setText('')
  }

  /** Kendi mesajını herkes için siler. */
  const deleteForAll = async (m: Message) => {
    setMenu(null)
    if (!window.confirm('Mesaj herkes için silinsin mi?')) return
    try {
      await remove('messages', m.id)
      setMessages((prev) => prev?.filter((x) => x.id !== m.id) ?? prev)
      void removeAttachments(m.attachments)
      if (editing?.id === m.id) cancelEdit()
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** Mesajı sadece kendi görünümünden kaldırır; karşı taraf görmeye devam eder. */
  const hideForMe = async (m: Message) => {
    setMenu(null)
    if (!window.confirm('Mesaj sadece sizin görünümünüzden kaldırılsın mı? Karşı taraf görmeye devam eder.')) return
    try {
      await run(supabase.from('message_hides').insert(toRow({ user: me.id, message: m.id })))
      setMessages((prev) => prev?.filter((x) => x.id !== m.id) ?? prev)
      if (editing?.id === m.id) cancelEdit()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  /** Sohbetin o ana kadarki bütün mesajlarını sadece kendi görünümünden kaldırır; sohbet listeden düşer. */
  const clearConversation = async () => {
    setMenu(null)
    if (!window.confirm('Bu sohbet ve içindeki tüm mesajlar sizin görünümünüzden silinsin mi? Karşı taraf yazışmayı görmeye devam eder. Bu işlem geri alınamaz.')) return
    try {
      await rpc('clear_conversation', { p_conversation: conversation.id })
      onCleared()
      navigate('/mesajlar')
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
        {settings.muted && <BellOff className="size-4 shrink-0 text-amber-600" aria-label="Sessizde" />}
        {/* Üç nokta: sohbet seçenekleri */}
        <div data-message-menu className="relative">
          <IconButton label="Sohbet seçenekleri" onClick={() => setMenu(menu?.id === HEADER_MENU ? null : { id: HEADER_MENU, up: false, alignRight: true })}>
            <EllipsisVertical className="size-5" />
          </IconButton>
          {menu?.id === HEADER_MENU && (
            <div role="menu" className="absolute top-full right-0 z-20 mt-1 min-w-48 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg">
              {isGroup && (
                <MenuItem
                  onClick={() => {
                    setMenu(null)
                    setIsInfoOpen(true)
                  }}
                >
                  <Info className="size-4" /> Grup bilgisi
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  setMenu(null)
                  onSettings({ muted: !settings.muted })
                }}
              >
                {settings.muted ? <Bell className="size-4" /> : <BellOff className="size-4" />} {settings.muted ? 'Bildirimleri aç' : 'Sessize al'}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenu(null)
                  onSettings({ archived: !settings.archived })
                }}
              >
                {settings.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} {settings.archived ? 'Arşivden çıkar' : 'Arşivle'}
              </MenuItem>
              <MenuItem danger onClick={() => void clearConversation()}>
                <Trash2 className="size-4" /> Sohbeti sil
              </MenuItem>
            </div>
          )}
        </div>
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
                  <div
                    className={clsx(
                      'relative max-w-[80%] rounded-2xl py-2 pr-8 pl-3 shadow-sm sm:max-w-[65%]',
                      mine ? 'rounded-br-md bg-cocoa-700 text-white' : 'rounded-bl-md bg-white text-stone-800',
                      (menu?.id === m.id || editing?.id === m.id) && 'ring-2 ring-amber-400',
                    )}
                  >
                    {/* Üç nokta: mesaj seçenekleri */}
                    <div data-message-menu className="absolute top-1 right-1">
                      <button
                        type="button"
                        aria-label="Mesaj seçenekleri"
                        aria-haspopup="menu"
                        aria-expanded={menu?.id === m.id}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          setMenu(menu?.id === m.id ? null : { id: m.id, up: rect.bottom > window.innerHeight - 220, alignRight: rect.left > window.innerWidth / 2 })
                        }}
                        className={clsx('flex size-6 items-center justify-center rounded-full', mine ? 'text-cocoa-200 hover:bg-white/15' : 'text-stone-400 hover:bg-stone-100')}
                      >
                        <EllipsisVertical className="size-4" />
                      </button>
                      {menu?.id === m.id && (
                        <div
                          role="menu"
                          className={clsx(
                            'absolute z-20 min-w-40 overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg',
                            menu.alignRight ? 'right-0' : 'left-0',
                            menu.up ? 'bottom-full mb-1' : 'top-full mt-1',
                          )}
                        >
                          {mine && (
                            <MenuItem onClick={() => startEdit(m)}>
                              <Pencil className="size-4" /> Düzenle
                            </MenuItem>
                          )}
                          <MenuItem onClick={() => void hideForMe(m)}>
                            <EyeOff className="size-4" /> Benden sil
                          </MenuItem>
                          {mine && (
                            <MenuItem danger onClick={() => void deleteForAll(m)}>
                              <Trash2 className="size-4" /> Herkesten sil
                            </MenuItem>
                          )}
                        </div>
                      )}
                    </div>
                    {!mine && isGroup && !grouped && <div className="mb-0.5 text-xs font-semibold text-cocoa-600">{sender?.name ?? 'Eski kullanıcı'}</div>}
                    {m.text && <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>}
                    <Attachments files={m.attachments} compact />
                    <div className={clsx('mt-0.5 text-right text-[10px]', mine ? 'text-cocoa-200' : 'text-stone-400')}>
                      {m.editedAt && 'düzenlendi · '}
                      {fmt(m.created, 'HH:mm')}
                    </div>
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
        {isEmojiOpen && (
          <div className="mx-auto mb-2 max-w-3xl">
            <Suspense fallback={<div className="flex h-[340px] items-center justify-center text-sm text-stone-400">Emojiler yükleniyor…</div>}>
              <EmojiPanel onPick={insertEmoji} />
            </Suspense>
          </div>
        )}
        {editing && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            <span className="flex items-center gap-1.5">
              <Pencil className="size-3.5" /> Mesaj düzenleniyor
            </span>
            <button type="button" onClick={cancelEdit} className="font-medium hover:underline">
              Vazgeç
            </button>
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
          <label
            className={clsx('flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-stone-500 hover:bg-stone-100', editing && 'invisible')}
            aria-label="Dosya ekle"
          >
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
          <button
            type="button"
            onClick={() => setIsEmojiOpen(!isEmojiOpen)}
            aria-label="Emoji"
            aria-pressed={isEmojiOpen}
            className={clsx('flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-stone-100', isEmojiOpen ? 'text-cocoa-700' : 'text-stone-500')}
          >
            <Smile className="size-5" />
          </button>
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
            disabled={isSending || !canSend}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cocoa-700 text-white disabled:opacity-40"
            aria-label={editing ? 'Kaydet' : 'Gönder'}
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
