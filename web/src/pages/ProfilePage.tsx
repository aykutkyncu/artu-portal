import { useEffect, useState } from 'react'
import { Bell, BellOff, Camera, Download, LogOut, Monitor, Smartphone } from 'lucide-react'
import { useAuth, useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, pb } from '../lib/pb'
import { ROLE_LABEL } from '../lib/labels'
import { compressImage } from '../lib/upload'
import { enablePush, getPushState, isStandalone, type PushState } from '../lib/push'
import { Avatar, Button, ErrorNote, Field, Input, PageHeader } from '../components/ui'

export default function ProfilePage() {
  const me = useMe()
  const { logout } = useAuth()
  const { departmentsById, reloadDirectory } = useData()
  const [form, setForm] = useState({ name: me.name, title: me.title, phone: me.phone })
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    setIsSaving(true)
    setError(null)
    setMsg(null)
    try {
      await pb.collection('users').update(me.id, { name: form.name.trim(), title: form.title, phone: form.phone })
      await reloadDirectory()
      setMsg('Bilgileriniz kaydedildi.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return
    try {
      const fd = new FormData()
      fd.append('avatar', await compressImage(file))
      await pb.collection('users').update(me.id, fd)
      await reloadDirectory()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Profilim" />

      <section className="rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-4">
          <label className="group relative cursor-pointer">
            <Avatar user={me} size={72} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
              <Camera className="size-5" />
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
          </label>
          <div>
            <div className="text-lg font-semibold text-stone-900">{me.name}</div>
            <div className="text-sm text-stone-500">
              @{me.username} · {ROLE_LABEL[me.role]}
              {me.department && ` · ${departmentsById.get(me.department)?.name ?? ''}`}
            </div>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ad Soyad" className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Unvan">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Telefon">
            <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          {msg && <span className="text-sm text-green-700">{msg}</span>}
          <Button onClick={save} isLoading={isSaving}>
            Kaydet
          </Button>
        </div>
        <ErrorNote message={error} />
      </section>

      <NotificationsCard />
      <InstallCard />
      <PasswordCard />

      <Button variant="secondary" onClick={() => void logout()} className="w-full">
        <LogOut className="size-4" /> Çıkış yap
      </Button>
    </div>
  )
}

function NotificationsCard() {
  const [state, setState] = useState<PushState | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  useEffect(() => {
    getPushState().then(setState).catch(() => setState('unsupported'))
  }, [])

  const text: Record<PushState, string> = {
    enabled: 'Bu cihazda bildirimler açık.',
    default: 'Bu cihazda bildirimler kapalı.',
    denied: 'Bildirimler tarayıcı/telefon ayarlarından engellenmiş. Site ayarlarından izin verin.',
    'needs-install': "iPhone'da bildirim için önce uygulamayı ana ekrana ekleyin (aşağıya bakın).",
    unsupported: 'Bu tarayıcı bildirimleri desteklemiyor. Chrome, Edge veya Safari kullanın.',
  }

  return (
    <section className="flex items-center gap-4 rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm">
      {state === 'enabled' ? <Bell className="size-6 text-green-600" /> : <BellOff className="size-6 text-stone-400" />}
      <div className="flex-1">
        <h2 className="text-sm font-semibold text-stone-800">Bildirimler</h2>
        <p className="text-sm text-stone-500">{state ? text[state] : '…'}</p>
      </div>
      {state === 'default' && (
        <Button
          isLoading={isBusy}
          onClick={async () => {
            setIsBusy(true)
            setState(await enablePush().catch(() => 'default' as const))
            setIsBusy(false)
          }}
        >
          Aç
        </Button>
      )}
    </section>
  )
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

function InstallCard() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (isStandalone()) return null

  return (
    <section className="rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-800">
          <Download className="size-4 text-cocoa-600" /> Uygulama olarak yükle
        </h2>
        {deferred && (
          <Button size="sm" onClick={() => void deferred.prompt()}>
            Şimdi yükle
          </Button>
        )}
      </div>
      <ul className="space-y-2 text-sm text-stone-600">
        <li className="flex gap-2">
          <Smartphone className="mt-0.5 size-4 shrink-0 text-stone-400" />
          <span>
            <b>Android:</b> Chrome menüsü (⋮) → “Uygulamayı yükle” / “Ana ekrana ekle”. <b>iPhone:</b> Safari → Paylaş → “Ana Ekrana Ekle”.
          </span>
        </li>
        <li className="flex gap-2">
          <Monitor className="mt-0.5 size-4 shrink-0 text-stone-400" />
          <span>
            <b>Bilgisayar:</b> Chrome / Edge adres çubuğunun sağındaki “Yükle” simgesine tıklayın. Masaüstü ve başlat menüsüne kısayol eklenir.
          </span>
        </li>
      </ul>
    </section>
  )
}

function PasswordCard() {
  const me = useMe()
  const [oldPassword, setOld] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const save = async () => {
    if (password.length < 10) return setError('Yeni şifre en az 10 karakter olmalı.')
    setIsSaving(true)
    setError(null)
    setMsg(null)
    try {
      await pb.collection('users').update(me.id, { oldPassword, password, passwordConfirm: password })
      // Şifre değişince oturum anahtarı yenilenir; yeni şifreyle tekrar giriş yap.
      await pb.collection('users').authWithPassword(me.username, password)
      setOld('')
      setPassword('')
      setMsg('Şifreniz değiştirildi.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200/70 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-stone-800">Şifre değiştir</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mevcut şifre">
          <Input type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="Yeni şifre">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {msg && <span className="text-sm text-green-700">{msg}</span>}
        <Button variant="secondary" onClick={save} isLoading={isSaving} disabled={!oldPassword || !password}>
          Şifreyi değiştir
        </Button>
      </div>
      <ErrorNote message={error} />
    </section>
  )
}
