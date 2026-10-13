import clsx from 'clsx'
import { Check, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useData } from '../context/DataContext'
import { Avatar, Input } from './ui'

/** Birden çok kullanıcı seçimi (arama + birim etiketi). */
export function UserPicker({
  value,
  onChange,
  exclude = [],
  single,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  exclude?: string[]
  single?: boolean
}) {
  const { users, departmentsById } = useData()
  const [q, setQ] = useState('')

  const visible = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase('tr')
    return users.filter(
      (u) =>
        !exclude.includes(u.id) &&
        (!needle ||
          u.name.toLocaleLowerCase('tr').includes(needle) ||
          (departmentsById.get(u.department)?.name ?? '').toLocaleLowerCase('tr').includes(needle)),
    )
  }, [users, q, exclude, departmentsById])

  const toggle = (id: string) => {
    if (single) return onChange(value.includes(id) ? [] : [id])
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <div className="rounded-lg border border-stone-200">
      <div className="relative border-b border-stone-100 p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-stone-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="İsim veya birim ara…" className="pl-8" />
      </div>
      <ul className="max-h-56 overflow-y-auto p-1">
        {visible.map((u) => {
          const selected = value.includes(u.id)
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => toggle(u.id)}
                className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', selected ? 'bg-cocoa-50' : 'hover:bg-stone-50')}
              >
                <Avatar user={u} size={26} />
                <span className="flex-1 truncate">
                  {u.name}
                  <span className="ml-1.5 text-xs text-stone-400">{departmentsById.get(u.department)?.name}</span>
                </span>
                {selected && <Check className="size-4 text-cocoa-600" />}
              </button>
            </li>
          )
        })}
        {visible.length === 0 && <li className="px-2 py-3 text-center text-sm text-stone-400">Kimse bulunamadı</li>}
      </ul>
      {!single && value.length > 0 && <div className="border-t border-stone-100 px-3 py-1.5 text-xs text-stone-500">{value.length} kişi seçili</div>}
    </div>
  )
}

/** Birim seçimi (çoklu). Boş seçim "Tüm şirket" anlamına gelir. */
export function DepartmentPicker({ value, onChange, emptyLabel = 'Tüm şirket' }: { value: string[]; onChange: (ids: string[]) => void; emptyLabel?: string }) {
  const { departments } = useData()
  const chip = (active: boolean) =>
    clsx('rounded-full border px-3 py-1 text-xs font-medium transition-colors', active ? 'border-cocoa-700 bg-cocoa-700 text-white' : 'border-stone-200 bg-white text-stone-600 hover:border-cocoa-300')

  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={chip(value.length === 0)} onClick={() => onChange([])}>
        {emptyLabel}
      </button>
      {departments.map((d) => (
        <button
          key={d.id}
          type="button"
          className={chip(value.includes(d.id))}
          onClick={() => onChange(value.includes(d.id) ? value.filter((v) => v !== d.id) : [...value, d.id])}
        >
          {d.name}
        </button>
      ))}
    </div>
  )
}
