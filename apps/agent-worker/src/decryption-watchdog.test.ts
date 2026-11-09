import { describe, expect, test } from 'bun:test'
import { DecryptionWatchdog } from './decryption-watchdog'

const silent = () => new Int16Array(480)
/** A live microphone is never digitally silent: room noise stays a few units above zero. */
const roomNoise = () => Int16Array.from({ length: 480 }, (_, i) => (i % 7) - 3)

/** Feeds 10 ms frames from `startMs` to `endMs` and returns every non-null verdict. */
function feed(
  watchdog: DecryptionWatchdog,
  frame: () => Int16Array,
  startMs: number,
  endMs: number,
  muted = false
) {
  const verdicts: string[] = []
  for (let at = startMs; at < endMs; at += 10) {
    const verdict = watchdog.observe({ samples: frame(), atMs: at, muted })
    if (verdict) verdicts.push(verdict)
  }
  return verdicts
}

describe('DecryptionWatchdog', () => {
  test('suspects a decryption failure after an unmuted track stays digitally silent for the window', () => {
    const watchdog = new DecryptionWatchdog({ windowMs: 3000 })
    expect(feed(watchdog, silent, 0, 2900)).toEqual([])
    expect(feed(watchdog, silent, 2900, 3100)).toEqual(['suspected'])
  })

  test('does not suspect a working microphone in a quiet room', () => {
    const watchdog = new DecryptionWatchdog({ windowMs: 3000 })
    expect(feed(watchdog, roomNoise, 0, 10_000)).toEqual([])
  })

  test('any non-zero frame restarts the silent run', () => {
    const watchdog = new DecryptionWatchdog({ windowMs: 3000 })
    feed(watchdog, silent, 0, 2500)
    feed(watchdog, roomNoise, 2500, 2510)
    expect(feed(watchdog, silent, 2510, 5400)).toEqual([])
    expect(feed(watchdog, silent, 5400, 5600)).toEqual(['suspected'])
  })

  test('a muted track is silent on purpose and never counts', () => {
    const watchdog = new DecryptionWatchdog({ windowMs: 3000 })
    expect(feed(watchdog, silent, 0, 10_000, true)).toEqual([])
    expect(feed(watchdog, silent, 10_000, 12_900)).toEqual([])
  })

  test('reports once while the failure lasts, then reports recovery', () => {
    const watchdog = new DecryptionWatchdog({ windowMs: 3000 })
    expect(feed(watchdog, silent, 0, 20_000)).toEqual(['suspected'])
    expect(feed(watchdog, roomNoise, 20_000, 20_100)).toEqual(['recovered'])
  })
})
