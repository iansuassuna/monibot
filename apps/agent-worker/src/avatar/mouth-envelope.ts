/** Resolution of the mouth animation; one bin per 20 ms of synthesized speech. */
export const ENVELOPE_BIN_MS = 20

/** RMS (fraction of full scale) below which the mouth stays closed: breaths, room tone. */
const SILENCE_RMS = 0.01
/** RMS that opens the mouth fully; Piper speech sits around 0.05–0.2. */
const FULL_OPEN_RMS = 0.2

/**
 * Loudness of the agent's current reply, recorded as the TTS synthesizes it and replayed on the
 * playback clock. Synthesis runs ahead of real time, so the level at a moment comes from the
 * audio that is actually being heard then, counted from the start of playback.
 */
export class MouthEnvelope {
  #bins: number[] = []
  #binSquares = 0
  #binSamples = 0
  #playbackStartMs: number | null = null

  /** Starts recording a new reply, discarding the previous one. */
  beginSpeech(): void {
    this.#bins = []
    this.#binSquares = 0
    this.#binSamples = 0
    this.#playbackStartMs = null
  }

  /** Records synthesized PCM (interleaved when `channels > 1`). */
  append(samples: Int16Array, sampleRate: number, channels: number): void {
    const samplesPerBin = (sampleRate * ENVELOPE_BIN_MS) / 1000
    for (let i = 0; i + channels <= samples.length; i += channels) {
      let mono = 0
      for (let c = 0; c < channels; c++) mono += samples[i + c] ?? 0
      mono /= channels * 32768
      this.#binSquares += mono * mono
      this.#binSamples++
      if (this.#binSamples >= samplesPerBin) {
        this.#bins.push(levelOf(Math.sqrt(this.#binSquares / this.#binSamples)))
        this.#binSquares = 0
        this.#binSamples = 0
      }
    }
  }

  /** Marks the moment the reply starts being heard. */
  startPlayback(nowMs: number): void {
    this.#playbackStartMs = nowMs
  }

  /** Closes the mouth (the reply ended or was interrupted). */
  stop(): void {
    this.#playbackStartMs = null
  }

  /** Mouth opening in [0, 1] at `nowMs`. */
  levelAt(nowMs: number): number {
    if (this.#playbackStartMs === null) return 0
    const bin = Math.floor((nowMs - this.#playbackStartMs) / ENVELOPE_BIN_MS)
    return this.#bins[bin] ?? 0
  }
}

function levelOf(rms: number): number {
  return rms < SILENCE_RMS ? 0 : Math.min(1, rms / FULL_OPEN_RMS)
}
