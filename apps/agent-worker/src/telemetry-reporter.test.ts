import { describe, expect, test } from 'bun:test'
import type { InteractionLogCreate } from '@monibot/types'
import { TelemetryRejectedError, TelemetryReporter } from './telemetry-reporter'

const log = (n: number): InteractionLogCreate => ({
  sessionId: '0b9f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4',
  studentTranscript: `pergunta ${n}`,
  agentResponse: 'resposta',
  retrievedChunks: [],
  sttLatencyMs: 1,
  ragLatencyMs: 0,
  llmTtftMs: 1,
  llmTotalLatencyMs: 1,
  ttsLatencyMs: 1,
  totalE2eLatencyMs: 1,
})

const noDelay = [0, 0] as const

describe('TelemetryReporter', () => {
  test('sends turns in order', async () => {
    const sent: string[] = []
    const reporter = new TelemetryReporter(async (l) => void sent.push(l.studentTranscript), {
      retryDelaysMs: noDelay,
    })
    reporter.report(log(1))
    reporter.report(log(2))
    await reporter.flush()
    expect(sent).toEqual(['pergunta 1', 'pergunta 2'])
    expect(reporter.pending).toBe(0)
  })

  test('drops a turn the API permanently rejects so it never blocks the turns behind it', async () => {
    const sent: string[] = []
    const dropped: string[] = []
    const reporter = new TelemetryReporter(
      async (l) => {
        if (l.studentTranscript === 'pergunta 1') throw new TelemetryRejectedError(400, 'invalid')
        sent.push(l.studentTranscript)
      },
      { retryDelaysMs: noDelay, onDropped: (l) => dropped.push(l.studentTranscript) }
    )
    reporter.report(log(1))
    reporter.report(log(2))
    await reporter.flush()
    expect(dropped).toEqual(['pergunta 1'])
    expect(sent).toEqual(['pergunta 2'])
    expect(reporter.pending).toBe(0)
  })

  test('keeps turns buffered after transient failures and delivers them on a later flush', async () => {
    let up = false
    const sent: string[] = []
    const reporter = new TelemetryReporter(
      async (l) => {
        if (!up) throw new Error('ECONNREFUSED')
        sent.push(l.studentTranscript)
      },
      { retryDelaysMs: noDelay }
    )
    reporter.report(log(1))
    await reporter.flush()
    expect(reporter.pending).toBe(1)
    up = true
    await reporter.flush()
    expect(sent).toEqual(['pergunta 1'])
    expect(reporter.pending).toBe(0)
  })

  test('concurrent flushes never send the same turn twice', async () => {
    const sent: string[] = []
    const reporter = new TelemetryReporter(
      async (l) => {
        await new Promise((r) => setTimeout(r, 5))
        sent.push(l.studentTranscript)
      },
      { retryDelaysMs: noDelay }
    )
    reporter.report(log(1))
    reporter.report(log(2))
    await Promise.all([reporter.flush(), reporter.flush()])
    expect(sent).toEqual(['pergunta 1', 'pergunta 2'])
  })
})
