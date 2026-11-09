'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartTooltip } from './chart-tooltip'
import type { ConditionSeries } from './conditions'

interface GroupedBarChartProps {
  data: Record<string, string | number | null>[]
  categoryKey: string
  series: readonly ConditionSeries[]
  format: (value: number) => string
  /** Tick labels omit the unit; the axis label carries it. */
  axisFormat?: (value: number) => string
  yDomain?: [number, number]
  yLabel: string
  height?: number
}

/** One y-axis; each experimental condition is one series in its fixed color. */
export function GroupedBarChart({
  data,
  categoryKey,
  series,
  format,
  axisFormat = format,
  yDomain,
  yLabel,
  height = 300,
}: GroupedBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        barGap={2}
        barCategoryGap="22%"
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey={categoryKey}
          tickLine={false}
          axisLine={{ stroke: 'var(--border)' }}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
        />
        <YAxis
          domain={yDomain}
          tickLine={false}
          axisLine={false}
          width={60}
          tickFormatter={axisFormat}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          label={{
            value: yLabel,
            angle: -90,
            position: 'insideLeft',
            fill: 'var(--muted-foreground)',
            fontSize: 11,
            dx: -4,
          }}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          content={({ active, label, payload }) => (
            <ChartTooltip active={active} label={label} payload={payload} format={format} />
          )}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          formatter={(value) => <span className="text-muted-foreground">{value}</span>}
        />
        {series.map((condition) => (
          <Bar
            key={condition.key}
            dataKey={condition.key}
            name={condition.label}
            fill={condition.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
