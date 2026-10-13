import { useState, type FormEvent } from 'react'
import { Lock, User as UserIcon } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { errorMessage } from '../lib/db'
import { Button, ErrorNote, Input } from '../components/ui'

export default function LoginPage() {
  const { login } = useAuth()
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      await login(identity, password)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-cocoa-800 bg-[radial-gradient(circle_at_20%_10%,#7d5236_0%,transparent_45%),radial-gradient(circle_at_90%_90%,#331d12_0%,transparent_50%)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/logo.webp" alt="Artu" className="mx-auto h-24 w-auto drop-shadow-lg" />
          <h1 className="mt-3 text-2xl font-semibold text-white">Portal</h1>
          <p className="mt-1 text-sm text-cocoa-200">Duyurular, planlama ve mesajlaşma</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-6 shadow-2xl shadow-black/30">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-stone-600">Kullanıcı adı</span>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
              <Input
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                className="pl-9"
                placeholder="ornek: ahmet.yilmaz"
              />
            </div>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-stone-600">Şifre</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required className="pl-9" />
            </div>
          </label>
          <ErrorNote message={error} />
          <Button type="submit" isLoading={isLoading} className="w-full py-2.5">
            Giriş yap
          </Button>
          <p className="text-center text-xs text-stone-400">Hesabınız yoksa yöneticinizle iletişime geçin.</p>
        </form>
      </div>
    </div>
  )
}
