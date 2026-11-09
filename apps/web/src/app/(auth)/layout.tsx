import type { ReactNode } from 'react'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] items-center justify-center p-4">
      {children}
    </main>
  )
}
