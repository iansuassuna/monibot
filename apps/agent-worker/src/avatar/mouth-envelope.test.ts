import { describe, expect, test } from 'bun:test'
import { ENVELOPE_BIN_MS, MouthEnvelope } from './mouth-envelope'

const RATE = 24_000
const samplesFor = (ms: number) => (RATE * ms) / 1000

/** Mono PCM at a constant amplitude (fraction of full scale), as a square wave of that RMS. */
function tone(ms: number, amplitude: number): Int16Array {
  const out = new Int16Array(samplesFor(ms))
  for (let i = 0; i < out.length; i++) out[i] = (i % 2 === 0 ? 1 : -1) * amplitude * 32767
  return out
}

function speech(...parts: [ms: number, amplitude: number][]) {
  const envelope = new MouthEnvelope()
  envelope.beginSpeech()
  for (const [ms, amplitude] of parts) envelope.append(tone(ms, amplitude), RATE, 1)
  return envelope
}

describe('MouthEnvelope', () => {
  test('keeps the mouth closed until playback starts, even with synthesized audio buffered', () => {
    expect(speech([200, 0.15]).levelAt(1000)).toBe(0)
  })

  test('follows the audio on the playback clock, not on the (faster) synthesis clock', () => {
    const envelope = speech([100, 0], [100, 0.15])
    envelope.startPlayback(1000)
    expect(envelope.levelAt(1050)).toBe(0)
    expect(envelope.levelAt(1150)).toBeGreaterThan(0.5)
  })

  test('closes the mouth once the synthesized audio has played out', () => {
    const envelope = speech([100, 0.15])
    envelope.startPlayback(1000)
    expect(envelope.levelAt(1000 + 100 + ENVELOPE_BIN_MS)).toBe(0)
  })

  test('closes the mouth at once when the agent is interrupted', () => {
    const envelope = speech([1000, 0.15])
    envelope.startPlayback(1000)
    envelope.stop()
    expect(envelope.levelAt(1200)).toBe(0)
  })

  test('maps silence to 0, typical speech to an open mouth, and caps loud audio at 1', () => {
    const quiet = speech([100, 0])
    const typical = speech([100, 0.1])
    const loud = speech([100, 0.9])
    for (const e of [quiet, typical, loud]) e.startPlayback(0)
    expect(quiet.levelAt(10)).toBe(0)
    expect(typical.levelAt(10)).toBeGreaterThan(0.4)
    expect(typical.levelAt(10)).toBeLessThan(1)
    expect(loud.levelAt(10)).toBe(1)
  })

  test('a new reply discards the previous one', () => {
    const envelope = speech([500, 0.15])
    envelope.beginSpeech()
    envelope.append(tone(100, 0), RATE, 1)
    envelope.startPlayback(0)
    expect(envelope.levelAt(300)).toBe(0)
  })

  test('averages interleaved stereo instead of misreading it as twice the duration', () => {
    const stereo = new Int16Array(samplesFor(100) * 2).fill(0.15 * 32767)
    const envelope = new MouthEnvelope()
    envelope.beginSpeech()
    envelope.append(stereo, RATE, 2)
    envelope.startPlayback(0)
    expect(envelope.levelAt(150)).toBe(0)
  })
})
