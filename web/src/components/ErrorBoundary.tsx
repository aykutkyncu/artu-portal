import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  hasError: boolean
}

/** Beklenmeyen bir hata (ör. zayıf bağlantıda sayfa dosyası yüklenemezse) beyaz ekran yerine yenileme seçeneği gösterir. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Arayüz hatası', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cocoa-50 px-6 text-center">
        <img src="/logo.webp" alt="Artu" className="h-16 w-auto" />
        <p className="font-medium text-stone-800">Bir şeyler ters gitti.</p>
        <p className="text-sm text-stone-500">İnternet bağlantınızı kontrol edip sayfayı yenileyin.</p>
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-cocoa-700 px-5 py-2 text-sm font-medium text-white">
          Yenile
        </button>
      </div>
    )
  }
}
