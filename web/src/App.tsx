import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Spinner } from './components/ui'
import { AuthProvider, useAuth } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { isAdmin, isConfigured } from './lib/db'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'

// Takvim gibi ağır sayfalar ihtiyaç anında yüklenir.
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'))
const AnnouncementDetailPage = lazy(() => import('./pages/AnnouncementDetailPage'))
const MessagesPage = lazy(() => import('./pages/MessagesPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const ShiftsPage = lazy(() => import('./pages/ShiftsPage'))
const ProductionPage = lazy(() => import('./pages/ProductionPage'))
const DirectoryPage = lazy(() => import('./pages/DirectoryPage'))
const LeavesPage = lazy(() => import('./pages/LeavesPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/giris" replace />
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return isAdmin(user) ? children : <Navigate to="/" replace />
}

function AppRoutes() {
  const { user, isReady } = useAuth()
  if (!isReady) return <Spinner className="min-h-dvh items-center" />
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/giris" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="duyurular" element={<AnnouncementsPage />} />
          <Route path="duyurular/:id" element={<AnnouncementDetailPage />} />
          <Route path="mesajlar" element={<MessagesPage />} />
          <Route path="mesajlar/:id" element={<MessagesPage />} />
          <Route path="takvim" element={<CalendarPage />} />
          <Route path="gorevler" element={<TasksPage />} />
          <Route path="vardiya" element={<ShiftsPage />} />
          <Route path="uretim" element={<ProductionPage />} />
          <Route path="izinler" element={<LeavesPage />} />
          <Route path="rehber" element={<DirectoryPage />} />
          <Route path="profil" element={<ProfilePage />} />
          <Route
            path="yonetim"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

/** Supabase bilgileri girilmeden derlenmişse (Render ortam değişkenleri eksik) boş ekran yerine ne yapılacağını söyler. */
function SetupNotice() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-50 px-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-lg font-semibold text-stone-900">Kurulum tamamlanmamış</h1>
        <p className="text-sm text-stone-600">
          Supabase bağlantı bilgileri (VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY) girilmemiş. Adımlar KURULUM.md dosyasında anlatılıyor.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  if (!isConfigured) return <SetupNotice />
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <DataProvider>
            <AppRoutes />
          </DataProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
