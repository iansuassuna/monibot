import type { Metadata } from 'next'
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard'

export const metadata: Metadata = { title: 'Métricas' }

export default function AnalyticsPage() {
  return (
    <>
      <div>
        <h1 className="font-semibold text-2xl">Painel científico</h1>
        <p className="text-muted-foreground">
          Latência do pipeline de voz e escores SUS/TAM nos quatro grupos do desenho RAG × Avatar.
        </p>
      </div>
      <AnalyticsDashboard />
    </>
  )
}
