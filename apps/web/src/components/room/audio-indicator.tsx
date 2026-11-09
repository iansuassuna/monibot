'use client'

import { type TrackReference, useMultibandTrackVolume } from '@livekit/components-react'
import type { AgentState } from '@monibot/types'
import { cn } from '@/lib/utils'

interface AudioIndicatorProps {
  state: AgentState
  audioTrack: TrackReference | undefined
}

/** Audio-only condition: a minimal level meter with no face or character. */
export function AudioIndicator({ state, audioTrack }: AudioIndicatorProps) {
  const bands = useMultibandTrackVolume(audioTrack, { bands: 5, loPass: 100, hiPass: 200 })

  return (
    <div className="flex h-24 items-center gap-1.5" aria-hidden>
      {bands.map((level, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length band list
          key={index}
          className={cn(
            'w-2.5 rounded-full transition-[height] duration-75',
            state === 'speaking'
              ? 'bg-primary'
              : state === 'listening'
                ? 'bg-success'
                : 'bg-muted-foreground/40'
          )}
          style={{ height: `${12 + Math.min(level, 1) * 72}px` }}
        />
      ))}
    </div>
  )
}
