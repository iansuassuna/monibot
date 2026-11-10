import { describe, expect, test } from 'bun:test'
import { RecentIds } from './recent-ids'

describe('RecentIds', () => {
  test('reports an id as new only the first time', () => {
    const seen = new RecentIds(10)
    expect(seen.markSeen('$event-a')).toBe(true)
    expect(seen.markSeen('$event-a')).toBe(false)
    expect(seen.markSeen('$event-b')).toBe(true)
  })

  test('stays bounded by forgetting the oldest ids first', () => {
    const seen = new RecentIds(2)
    seen.markSeen('$1')
    seen.markSeen('$2')
    seen.markSeen('$3')
    expect(seen.markSeen('$1')).toBe(true)
    expect(seen.markSeen('$3')).toBe(false)
  })
})
