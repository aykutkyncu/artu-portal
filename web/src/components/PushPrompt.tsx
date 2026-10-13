import { useEffect, useState } from 'react'
import { BellRing, Share, X } from 'lucide-react'
import { enablePush, getPushState, type PushState } from '../lib/push'
import { Button } from './ui'

const DISMISS_KEY = 'artu.pushPromptDismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/** Bildirimler kapalıysa kullanıcıyı açmaya davet eden şerit. */
export function PushPrompt() {
  const [state, setState] = useState<PushState | null>(null)
  const [isHidden, setIsHidden] = useState(wasDismissed)
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    getPushState().then(setState).catch(() => setState('unsupported'))
  }, [])

  if (isHidden || !state || state === 'enabled' || state === 'unsupported') return null

  const dismiss = () => {
    setIsHidden(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* depolama kapalı olabilir */
    }
  }

  return (
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <BellRing className="mt-0.5 size-5 shrink-0 text-amber-700" />
      <div className="flex-1 text-sm text-amber-900">
        {state === 'needs-install' && (
          <>
            <b>Bildirim almak için uygulamayı ana ekrana ekleyin:</b> Safari'de <Share className="inline size-4" /> Paylaş → “Ana Ekrana Ekle”, sonra
            uygulamayı ana ekrandan açın.
          </>
        )}
        {state === 'denied' && <>Bildirimler engellenmiş. Tarayıcı / telefon ayarlarından bu site için bildirimlere izin verin.</>}
        {state === 'default' && (
          <div className="flex flex-wrap items-center gap-3">
            <span>Yeni mesaj, duyuru ve görevlerden anında haberdar olmak için bildirimleri açın.</span>
            <Button
              size="sm"
              isLoading={isBusy}
              onClick={async () => {
                setIsBusy(true)
                setState(await enablePush().catch(() => 'default' as const))
                setIsBusy(false)
              }}
            >
              Bildirimleri aç
            </Button>
          </div>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Kapat" className="text-amber-700/60 hover:text-amber-900">
        <X className="size-4" />
      </button>
    </div>
  )
}
