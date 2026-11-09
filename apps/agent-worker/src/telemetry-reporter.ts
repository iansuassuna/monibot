import type { InteractionLogCreate } from '@monibot/types'

/** The API rejected the turn as invalid; retrying the same payload can never succeed. */
export class TelemetryRejectedError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'TelemetryRejectedError'
  }
}

interface TelemetryReporterOptions {
  retryDelaysMs?: readonly number[]
  onDropped?: (log: InteractionLogCreate, error: TelemetryRejectedError) => void
  onStillPending?: (log: InteractionLogCreate, error: unknown) => void
}

const DEFAULT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const

/**
 * Uploads turns in order without blocking audio. Transient failures keep the turn buffered for
 * the next flush (each turn and shutdown flushes); a permanent rejection drops that turn — via
 * `onDropped`, never silently — so it cannot block the turns queued behind it.
 */
export class TelemetryReporter {
  private readonly buffer: InteractionLogCreate[] = []
  private inFlight: Promise<void> | null = null
  private readonly retryDelaysMs: readonly number[]

  constructor(
    private readonly send: (log: InteractionLogCreate) => Promise<void>,
    private readonly options: TelemetryReporterOptions = {}
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  }

  get pending(): number {
    return this.buffer.length
  }

  report(log: InteractionLogCreate): void {
    this.buffer.push(log)
    void this.flush()
  }

  /** Single-flight: concurrent callers share one drain, so no turn is sent twice. */
  flush(): Promise<void> {
    this.inFlight ??= this.drain().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async drain(): Promise<void> {
    while (this.buffer.length > 0) {
      const next = this.buffer[0]
      if (!next) return
      const outcome = await this.sendWithRetry(next)
      if (outcome === 'pending') return
      this.buffer.shift()
    }
  }

  private async sendWithRetry(log: InteractionLogCreate): Promise<'sent' | 'dropped' | 'pending'> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.send(log)
        return 'sent'
      } catch (error) {
        if (error instanceof TelemetryRejectedError) {
          this.options.onDropped?.(log, error)
          return 'dropped'
        }
        const delay = this.retryDelaysMs[attempt]
        if (delay === undefined) {
          this.options.onStillPending?.(log, error)
          return 'pending'
        }
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
}
