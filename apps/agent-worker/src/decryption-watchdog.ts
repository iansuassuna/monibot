export interface WatchedFrame {
  samples: Int16Array
  atMs: number
  /** The publisher muted the track: silence is then expected. */
  muted: boolean
}

export type DecryptionVerdict = 'suspected' | 'recovered'

/**
 * Detects a likely E2EE key mismatch on a remote audio track. LiveKit reports no error when
 * frames fail to decrypt; the decoder just yields digital silence (all-zero samples), whereas a
 * live microphone always carries some noise. A sustained all-zero run on an unmuted track is
 * therefore the only observable symptom.
 */
export class DecryptionWatchdog {
  private readonly windowMs: number
  private silentSinceMs: number | null = null
  private suspected = false

  constructor({ windowMs }: { windowMs: number }) {
    this.windowMs = windowMs
  }

  /** Returns a verdict only when the state changes; null otherwise. */
  observe({ samples, atMs, muted }: WatchedFrame): DecryptionVerdict | null {
    if (muted) {
      this.silentSinceMs = null
      return null
    }
    if (samples.some((sample) => sample !== 0)) {
      this.silentSinceMs = null
      if (!this.suspected) return null
      this.suspected = false
      return 'recovered'
    }
    this.silentSinceMs ??= atMs
    if (this.suspected || atMs - this.silentSinceMs < this.windowMs) return null
    this.suspected = true
    return 'suspected'
  }
}
