import clsx from 'clsx'
import {
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Factory,
  Home,
  LogOut,
  Megaphone,
  MessageCircle,
  MoreHorizontal,
  Settings,
  Users,
  CalendarClock,
  UserCircle,
  TreePalm,
  Wrench,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { isAdmin } from '../lib/db'
import { ROLE_LABEL } from '../lib/labels'
import { Avatar, CountBadge, Modal } from './ui'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  badge?: number
}

function useNavItems(): NavItem[] {
  const { user } = useAuth()
  const { unread, totalUnreadMessages } = useData()
  const items: NavItem[] = [
    { to: '/', label: 'Ana Sayfa', icon: <Home className="size-5" /> },
    { to: '/duyurular', label: 'Duyurular', icon: <Megaphone className="size-5" />, badge: unread.announcements },
    { to: '/mesajlar', label: 'Mesajlar', icon: <MessageCircle className="size-5" />, badge: totalUnreadMessages },
    { to: '/takvim', label: 'Takvim', icon: <CalendarDays className="size-5" /> },
    { to: '/gorevler', label: 'Görevler', icon: <ClipboardList className="size-5" /> },
    { to: '/vardiya', label: 'Vardiya', icon: <CalendarClock className="size-5" /> },
    { to: '/uretim', label: 'Üretim Planı', icon: <Factory className="size-5" /> },
    { to: '/izinler', label: 'İzinler', icon: <TreePalm className="size-5" />, badge: unread.leaves ?? 0 },
    { to: '/arizalar', label: 'Arızalar', icon: <Wrench className="size-5" />, badge: unread.faults ?? 0 },
    { to: '/kontroller', label: 'Kontroller', icon: <ClipboardCheck className="size-5" />, badge: unread.checks ?? 0 },
    { to: '/rehber', label: 'Rehber', icon: <Users className="size-5" /> },
  ]
  if (isAdmin(user)) items.push({ to: '/yonetim', label: 'Yönetim', icon: <Settings className="size-5" /> })
  return items
}

// Telefonda alt çubukta görünen ana bölümler; geri kalanlar "Diğer" menüsünde.
const MOBILE_PRIMARY = ['/', '/duyurular', '/mesajlar', '/gorevler']

export function Layout() {
  const { user, logout } = useAuth()
  const items = useNavItems()
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  // Bildirime tıklanınca service worker'dan gelen yönlendirme.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'navigate' && typeof e.data.url === 'string') navigate(e.data.url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])

  useEffect(() => setMoreOpen(false), [location.pathname])

  const primary = items.filter((i) => MOBILE_PRIMARY.includes(i.to))
  const secondary = items.filter((i) => !MOBILE_PRIMARY.includes(i.to))
  const secondaryBadge = secondary.reduce((n, i) => n + (i.badge ?? 0), 0)
  const isChat = /^\/mesajlar\/.+/.test(location.pathname)
  const isMessages = location.pathname.startsWith('/mesajlar')

  return (
    <div className="flex h-dvh">
      {/* Masaüstü yan menü */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-cocoa-900/10 bg-cocoa-800 text-cocoa-100 lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src="/logo.webp" alt="Artu" className="h-10 w-auto" />
          <div>
            <div className="text-[15px] font-semibold text-white">Portal</div>
            <div className="text-[11px] text-cocoa-300">Artu Çikolata</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-cocoa-600/60 font-medium text-white' : 'text-cocoa-200 hover:bg-cocoa-700 hover:text-white',
                )
              }
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              <CountBadge count={item.badge ?? 0} />
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <NavLink to="/profil" className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-cocoa-700">
            <Avatar user={user} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{user?.name}</div>
              <div className="truncate text-[11px] text-cocoa-300">{user ? ROLE_LABEL[user.role] : ''}</div>
            </div>
          </NavLink>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-cocoa-300 hover:bg-cocoa-700 hover:text-white"
          >
            <LogOut className="size-4" /> Çıkış yap
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobil üst çubuk */}
        {!isChat && (
          <header className="safe-top flex items-center justify-between bg-cocoa-800 px-4 py-2.5 text-white lg:hidden">
            <div className="flex items-center gap-2">
              <img src="/logo.webp" alt="Artu" className="h-7 w-auto" />
              <span className="font-semibold">Portal</span>
            </div>
            <NavLink to="/profil" aria-label="Profil">
              <Avatar user={user} size={30} />
            </NavLink>
          </header>
        )}

        <main className={clsx('min-h-0 flex-1', isMessages ? 'overflow-hidden' : 'overflow-y-auto px-4 py-4 sm:px-6 lg:px-8 lg:py-6')}>
          <Outlet />
        </main>

        {/* Mobil alt menü */}
        {!isChat && (
          <nav className="safe-bottom grid grid-cols-5 border-t border-stone-200 bg-white lg:hidden">
            {primary.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => clsx('relative flex flex-col items-center gap-0.5 py-2 text-[10px]', isActive ? 'text-cocoa-700' : 'text-stone-500')}
              >
                {item.icon}
                {item.label}
                <CountBadge count={item.badge ?? 0} className="absolute top-1 left-1/2 ml-1" />
              </NavLink>
            ))}
            <button type="button" onClick={() => setMoreOpen(true)} className="relative flex flex-col items-center gap-0.5 py-2 text-[10px] text-stone-500">
              <MoreHorizontal className="size-5" />
              Diğer
              <CountBadge count={secondaryBadge} className="absolute top-1 left-1/2 ml-1" />
            </button>
          </nav>
        )}
      </div>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menü">
        <div className="grid grid-cols-3 gap-2">
          {[...secondary, { to: '/profil', label: 'Profil', icon: <UserCircle className="size-5" /> }].map((item) => (
            <NavLink key={item.to} to={item.to} className="flex flex-col items-center gap-1.5 rounded-xl bg-cocoa-50 px-2 py-4 text-xs text-stone-700 active:bg-cocoa-100">
              <span className="text-cocoa-700">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
        <button type="button" onClick={() => void logout()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-stone-200 py-3 text-sm text-stone-600">
          <LogOut className="size-4" /> Çıkış yap
        </button>
      </Modal>
    </div>
  )
}
