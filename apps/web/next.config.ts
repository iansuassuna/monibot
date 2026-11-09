import type { NextConfig } from 'next'

const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@monibot/types', '@monibot/auth', '@monibot/logger'],
  experimental: {
    // The rewrite proxy cuts requests at 30 s by default; the RAG playground runs two sequential
    // Ollama generations. Matches the API's Bun `idleTimeout` ceiling (255 s).
    proxyTimeout: 255_000,
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }]
  },
}

export default nextConfig
