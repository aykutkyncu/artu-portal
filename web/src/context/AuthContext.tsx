import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { loginEmail, maybeRow, supabase } from '../lib/db'
import { removePushSubscription, syncPushSubscription } from '../lib/push'
import type { User } from '../lib/types'

interface AuthValue {
  user: User | null
  /** Açılışta kayıtlı oturum denetlenene kadar false'tur. */
  isReady: boolean
  login: (identity: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Profil bilgilerini (ad, fotoğraf, rol…) sunucudan tazeler. */
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

// Son profil cihazda saklanır: uygulama internet yokken de açılır, açılışta beklemez.
const PROFILE_KEY = 'artu.profile'

function readCachedProfile(id: string): User | null {
  try {
    const cached = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as User | null
    return cached?.id === id ? cached : null
  } catch {
    return null
  }
}

function cacheProfile(user: User | null): void {
  try {
    if (user) localStorage.setItem(PROFILE_KEY, JSON.stringify(user))
    else localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* depolama kapalı olabilir */
  }
}

/** Pasif hesap kendi profilini göremez (RLS); bu durumda null döner. */
function fetchProfile(id: string): Promise<User | null> {
  return maybeRow<User>(supabase.from('profiles').select('*').eq('id', id).maybeSingle())
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null)
  const [isReady, setIsReady] = useState(false)

  const setUser = useCallback((next: User | null) => {
    cacheProfile(next)
    setUserState(next)
  }, [])

  // Açılışta kayıtlı oturumu yükle; pasifleştirilmiş kullanıcı otomatik çıkar.
  useEffect(() => {
    let alive = true
    void (async () => {
      const { data } = await supabase.auth.getSession()
      const id = data.session?.user.id
      if (!alive) return
      if (!id) {
        setUser(null)
        setIsReady(true)
        return
      }
      const cached = readCachedProfile(id)
      if (cached) {
        setUserState(cached)
        setIsReady(true)
      }
      try {
        const fresh = await fetchProfile(id)
        if (!alive) return
        if (fresh) {
          setUser(fresh)
          void syncPushSubscription()
        } else {
          await supabase.auth.signOut({ scope: 'local' })
          setUser(null)
        }
      } catch {
        // İnternet yok: saklanan profille devam et.
      } finally {
        if (alive) setIsReady(true)
      }
    })()

    // Oturum yenilenemezse (şifre değişti, hesap pasifleştirildi) giriş ekranına dön.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setUser(null)
    })
    return () => {
      alive = false
      listener.subscription.unsubscribe()
    }
  }, [setUser])

  const login = useCallback(
    async (identity: string, password: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail(identity), password })
      if (error) throw error
      const profile = await fetchProfile(data.user.id)
      if (!profile) {
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('Hesabınız pasif. Yöneticinize başvurun.')
      }
      setUser(profile)
      void syncPushSubscription()
    },
    [setUser],
  )

  const logout = useCallback(async () => {
    await removePushSubscription().catch(() => undefined)
    await supabase.removeAllChannels().catch(() => undefined)
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    setUser(null)
  }, [setUser])

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const id = data.session?.user.id
    if (!id) return
    const fresh = await fetchProfile(id)
    if (fresh) setUser(fresh)
  }, [setUser])

  return <AuthContext.Provider value={{ user, isReady, login, logout, refresh }}>{children}</AuthContext.Provider>
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
