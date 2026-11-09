'use client'

import { LIKERT_MAX, LIKERT_MIN } from '@monibot/types'
import { LIKERT_LABELS } from '@/lib/questionnaires'
import { cn } from '@/lib/utils'

interface LikertScaleProps {
  name: string
  statement: string
  number?: number
  value: number | undefined
  onChange: (value: number) => void
  invalid?: boolean
}

const POINTS = Array.from({ length: LIKERT_MAX - LIKERT_MIN + 1 }, (_, index) => LIKERT_MIN + index)

export function LikertScale({
  name,
  statement,
  number,
  value,
  onChange,
  invalid,
}: LikertScaleProps) {
  return (
    <fieldset
      className={cn('flex flex-col gap-3 rounded-lg border p-4', invalid && 'border-destructive')}
    >
      <legend className="sr-only">{statement}</legend>
      <p className="text-sm" aria-hidden>
        {number !== undefined && <span className="mr-1 font-semibold tabular-nums">{number}.</span>}
        {statement}
      </p>
      <div className="grid grid-cols-5 gap-1.5">
        {POINTS.map((point) => (
          <label
            key={point}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-md border px-1 py-2 text-center transition-colors hover:bg-accent has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
              value === point &&
                'border-primary bg-primary text-primary-foreground hover:bg-primary'
            )}
          >
            <input
              type="radio"
              name={name}
              value={point}
              checked={value === point}
              onChange={() => onChange(point)}
              className="sr-only"
            />
            <span className="font-semibold tabular-nums">{point}</span>
            <span className="hidden text-[0.65rem] leading-tight sm:block">
              {LIKERT_LABELS[point - 1]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
