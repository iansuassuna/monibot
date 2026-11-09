import type { ReactNode } from 'react'
import { requireResearcherSession } from '@/lib/server-session'

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireResearcherSession('/dashboard')
  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">{children}</main>
}
