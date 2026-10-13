import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { MessageCircle, Phone, Search } from 'lucide-react'
import { useMe } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { errorMessage, pb } from '../lib/pb'
import { ROLE_LABEL } from '../lib/labels'
import type { Conversation, User } from '../lib/types'
import { Avatar, ErrorNote, Input, PageHeader } from '../components/ui'

export default function DirectoryPage() {
  const me = useMe()
  const navigate = useNavigate()
  const { users, departments, departmentsById } = useData()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)

  const groups = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr')
    const match = (u: User) =>
      !needle || [u.name, u.title, departmentsById.get(u.department)?.name].some((v) => v?.toLocaleLowerCase('tr').includes(needle))
    const visible = users.filter(match)
    const result = departments.map((d) => ({ name: d.name, users: visible.filter((u) => u.department === d.id) }))
    const noDept = visible.filter((u) => !u.department || !departmentsById.has(u.department))
    if (noDept.length) result.push({ name: 'Birimsiz', users: noDept })
    return result.filter((g) => g.users.length)
  }, [users, departments, departmentsById, q])

  const message = async (u: User) => {
    try {
      const c = await pb.send<Conversation>('/api/artu/conversations/direct', { method: 'POST', body: { userId: u.id } })
      navigate(`/mesajlar/${c.id}`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Rehber" subtitle={`${users.length} çalışan`} />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="İsim, unvan veya birim ara…" className="pl-9" />
      </div>
      <ErrorNote message={error} />
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.name}>
            <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">
              {g.name} <span className="font-normal">({g.users.length})</span>
            </h2>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-sm">
              {g.users.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar user={u} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-stone-800">{u.name}</div>
                    <div className="truncate text-xs text-stone-500">{u.title || ROLE_LABEL[u.role]}</div>
                  </div>
                  {u.phone && (
                    <a href={`tel:${u.phone.replace(/\s/g, '')}`} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-cocoa-700" aria-label={`${u.name} ara`}>
                      <Phone className="size-4" />
                    </a>
                  )}
                  {u.id !== me.id && (
                    <button type="button" onClick={() => void message(u)} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-cocoa-700" aria-label={`${u.name} mesaj gönder`}>
                      <MessageCircle className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
