import { describe, expect, test } from 'bun:test'
import { chunkDocument } from './chunking.service'

const paragraph = (words: number, seed = 'palavra') =>
  Array.from({ length: words }, (_, i) => `${seed}${i}`).join(' ')

describe('chunkDocument', () => {
  test('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkDocument('')).toEqual([])
    expect(chunkDocument('  \n\n\t \r\n')).toEqual([])
  })

  test('keeps a short document as a single chunk', () => {
    const chunks = chunkDocument('Uma variável guarda um valor.')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.content).toBe('Uma variável guarda um valor.')
  })

  test('never splits inside a fenced code block, even when it exceeds maxChars', () => {
    const body = Array.from({ length: 80 }, (_, i) => `    print(${i})`).join('\n')
    const code = `\`\`\`python\nfor i in range(10):\n${body}\n\`\`\``
    const chunks = chunkDocument(`Introdução ao laço.\n\n${code}\n\nConclusão.`, { maxChars: 300 })
    const codeChunks = chunks.filter((chunk) => chunk.content.includes('```'))
    expect(codeChunks).toHaveLength(1)
    expect(codeChunks[0]?.content).toBe(code)
    expect(codeChunks[0]?.metadata).toMatchObject({ isCode: true, language: 'python' })
  })

  test('treats an unterminated fence as code running to the end of the document', () => {
    const chunks = chunkDocument('Texto.\n\n```c\nint main() {\n  return 0;\n}', { maxChars: 1000 })
    const code = chunks.find((chunk) => chunk.metadata.isCode)
    expect(code?.content).toContain('return 0;')
    expect(code?.metadata.language).toBe('c')
  })

  test('packs consecutive paragraphs up to maxChars and never exceeds it for prose', () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(20, `p${i}w`)).join('\n\n')
    const chunks = chunkDocument(text, { maxChars: 400 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.content.length).toBeLessThanOrEqual(400)
    expect(
      chunks
        .map((chunk) => chunk.content)
        .join(' ')
        .replace(/\s+/g, ' ')
    ).toBe(text.replace(/\s+/g, ' '))
  })

  test('splits an oversized paragraph at sentence boundaries', () => {
    const sentences = Array.from({ length: 10 }, (_, i) => `Esta é a frase número ${i} do texto.`)
    const chunks = chunkDocument(sentences.join(' '), { maxChars: 90 })
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(90)
      expect(chunk.content.endsWith('.')).toBe(true)
    }
  })

  test('hard-splits a single sentence longer than maxChars', () => {
    const chunks = chunkDocument('a'.repeat(250), { maxChars: 100 })
    expect(chunks.map((chunk) => chunk.content.length)).toEqual([100, 100, 50])
  })

  test('records the nearest preceding markdown heading as the section', () => {
    const text = '# Laços\n\nO for repete.\n\n## While\n\nO while repete enquanto a condição vale.'
    const chunks = chunkDocument(text, { maxChars: 30 })
    expect(chunks.find((c) => c.content.includes('O for'))?.metadata.section).toBe('Laços')
    expect(chunks.find((c) => c.content.includes('O while'))?.metadata.section).toBe('While')
  })

  test('normalizes CRLF line endings', () => {
    const chunks = chunkDocument('Linha um.\r\n\r\nLinha dois.')
    expect(chunks[0]?.content).toBe('Linha um.\n\nLinha dois.')
  })

  test('rejects a non-positive maxChars', () => {
    expect(() => chunkDocument('texto', { maxChars: 0 })).toThrow()
  })
})
