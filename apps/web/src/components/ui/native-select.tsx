import type * as React from 'react'
import { cn } from '@/lib/utils'

function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&>option]:bg-card',
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
