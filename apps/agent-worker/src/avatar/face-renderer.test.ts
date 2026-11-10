import { describe, expect, test } from 'bun:test'
import { createFaceRenderer } from './face-renderer'

const SIZE = 64

function differingPixels(a: Uint8Array, b: Uint8Array) {
  let count = 0
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++
  }
  return count
}

describe('createFaceRenderer', () => {
  test('produces a full RGBA frame of the requested size (VideoFrame rejects anything else)', () => {
    expect(createFaceRenderer(SIZE).render('idle', 0).length).toBe(SIZE * SIZE * 4)
  })

  test('is fully opaque, so the call never shows through the tile', () => {
    const frame = createFaceRenderer(SIZE).render('speaking', 1)
    for (let i = 3; i < frame.length; i += 4) expect(frame[i]).toBe(255)
  })

  test('opens the mouth with the voice level', () => {
    const renderer = createFaceRenderer(SIZE)
    const closed = renderer.render('speaking', 0).slice()
    const open = renderer.render('speaking', 1).slice()
    expect(differingPixels(closed, open)).toBeGreaterThan(20)
  })

  test('shows the agent state (listening differs from thinking)', () => {
    const renderer = createFaceRenderer(SIZE)
    const listening = renderer.render('listening', 0).slice()
    const thinking = renderer.render('thinking', 0).slice()
    expect(differingPixels(listening, thinking)).toBeGreaterThan(20)
  })

  test('a closed mouth after an open one leaves no trace of the open mouth', () => {
    const renderer = createFaceRenderer(SIZE)
    const before = renderer.render('speaking', 0).slice()
    renderer.render('speaking', 1)
    expect(differingPixels(before, renderer.render('speaking', 0))).toBe(0)
  })
})
