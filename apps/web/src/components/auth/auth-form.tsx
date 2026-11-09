'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

interface AuthFormProps {
  mode: 'sign-in' | 'sign-up'
}

/** Only same-origin relative paths are honored, so `?next=` can't redirect off-site. */
function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()
  const next = safeNext(useSearchParams().get('next'))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    setPending(true)
    setError(null)
    const result =
      mode === 'sign-up'
        ? await authClient.signUp.email({ email, password, name: String(form.get('name') ?? '') })
        : await authClient.signIn.email({ email, password })
    setPending(false)
    if (result.error) {
      setError(
        mode === 'sign-up'
          ? 'Não foi possível criar a conta. Verifique os dados ou use outro e-mail.'
          : 'E-mail ou senha incorretos.'
      )
      return
    }
    router.replace(next)
    router.refresh()
  }

  const isSignUp = mode === 'sign-up'
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{isSignUp ? 'Criar conta' : 'Entrar no MoniBot'}</CardTitle>
        <CardDescription>Monitoria de Fundamentos de Programação</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {isSignUp && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" name="name" required autoComplete="name" />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" disabled={pending}>
            {pending ? 'Aguarde…' : isSignUp ? 'Criar conta' : 'Entrar'}
          </Button>
          <p className="text-center text-muted-foreground text-sm">
            {isSignUp ? 'Já tem conta? ' : 'Ainda não tem conta? '}
            <Link
              href={`${isSignUp ? '/sign-in' : '/sign-up'}?next=${encodeURIComponent(next)}`}
              className="text-primary hover:underline"
            >
              {isSignUp ? 'Entrar' : 'Criar conta'}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
