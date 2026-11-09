/**
 * @monibot/logger
 *
 * Structured, isomorphic logger for Bun, Next.js (server and browser), and the agent worker.
 * Emits one JSON object per line in production and a colorized single line in development.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

/** Structured fields attached to a log line. Values must be JSON-serializable. */
export type LogContext = Record<string, unknown>

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
  /** Returns a logger that adds `context` to every line it emits. */
  child(context: LogContext): Logger
}

export interface LoggerOptions {
  level?: LogLevel
  format?: 'json' | 'pretty'
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const ANSI: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}
const ANSI_RESET = '\x1b[0m'
const ANSI_DIM = '\x1b[2m'

function readEnv(name: string): string | undefined {
  const runtime = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return runtime?.env?.[name]
}

function isBrowser(): boolean {
  const runtime = (globalThis as { process?: { versions?: { node?: unknown; bun?: unknown } } })
    .process
  return (
    typeof (globalThis as { window?: unknown }).window !== 'undefined' &&
    typeof runtime?.versions?.node !== 'string' &&
    typeof runtime?.versions?.bun !== 'string'
  )
}

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && (LOG_LEVELS as readonly string[]).includes(value)
}

function resolveLevel(): LogLevel {
  const fromEnv = readEnv('LOG_LEVEL')?.toLowerCase()
  if (isLogLevel(fromEnv)) return fromEnv
  const nodeEnv = readEnv('NODE_ENV')
  if (nodeEnv === 'test') return 'error'
  if (nodeEnv === 'production') return 'info'
  return 'debug'
}

function resolveFormat(): 'json' | 'pretty' {
  return readEnv('NODE_ENV') === 'production' ? 'json' : 'pretty'
}

/** `Error` fields are non-enumerable, so `JSON.stringify` would otherwise emit `{}`. */
function serializeError(error: Error): LogContext {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    ...(error.cause !== undefined ? { cause: normalizeValue(error.cause) } : {}),
  }
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) return serializeError(value)
  return value
}

function normalizeContext(context: LogContext): LogContext {
  const normalized: LogContext = {}
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) normalized[key] = normalizeValue(value)
  }
  return normalized
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === 'bigint') return current.toString()
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) return '[Circular]'
      seen.add(current)
    }
    return current
  })
}

function write(level: LogLevel, line: string): void {
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function emit(
  level: LogLevel,
  module: string,
  message: string,
  context: LogContext,
  format: 'json' | 'pretty'
): void {
  const timestamp = new Date().toISOString()
  const fields = normalizeContext(context)

  if (isBrowser()) {
    const method = level === 'debug' ? 'debug' : level
    console[method](`[${module}] ${message}`, fields)
    return
  }

  if (format === 'json') {
    write(level, safeStringify({ timestamp, level, module, message, ...fields }))
    return
  }

  const hasFields = Object.keys(fields).length > 0
  const suffix = hasFields ? ` ${ANSI_DIM}${safeStringify(fields)}${ANSI_RESET}` : ''
  write(
    level,
    `${ANSI_DIM}${timestamp}${ANSI_RESET} ${ANSI[level]}${level.toUpperCase().padEnd(5)}${ANSI_RESET} [${module}] ${message}${suffix}`
  )
}

function buildLogger(module: string, baseContext: LogContext, options: LoggerOptions): Logger {
  const minLevel = options.level ?? resolveLevel()
  const format = options.format ?? resolveFormat()

  const log = (level: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return
    emit(level, module, message, { ...baseContext, ...context }, format)
  }

  return {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context) => log('error', message, context),
    child: (context) => buildLogger(module, { ...baseContext, ...context }, options),
  }
}

/**
 * Creates a logger scoped to a module name, e.g. `createLogger('RagService')`.
 *
 * Level comes from `LOG_LEVEL` (default: `debug` in development, `info` in production,
 * `error` in tests); format is JSON when `NODE_ENV=production`.
 */
export function createLogger(module: string, options: LoggerOptions = {}): Logger {
  return buildLogger(module, {}, options)
}
