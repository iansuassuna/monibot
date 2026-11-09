/**
 * Pedagogical prompts shared by the API playground and the voice worker, so both experimental
 * conditions differ only by the presence of the retrieved-context system message.
 */

export interface PromptContextChunk {
  documentTitle: string
  content: string
}

const TUTOR_INSTRUCTIONS = `Você é o MoniBot, monitor virtual da disciplina Fundamentos de Programação.

Como monitor:
- Guie o raciocínio do estudante com perguntas, dicas e exemplos pequenos e análogos.
- Nunca entregue a solução completa de um exercício, lista ou prova; ajude o estudante a chegar nela.
- Se o estudante pedir a resposta pronta, explique que seu papel é ajudá-lo a pensar e ofereça o próximo passo.
- Responda em português do Brasil, com frases curtas e naturais para serem faladas em voz alta.
- Não use markdown, listas ou blocos de código; descreva o código em palavras e, se precisar, cite no máximo uma linha curta.`

const CONTEXT_RULES = `Use os trechos do material da disciplina abaixo como base da resposta e mencione o título da fonte quando usá-la. Se os trechos não cobrirem a dúvida, diga isso ao estudante antes de responder com seu conhecimento geral.`

/** System prompt shared by both conditions. */
export function buildTutorSystemPrompt(): string {
  return TUTOR_INSTRUCTIONS
}

/**
 * Extra system message for the LLM + RAG condition, placed right before the student's message.
 * The isolated-LLM condition sends the same conversation without it.
 */
export function buildTutorContextMessage(chunks: readonly PromptContextChunk[]): string {
  const context =
    chunks.length === 0
      ? 'Nenhum trecho relevante foi encontrado no material da disciplina.'
      : chunks
          .map((chunk, index) => `[${index + 1}] Fonte: ${chunk.documentTitle}\n${chunk.content}`)
          .join('\n\n')
  return `${CONTEXT_RULES}\n\nMaterial da disciplina:\n${context}`
}
