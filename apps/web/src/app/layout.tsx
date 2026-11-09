import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SiteHeader } from '@/components/layout/site-header'
import { QueryProvider } from '@/providers/query-provider'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'MoniBot', template: '%s · MoniBot' },
  description: 'Monitor virtual inteligente para Fundamentos de Programação',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        <QueryProvider>
          <SiteHeader />
          {children}
        </QueryProvider>
      </body>
    </html>
  )
}
