import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { pb } from '../lib/pb'
import { removePushSubscription, syncPushSubscription } from '../lib/push'
import type { User } from '../lib/types'

interface AuthValue {
  user: User | null
  login: (identity: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => (pb.authStore.isValid ? (pb.authStore.record as User) : null))

  useEffect(() => pb.authStore.onChange((_, record) => setUser((record as User | null) ?? null)), [])

  // Açılışta oturumu tazele; pasifleştirilmiş kullanıcı otomatik çıkar.
  useEffect(() => {
    if (!pb.authStore.isValid) return
    pb.collection('users')
      .authRefresh()
      .then(() => syncPushSubscription())
      .catch((err: { status?: number }) => {
        if (err?.status === 401 || err?.status === 403 || err?.status === 404) pb.authStore.clear()
      })
  }, [])

  const login = useCallback(async (identity: string, password: string) => {
    await pb.collection('users').authWithPassword(identity.trim().toLowerCase(), password)
    void syncPushSubscription()
  }, [])

  const logout = useCallback(async () => {
    await removePushSubscription().catch(() => undefined)
    pb.realtime.unsubscribe().catch(() => undefined)
    pb.authStore.clear()
  }, [])

  const refresh = useCallback(async () => {
    await pb.collection('users').authRefresh()
  }, [])

  return <AuthContext.Provider value={{ user, login, logout, refresh }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı')
  return ctx
}

/** Giriş yapılmış sayfalarda kullanıcıyı kesin olarak döndürür. */
export function useMe(): User {
  const { user } = useAuth()
  if (!user) throw new Error('Oturum yok')
  return user
}
