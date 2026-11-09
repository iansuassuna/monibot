import { Bot } from 'lucide-react'
import Link from 'next/link'
import { getServerSession } from '@/lib/server-session'
import { SignOutButton } from './sign-out-button'

const RESEARCHER_LINKS = [
  { href: '/dashboard/sessions', label: 'Sessões' },
  { href: '/dashboard/knowledge', label: 'Base de conhecimento' },
  { href: '/dashboard/analytics', label: 'Métricas' },
] as const

export async function SiteHeader() {
  const session = await getServerSession()
  const isResearcher = session?.user.role === 'researcher'

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Bot className="size-5 text-primary" aria-hidden />
          MoniBot
        </Link>
        {isResearcher && (
          <nav className="hidden items-center gap-4 text-sm text-muted-foreground md:flex">
            {RESEARCHER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm">
          {session ? (
            <>
              <span className="hidden text-muted-foreground sm:inline">{session.user.name}</span>
              <SignOutButton />
            </>
          ) : (
            <Link href="/sign-in" className="text-primary hover:underline">
              Entrar
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
