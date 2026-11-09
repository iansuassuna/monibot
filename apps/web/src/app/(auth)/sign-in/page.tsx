import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/auth-form'

export const metadata: Metadata = { title: 'Entrar' }

export default function SignInPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-in" />
    </Suspense>
  )
}
