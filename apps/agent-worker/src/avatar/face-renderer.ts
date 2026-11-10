import type { AgentState } from '@monibot/types'

type Rgb = readonly [number, number, number]

const BACKGROUND: Rgb = [24, 22, 43]
const EYE: Rgb = [245, 245, 250]
const MOUTH: Rgb = [30, 16, 48]
/** Face colour per state, so the student sees whether MoniBot is listening or thinking. */
const FACE: Record<AgentState, Rgb> = {
  idle: [124, 110, 170],
  listening: [72, 170, 120],
  searching_rag: [214, 158, 60],
  thinking: [92, 120, 210],
  speaking: [140, 96, 220],
}

export interface FaceRenderer {
  /** Renders one RGBA frame into a reused buffer (valid until the next call). */
  render(state: AgentState, mouthLevel: number): Uint8Array
}

/**
 * Software renderer of MoniBot's face for the avatar video track: no native dependencies, one
 * precomputed frame per state, and only the mouth drawn per frame.
 */
export function createFaceRenderer(size: number): FaceRenderer {
  const baseFrames = new Map<AgentState, Uint8Array>()
  const frame = new Uint8Array(size * size * 4)
  const center = size / 2

  const baseFor = (state: AgentState) => {
    const cached = baseFrames.get(state)
    if (cached) return cached
    const base = new Uint8Array(size * size * 4)
    fillRect(base, size, BACKGROUND)
    fillEllipse(base, size, center, center, size * 0.38, size * 0.38, FACE[state])
    fillEllipse(
      base,
      size,
      center - size * 0.12,
      center - size * 0.08,
      size * 0.05,
      size * 0.06,
      EYE
    )
    fillEllipse(
      base,
      size,
      center + size * 0.12,
      center - size * 0.08,
      size * 0.05,
      size * 0.06,
      EYE
    )
    baseFrames.set(state, base)
    return base
  }

  return {
    render(state, mouthLevel) {
      frame.set(baseFor(state))
      const level = Math.min(1, Math.max(0, mouthLevel))
      const halfHeight = size * (0.012 + level * 0.09)
      fillEllipse(frame, size, center, center + size * 0.16, size * 0.13, halfHeight, MOUTH)
      return frame
    },
  }
}

function fillRect(buffer: Uint8Array, size: number, [r, g, b]: Rgb) {
  for (let i = 0; i < size * size * 4; i += 4) {
    buffer[i] = r
    buffer[i + 1] = g
    buffer[i + 2] = b
    buffer[i + 3] = 255
  }
}

function fillEllipse(
  buffer: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  [r, g, b]: Rgb
) {
  const top = Math.max(0, Math.floor(cy - ry))
  const bottom = Math.min(size - 1, Math.ceil(cy + ry))
  for (let y = top; y <= bottom; y++) {
    const dy = (y + 0.5 - cy) / ry
    const span = dy * dy <= 1 ? rx * Math.sqrt(1 - dy * dy) : -1
    if (span < 0) continue
    const left = Math.max(0, Math.round(cx - span))
    const right = Math.min(size - 1, Math.round(cx + span))
    for (let x = left; x <= right; x++) {
      const i = (y * size + x) * 4
      buffer[i] = r
      buffer[i + 1] = g
      buffer[i + 2] = b
      buffer[i + 3] = 255
    }
  }
}
