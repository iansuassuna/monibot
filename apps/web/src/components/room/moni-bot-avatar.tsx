'use client'

import { type TrackReference, useTrackVolume } from '@livekit/components-react'
import type { AgentState } from '@monibot/types'
import { cn } from '@/lib/utils'

const STATE_COLOR: Record<AgentState, string> = {
  idle: 'text-muted-foreground',
  listening: 'text-success',
  searching_rag: 'text-warning',
  thinking: 'text-primary',
  speaking: 'text-primary',
}

interface MoniBotAvatarProps {
  state: AgentState
  audioTrack: TrackReference | undefined
}

/** Visual-presence condition: a face whose mouth and halo follow the agent's voice volume. */
export function MoniBotAvatar({ state, audioTrack }: MoniBotAvatarProps) {
  const volume = useTrackVolume(audioTrack)
  const speakingLevel = state === 'speaking' ? Math.min(volume * 2.5, 1) : 0
  const mouthOpen = 2 + speakingLevel * 16

  return (
    <div
      className={cn(
        'relative flex size-64 items-center justify-center sm:size-72',
        STATE_COLOR[state]
      )}
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-4 rounded-full bg-current opacity-10 transition-transform duration-75',
          state === 'listening' && 'animate-pulse'
        )}
        style={{ transform: `scale(${1 + speakingLevel * 0.18})` }}
      />
      {state === 'searching_rag' && (
        <div
          aria-hidden
          className="absolute inset-1 animate-spin rounded-full border-4 border-current border-dashed opacity-60 [animation-duration:3s]"
        />
      )}
      <svg
        viewBox="0 0 200 200"
        className="relative size-48 sm:size-56"
        role="img"
        aria-label="Avatar do MoniBot"
      >
        <title>Avatar do MoniBot</title>
        <rect
          x="40"
          y="46"
          width="120"
          height="112"
          rx="44"
          className="fill-card stroke-current"
          strokeWidth="5"
        />
        <line
          x1="100"
          y1="46"
          x2="100"
          y2="26"
          className="stroke-current"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="100" cy="22" r="7" className="fill-current" />
        <ellipse className="monibot-eye fill-current" cx="78" cy="94" rx="9" ry="11" />
        <ellipse className="monibot-eye fill-current" cx="122" cy="94" rx="9" ry="11" />
        <ellipse cx="100" cy="128" rx="20" ry={mouthOpen} className="fill-current opacity-80" />
        {state === 'thinking' &&
          [0, 1, 2].map((dot) => (
            <circle
              key={dot}
              className="monibot-dot fill-current"
              style={{ animationDelay: `${dot * 0.15}s` }}
              cx={150 + dot * 12}
              cy="40"
              r="4"
            />
          ))}
      </svg>
    </div>
  )
}
