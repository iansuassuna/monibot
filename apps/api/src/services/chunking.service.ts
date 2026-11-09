import type { ChunkMetadata } from '@monibot/types'

export interface DocumentChunk {
  content: string
  metadata: ChunkMetadata
}

export interface ChunkOptions {
  /** Upper bound for prose chunks. Fenced code blocks are never split and may exceed it. */
  maxChars?: number
}

interface Block {
  kind: 'prose' | 'code'
  text: string
  section: string | undefined
  language?: string
}

const DEFAULT_MAX_CHARS = 1200
const FENCE_OPEN = /^```\s*([\w+#.-]*)/
const FENCE_CLOSE = /^```\s*$/
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')
  let section: string | undefined
  let prose: string[] = []

  const flushProse = () => {
    for (const paragraph of prose.join('\n').split(/\n\s*\n/)) {
      const trimmed = paragraph.trim()
      if (trimmed) blocks.push({ kind: 'prose', text: trimmed, section })
    }
    prose = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = FENCE_OPEN.exec(line)
    if (fence) {
      flushProse()
      const codeLines = [line]
      i++
      while (i < lines.length) {
        const codeLine = lines[i] ?? ''
        codeLines.push(codeLine)
        if (FENCE_CLOSE.test(codeLine)) break
        i++
      }
      blocks.push({
        kind: 'code',
        text: codeLines.join('\n').trimEnd(),
        section,
        language: fence[1] || undefined,
      })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushProse()
      section = heading[1]
    }
    prose.push(line)
    if (heading) flushProse()
  }
  flushProse()
  return blocks
}

function splitOversized(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = []
  for (const sentence of paragraph.split(SENTENCE_BOUNDARY)) {
    for (let start = 0; start < sentence.length; start += maxChars) {
      pieces.push(sentence.slice(start, start + maxChars))
    }
  }
  return pieces
}

/**
 * Splits course material into retrieval chunks: paragraphs are packed up to `maxChars`,
 * oversized paragraphs fall back to sentence then hard splits, fenced code blocks stay whole,
 * and each chunk carries the nearest preceding markdown heading as its section.
 */
export function chunkDocument(rawText: string, options: ChunkOptions = {}): DocumentChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new RangeError('maxChars must be a positive integer')
  }

  const chunks: DocumentChunk[] = []
  let buffer = ''
  let bufferSection: string | undefined

  const flush = () => {
    if (buffer) {
      chunks.push({ content: buffer, metadata: bufferSection ? { section: bufferSection } : {} })
    }
    buffer = ''
  }

  const push = (text: string, joiner: string, section: string | undefined) => {
    if (buffer && section !== bufferSection) flush()
    if (!buffer) {
      buffer = text
      bufferSection = section
    } else if (buffer.length + joiner.length + text.length <= maxChars) {
      buffer += joiner + text
    } else {
      flush()
      buffer = text
      bufferSection = section
    }
  }

  for (const block of parseBlocks(rawText.replace(/\r\n?/g, '\n'))) {
    if (block.kind === 'code') {
      flush()
      chunks.push({
        content: block.text,
        metadata: {
          isCode: true,
          ...(block.language ? { language: block.language } : {}),
          ...(block.section ? { section: block.section } : {}),
        },
      })
    } else if (block.text.length > maxChars) {
      flush()
      for (const piece of splitOversized(block.text, maxChars)) push(piece, ' ', block.section)
      flush()
    } else {
      push(block.text, '\n\n', block.section)
    }
  }
  flush()
  return chunks
}
