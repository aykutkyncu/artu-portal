import clsx from 'clsx'
import { X, Loader2, Paperclip, FileText } from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import type { RecordModel } from 'pocketbase'
import { avatarUrl, displayFilename, fileUrl, isImage, useFileToken } from '../lib/pb'
import { initials } from '../lib/format'
import type { User } from '../lib/types'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-cocoa-700 text-white hover:bg-cocoa-800 active:bg-cocoa-900 shadow-sm',
  secondary: 'bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 active:bg-stone-100',
  ghost: 'text-stone-600 hover:bg-stone-100 active:bg-stone-200',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  isLoading?: boolean
  size?: 'sm' | 'md'
}

export function Button({ variant = 'primary', isLoading, size = 'md', className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || isLoading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cocoa-500 disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-4 py-2 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {isLoading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={clsx('inline-flex size-9 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40', className)}
    >
      {children}
    </button>
  )
}

const fieldCls =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-base text-stone-800 placeholder:text-stone-400 sm:text-sm focus:border-cocoa-400 focus:outline-none focus:ring-2 focus:ring-cocoa-200 disabled:bg-stone-50'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx(fieldCls, className)} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx(fieldCls, 'resize-y', className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx(fieldCls, 'pr-8', className)}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block space-y-1', className)}>
      <span className="text-xs font-medium text-stone-600">{label}</span>
      {children}
      {hint && <span className="block text-xs text-stone-400">{hint}</span>}
    </label>
  )
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded accent-cocoa-700" />
      {label}
    </label>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          'flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
          <h2 className="text-base font-semibold text-stone-900">{title}</h2>
          <IconButton label="Kapat" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="safe-bottom flex justify-end gap-2 border-t border-stone-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Avatar({ user, size = 36, className }: { user?: User | null; size?: number; className?: string }) {
  const url = avatarUrl(user)
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) }
  if (url) return <img src={url} alt={user?.name ?? ''} style={style} className={clsx('shrink-0 rounded-full object-cover', className)} />
  return (
    <span style={style} className={clsx('inline-flex shrink-0 items-center justify-center rounded-full bg-cocoa-200 font-semibold text-cocoa-800', className)}>
      {initials(user?.name)}
    </span>
  )
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium', className)}>{children}</span>
}

export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (!count) return null
  return (
    <span className={clsx('inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white', className)}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div className={clsx('flex justify-center py-10', className)}>
      <Loader2 className="size-6 animate-spin text-cocoa-400" />
    </div>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 text-cocoa-300">{icon}</div>
      <p className="font-medium text-stone-700">{title}</p>
      {children && <div className="mt-1 text-sm text-stone-500">{children}</div>}
    </div>
  )
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Kayda ait dosya eklerini gösterir: resimler küçük önizleme, diğerleri bağlantı. */
export function Attachments({ record, files, compact }: { record: RecordModel; files: string[]; compact?: boolean }) {
  const token = useFileToken()
  if (!files?.length) return null
  if (!token) return <div className="mt-2 h-10 animate-pulse rounded-lg bg-stone-100" />
  const images = files.filter(isImage)
  const others = files.filter((f) => !isImage(f))
  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => (
            <a key={f} href={fileUrl(record, f, undefined, token)} target="_blank" rel="noopener noreferrer">
              <img
                src={fileUrl(record, f, '400x0', token)}
                alt={displayFilename(f)}
                loading="lazy"
                className={clsx('rounded-lg border border-stone-200 object-cover', compact ? 'max-h-48 max-w-[240px]' : 'max-h-72 max-w-full')}
              />
            </a>
          ))}
        </div>
      )}
      {others.map((f) => (
        <a
          key={f}
          href={fileUrl(record, f, undefined, token)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex max-w-xs items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
        >
          <FileText className="size-4 shrink-0 text-cocoa-500" />
          <span className="truncate">{displayFilename(f)}</span>
        </a>
      ))}
    </div>
  )
}

/** Dosya seçici + seçilenlerin listesi. */
export function FilePicker({ files, onChange, accept }: { files: File[]; onChange: (f: File[]) => void; accept?: string }) {
  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50">
        <Paperclip className="size-4" /> Dosya ekle
        <input
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            onChange([...files, ...Array.from(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-md bg-stone-50 px-2 py-1 text-xs text-stone-600">
              <span className="truncate">{f.name}</span>
              <button type="button" className="ml-2 text-stone-400 hover:text-red-600" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label="Kaldır">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
