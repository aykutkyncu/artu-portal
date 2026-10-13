import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { pb } from '../lib/pb'
import type { Department, Message, User } from '../lib/types'
import { useAuth } from './AuthContext'

interface Unread {
  conversations: Record<string, number>
  announcements: number
}

interface DataValue {
  users: User[]
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
  const { user } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [unread, setUnread] = useState<Unread>(EMPTY_UNREAD)
  const activeConversation = useRef<string | null>(null)

  const reloadDirectory = useCallback(async () => {
    const [u, d] = await Promise.all([
      pb.collection('users').getFullList<User>({ sort: 'name', filter: 'active = true' }),
      pb.collection('departments').getFullList<Department>({ sort: 'name' }),
    ])
    setUsers(u)
    setDepartments(d)
  }, [])

  const unreadSeq = useRef(0)
  const reloadUnread = useCallback(async () => {
    // Geç dönen eski bir yanıt, daha yeni sayaçların üzerine yazmasın.
    const seq = ++unreadSeq.current
    const data = await pb.send<Unread>('/api/artu/unread', {})
    if (seq !== unreadSeq.current) return
    if (activeConversation.current) delete data.conversations[activeConversation.current]
    setUnread(data)
  }, [])

  const markConversationRead = useCallback(async (id: string) => {
    unreadSeq.current++ // devam eden eski sayaç isteğini geçersiz kıl
    setUnread((u) => {
      if (!u.conversations[id]) return u
      const conversations = { ...u.conversations }
      delete conversations[id]
      return { ...u, conversations }
    })
    await pb.send(`/api/artu/conversations/${id}/read`, { method: 'POST' }).catch(() => undefined)
  }, [])

  const setActiveConversation = useCallback((id: string | null) => {
    activeConversation.current = id
  }, [])

  useEffect(() => {
    if (!user) {
      setUsers([])
      setDepartments([])
      setUnread(EMPTY_UNREAD)
      return
    }
    void reloadDirectory().catch(() => undefined)
    void reloadUnread().catch(() => undefined)

    // Yeni mesaj / duyuru geldiğinde sayaçları canlı güncelle.
    const unsubs: Array<Promise<() => Promise<void>>> = [
      pb.collection('messages').subscribe<Message>('*', (e) => {
        if (e.action !== 'create' || e.record.sender === user.id) return
        if (e.record.conversation === activeConversation.current) return
        setUnread((u) => ({
          ...u,
          conversations: { ...u.conversations, [e.record.conversation]: (u.conversations[e.record.conversation] ?? 0) + 1 },
        }))
      }),
      pb.collection('announcements').subscribe('*', (e) => {
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
      unsubs.forEach((p) => p.then((fn) => fn()).catch(() => undefined))
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<DataValue>(() => {
    const totalUnreadMessages = Object.values(unread.conversations).reduce((a, b) => a + b, 0)
    return {
      users,
      usersById: new Map(users.map((u) => [u.id, u])),
      departments,
      departmentsById: new Map(departments.map((d) => [d.id, d])),
      unread,
      totalUnreadMessages,
      reloadDirectory,
      reloadUnread,
      setActiveConversation,
      markConversationRead,
    }
  }, [users, departments, unread, reloadDirectory, reloadUnread, setActiveConversation, markConversationRead])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData, DataProvider içinde kullanılmalı')
  return ctx
}
