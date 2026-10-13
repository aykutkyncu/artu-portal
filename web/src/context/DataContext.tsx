import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { rows, rpc, subscribe, supabase } from '../lib/db'
import type { Announcement, Department, Message, User } from '../lib/types'
import { useAuth } from './AuthContext'

interface Unread {
  conversations: Record<string, number>
  announcements: number
  /** Sonuçlandırmamı bekleyen izin talepleri (birim sorumlusu / admin) */
  leaves?: number
}

interface DataValue {
  /** Aktif kullanıcılar (rehber, kişi seçiciler) */
  users: User[]
  /** Pasifleştirilenler dahil herkes: eski kayıtların yazarı / göndereni de bulunur. */
  usersById: Map<string, User>
  departments: Department[]
  departmentsById: Map<string, Department>
  unread: Unread
  totalUnreadMessages: number
  reloadDirectory: () => Promise<void>
  reloadUnread: () => Promise<void>
  /** Açık olan sohbet; bu sohbete gelen mesajlar okunmamış sayılmaz. */
  setActiveConversation: (id: string | null) => void
  markConversationRead: (id: string) => Promise<void>
}

const DataContext = createContext<DataValue | null>(null)
const EMPTY_UNREAD: Unread = { conversations: {}, announcements: 0 }
const HEARTBEAT_MS = 2 * 60 * 1000

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [unread, setUnread] = useState<Unread>(EMPTY_UNREAD)
  const activeConversation = useRef<string | null>(null)

  const reloadDirectory = useCallback(async () => {
    const [u, d] = await Promise.all([
      rows<User>(supabase.from('profiles').select('*').order('name')),
      rows<Department>(supabase.from('departments').select('*').order('name')),
    ])
    setAllUsers(u)
    setDepartments(d)
  }, [])

  const unreadSeq = useRef(0)
  const reloadUnread = useCallback(async () => {
    // Geç dönen eski bir yanıt, daha yeni sayaçların üzerine yazmasın.
    const seq = ++unreadSeq.current
    const data = await rpc<Unread>('unread_counts').catch((err: { code?: string }) => {
      // Hesap pasifleştirilmişse veritabanı oturumu reddeder: giriş ekranına dön.
      if (err?.code === '42501') void logout()
      throw err
    })
    if (seq !== unreadSeq.current) return
    if (activeConversation.current) delete data.conversations[activeConversation.current]
    setUnread(data)
  }, [logout])

  const markConversationRead = useCallback(async (id: string) => {
    unreadSeq.current++ // devam eden eski sayaç isteğini geçersiz kıl
    setUnread((u) => {
      if (!u.conversations[id]) return u
      const conversations = { ...u.conversations }
      delete conversations[id]
      return { ...u, conversations }
    })
    await rpc('mark_conversation_read', { p_conversation: id }).catch(() => undefined)
  }, [])

  const setActiveConversation = useCallback((id: string | null) => {
    activeConversation.current = id
  }, [])

  useEffect(() => {
    if (!user) {
      setAllUsers([])
      setDepartments([])
      setUnread(EMPTY_UNREAD)
      return
    }
    void reloadDirectory().catch(() => undefined)
    void reloadUnread().catch(() => undefined)

    // Yeni mesaj / duyuru geldiğinde sayaçları canlı güncelle.
    const unsubs = [
      subscribe<Message>('messages', (e) => {
        if (e.action !== 'create' || e.record.sender === user.id) return
        if (e.record.conversation === activeConversation.current) return
        setUnread((u) => ({
          ...u,
          conversations: { ...u.conversations, [e.record.conversation]: (u.conversations[e.record.conversation] ?? 0) + 1 },
        }))
      }),
      subscribe<Announcement>('announcements', (e) => {
        if (e.action === 'create' && e.record.author !== user.id) setUnread((u) => ({ ...u, announcements: u.announcements + 1 }))
      }),
    ]

    // Uygulama arka plandan döndüğünde gerçek sayılarla eşitle.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reloadUnread().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onVisible)
    // Açık kalan uygulamada sayaçlar ve "çevrimiçi" bilgisi düzenli tazelenir.
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') void reloadUnread().catch(() => undefined)
    }, HEARTBEAT_MS)

    return () => {
      clearInterval(heartbeat)
      document.removeEventListener('visibilitychange', onVisible)
      unsubs.forEach((unsub) => unsub())
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<DataValue>(() => {
    const totalUnreadMessages = Object.values(unread.conversations).reduce((a, b) => a + b, 0)
    return {
      users: allUsers.filter((u) => u.active),
      usersById: new Map(allUsers.map((u) => [u.id, u])),
      departments,
      departmentsById: new Map(departments.map((d) => [d.id, d])),
      unread,
      totalUnreadMessages,
      reloadDirectory,
      reloadUnread,
      setActiveConversation,
      markConversationRead,
    }
  }, [allUsers, departments, unread, reloadDirectory, reloadUnread, setActiveConversation, markConversationRead])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData, DataProvider içinde kullanılmalı')
  return ctx
}
