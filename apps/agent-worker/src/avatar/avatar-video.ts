import {
  LocalVideoTrack,
  type Room,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoFrame,
  VideoSource,
} from '@livekit/rtc-node'
import { createLogger } from '@monibot/logger'
import type { AgentState } from '@monibot/types'
import { createFaceRenderer } from './face-renderer'
import type { MouthEnvelope } from './mouth-envelope'

const logger = createLogger('AvatarVideo')

const FRAME_SIZE = 480
const FRAMES_PER_SECOND = 15
const STATS_EVERY_FRAMES = FRAMES_PER_SECOND * 30

interface AvatarVideoOptions {
  sessionId: string
  state: () => AgentState
  mouth: MouthEnvelope
}

/**
 * Publishes MoniBot's face as a camera track, so Element Call shows the avatar in the agent's own
 * tile (encrypted with the call key like the audio). Logs render-time percentiles, the cost the
 * avatar adds next to the voice pipeline.
 *
 * @returns stop function, to run at job shutdown.
 */
export async function publishAvatarVideo(
  room: Room,
  { sessionId, state, mouth }: AvatarVideoOptions
): Promise<() => Promise<void>> {
  const participant = room.localParticipant
  if (!participant) throw new Error('Agent is not connected to the room')
  const source = new VideoSource(FRAME_SIZE, FRAME_SIZE)
  const track = LocalVideoTrack.createVideoTrack('monibot-avatar', source)
  await participant.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA })
  )
  const renderer = createFaceRenderer(FRAME_SIZE)
  const renderMs: number[] = []
  const tickGapMs: number[] = []
  let lastTick = performance.now()

  const timer = setInterval(() => {
    const start = performance.now()
    tickGapMs.push(start - lastTick)
    lastTick = start
    const rgba = renderer.render(state(), mouth.levelAt(Date.now()))
    source.captureFrame(new VideoFrame(rgba, FRAME_SIZE, FRAME_SIZE, VideoBufferType.RGBA))
    renderMs.push(performance.now() - start)
    if (renderMs.length >= STATS_EVERY_FRAMES) {
      logger.info('Avatar render stats', {
        sessionId,
        frames: renderMs.length,
        renderMs: percentiles(renderMs),
        tickGapMs: percentiles(tickGapMs),
      })
      renderMs.length = 0
      tickGapMs.length = 0
    }
  }, 1000 / FRAMES_PER_SECOND)

  logger.info('Avatar video published', { sessionId, size: FRAME_SIZE, fps: FRAMES_PER_SECOND })
  return async () => {
    clearInterval(timer)
    await source.close()
  }
}

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(at(1)) }
}

const round = (ms: number) => Math.round(ms * 100) / 100
