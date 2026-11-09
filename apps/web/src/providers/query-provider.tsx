'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { ApiError } from '@/lib/rpc'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) =>
              !(error instanceof ApiError && error.status < 500) && failureCount < 2,
          },
        },
      })
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
