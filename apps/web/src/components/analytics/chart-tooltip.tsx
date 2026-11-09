'use client'

interface TooltipEntry {
  name?: string | number
  value?: unknown
  color?: string
  dataKey?: unknown
}

interface ChartTooltipProps {
  active?: boolean
  label?: string | number
  payload?: readonly TooltipEntry[]
  format: (value: number) => string
}

/** Values and names stay in text ink; the swatch alone carries series identity. */
export function ChartTooltip({ active, label, payload, format }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <ul className="flex flex-col gap-0.5">
        {payload.map((entry) => (
          <li
            key={String(entry.name ?? entry.dataKey)}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span>{entry.name}</span>
            <span className="ml-auto pl-3 font-medium text-foreground tabular-nums">
              {typeof entry.value === 'number' ? format(entry.value) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
