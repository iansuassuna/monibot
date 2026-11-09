import { ApiError } from '@/lib/rpc'

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Sua sessão expirou. Entre novamente.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  NOT_FOUND: 'Não encontrado.',
  CONFLICT: 'Esta ação já foi realizada.',
  UPSTREAM_UNAVAILABLE: 'Um serviço do MoniBot está indisponível no momento. Tente novamente.',
  VALIDATION_ERROR: 'Verifique os dados informados.',
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.message
  return 'Algo deu errado. Tente novamente.'
}
