'use client'

import type { MatrixCallCredentials } from '@monibot/types'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { startElementCallHost } from '@/lib/element-call/widget-host'

interface ElementCallFrameProps {
  credentials: MatrixCallCredentials
  onHangup: () => void
}

/** Element Call embedded as a widget, hosted with the student's Matrix credentials. */
export function ElementCallFrame({ credentials, onHangup }: ElementCallFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // Latest handler without restarting the call when the parent re-renders.
  const hangup = useEffectEvent(onHangup)
  const [failed, setFailed] = useState(false)

  // The widget host is an external system (Matrix client + postMessage bridge) bound to the iframe.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let stop: (() => void) | undefined
    const controller = new AbortController()
    startElementCallHost(iframe, credentials, { onHangup: () => hangup() }, controller.signal).then(
      (stopHost) => {
        if (controller.signal.aborted) stopHost()
        else stop = stopHost
      },
      () => setFailed(true)
    )
    return () => {
      controller.abort()
      stop?.()
    }
  }, [credentials])

  if (failed) {
    return (
      <Alert variant="destructive">
        Não foi possível abrir a chamada. Recarregue a página para tentar novamente.
      </Alert>
    )
  }
  return (
    <iframe
      ref={iframeRef}
      title="Chamada da monitoria (Element Call)"
      className="h-full min-h-[24rem] w-full rounded-xl border bg-card"
      allow="microphone; camera; display-capture; autoplay; clipboard-write; speaker-selection; screen-wake-lock"
    />
  )
}
