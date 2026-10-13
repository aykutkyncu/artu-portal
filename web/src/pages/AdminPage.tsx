import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Building2, Pencil, Plus, Search, Trash2, UserPlus } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, pb } from '../lib/pb'
import { fromNow } from '../lib/format'
import { ROLE_LABEL } from '../lib/labels'
import type { Department, Role, User } from '../lib/types'
import { Avatar, Badge, Button, Checkbox, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui'

type Tab = 'users' | 'departments'

/** "Ayşe Çelik" → "ayse.celik" */
function suggestUsername(name: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' }
  return name
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.')
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('users')
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Yönetim" subtitle="Kullanıcılar, roller ve birimler" />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-stone-100 p-1">
        {(
          [
            ['users', 'Kullanıcılar'],
            ['departments', 'Birimler'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={clsx('rounded-md px-4 py-1.5 text-sm font-medium', tab === k ? 'bg-white shadow-sm' : 'text-stone-500')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' ? <UsersAdmin /> : <DepartmentsAdmin />}
    </div>
  )
}

function UsersAdmin() {
  const { departmentsById, reloadDirectory } = useData()
  const [users, setUsers] = useState<User[] | null>(null)
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<Partial<User> | null>(null)

  const load = useCallback(async () => {
    setUsers(await pb.collection('users').getFullList<User>({ sort: 'name' }))
  }, [])
  useEffect(() => {
    void load().catch(() => setUsers([]))
  }, [load])

  const visible = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr')
    return (users ?? []).filter((u) => (showInactive || u.active) && (!needle || `${u.name} ${u.username}`.toLocaleLowerCase('tr').includes(needle)))
  }, [users, q, showInactive])

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kullanıcı ara…" className="pl-9" />
        </div>
        <Checkbox label="Pasifleri göster" checked={showInactive} onChange={setShowInactive} />
        <Button onClick={() => setEditing({ role: 'staff', active: true })}>
          <UserPlus className="size-4" /> Kullanıcı ekle
        </Button>
      </div>

      {!users ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200/70 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-stone-100 text-left text-xs text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">Ad Soyad</th>
                <th className="px-2 py-2 font-medium">Kullanıcı adı</th>
                <th className="px-2 py-2 font-medium">Birim</th>
                <th className="px-2 py-2 font-medium">Rol</th>
                <th className="px-2 py-2 font-medium">Son görülme</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {visible.map((u) => (
                <tr key={u.id} className={clsx(!u.active && 'opacity-50')}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar user={u} size={28} />
                      <span className="font-medium text-stone-800">{u.name}</span>
                      {!u.active && <Badge className="bg-stone-200 text-stone-600">Pasif</Badge>}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-stone-600">{u.username}</td>
                  <td className="px-2 py-2 text-stone-600">{departmentsById.get(u.department)?.name ?? '—'}</td>
                  <td className="px-2 py-2">
                    <Badge className={u.role === 'admin' ? 'bg-cocoa-700 text-white' : u.role === 'manager' ? 'bg-cocoa-100 text-cocoa-800' : 'bg-stone-100 text-stone-600'}>
                      {ROLE_LABEL[u.role]}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-xs text-stone-500">{u.lastSeen ? fromNow(u.lastSeen) : 'hiç'}</td>
                  <td className="px-2 py-2 text-right">
                    <button type="button" onClick={() => setEditing(u)} className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Düzenle">
                      <Pencil className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <UserEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
            void reloadDirectory()
          }}
        />
      )}
    </>
  )
}

function UserEditor({ initial, onClose, onSaved }: { initial: Partial<User>; onClose: () => void; onSaved: () => void }) {
  const me = useMe()
  const { departments } = useData()
  const isNew = !initial.id
  const [form, setForm] = useState({
    name: initial.name ?? '',
    username: initial.username ?? '',
    email: initial.email ?? '',
    phone: initial.phone ?? '',
    title: initial.title ?? '',
    department: initial.department ?? '',
    role: (initial.role ?? 'staff') as Role,
    active: initial.active ?? true,
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [usernameTouched, setUsernameTouched] = useState(!isNew)
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const isSelf = initial.id === me.id

  const save = async () => {
    if (!form.name.trim() || !form.username.trim()) return setError('Ad soyad ve kullanıcı adı zorunludur.')
    if ((isNew || password) && password.length < 10) return setError('Şifre en az 10 karakter olmalıdır.')
    setIsSaving(true)
    setError(null)
    try {
      const data: Record<string, unknown> = { ...form, name: form.name.trim(), username: form.username.trim().toLowerCase(), emailVisibility: true }
      if (password) Object.assign(data, { password, passwordConfirm: password })
      if (isNew) await pb.collection('users').create(data)
      else await pb.collection('users').update(initial.id!, data)
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? 'Yeni kullanıcı' : `${initial.name} düzenle`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} isLoading={isSaving}>
            Kaydet
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ad Soyad">
          <Input
            value={form.name}
            autoFocus
            onChange={(e) => {
              set('name', e.target.value)
              if (!usernameTouched) set('username', suggestUsername(e.target.value))
            }}
          />
        </Field>
        <Field label="Kullanıcı adı (giriş için)">
          <Input
            value={form.username}
            onChange={(e) => {
              setUsernameTouched(true)
              set('username', e.target.value.toLowerCase())
            }}
            pattern="[a-z0-9._-]+"
          />
        </Field>
        <Field label={isNew ? 'Şifre' : 'Yeni şifre (değiştirmek için)'} hint="En az 10 karakter. Kullanıcı daha sonra profilinden değiştirebilir.">
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="E-posta (opsiyonel)">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Birim">
          <Select value={form.department} onChange={(e) => set('department', e.target.value)}>
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rol" hint="Birim Sorumlusu: duyuru, vardiya ve üretim planı girebilir. Admin: her şeyi yönetir.">
          <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)} disabled={isSelf}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unvan">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Örn: Üretim Şefi" />
        </Field>
        <Field label="Telefon">
          <Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        {!isSelf && (
          <div className="sm:col-span-2">
            <Checkbox label="Hesap aktif (pasif kullanıcı giriş yapamaz, mesaj geçmişi korunur)" checked={form.active} onChange={(v) => set('active', v)} />
          </div>
        )}
        <div className="sm:col-span-2">
          <ErrorNote message={error} />
        </div>
      </div>
    </Modal>
  )
}

function DepartmentsAdmin() {
  const { departments, users, reloadDirectory } = useData()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<Department | null>(null)
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    if (!name.trim()) return
    setError(null)
    try {
      await pb.collection('departments').create({ name: name.trim() })
      setName('')
      await reloadDirectory()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const rename = async () => {
    if (!editing) return
    try {
      await pb.collection('departments').update(editing.id, { name: editing.name.trim() })
      setEditing(null)
      await reloadDirectory()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const remove = async (d: Department) => {
    const count = users.filter((u) => u.department === d.id).length
    if (count > 0) return setError(`"${d.name}" biriminde ${count} kişi var. Önce kişileri başka birime taşıyın.`)
    if (!window.confirm(`"${d.name}" birimi silinsin mi?`)) return
    try {
      await pb.collection('departments').delete(d.id)
      await reloadDirectory()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="max-w-xl space-y-3">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Yeni birim adı (ör: Üretim, Satış, Lojistik)" onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <Button onClick={add}>
          <Plus className="size-4" /> Ekle
        </Button>
      </div>
      <ErrorNote message={error} />
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
        {departments.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
            <Building2 className="size-4 text-cocoa-500" />
            {editing?.id === d.id ? (
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void rename()} autoFocus onBlur={rename} />
            ) : (
              <span className="flex-1 text-sm text-stone-800">
                {d.name} <span className="text-xs text-stone-400">({users.filter((u) => u.department === d.id).length} kişi)</span>
              </span>
            )}
            <button type="button" onClick={() => setEditing(d)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100" aria-label="Yeniden adlandır">
              <Pencil className="size-4" />
            </button>
            <button type="button" onClick={() => void remove(d)} className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="Sil">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {departments.length === 0 && <li className="px-4 py-6 text-center text-sm text-stone-400">Henüz birim yok</li>}
      </ul>
    </div>
  )
}
