import { LIKERT_MAX, LIKERT_MIN, SUS_ITEM_COUNT } from '@monibot/types'

function assertLikert(answers: readonly number[]): void {
  for (const answer of answers) {
    if (!Number.isInteger(answer) || answer < LIKERT_MIN || answer > LIKERT_MAX) {
      throw new RangeError(`Likert answers must be integers in ${LIKERT_MIN}..${LIKERT_MAX}`)
    }
  }
}

/**
 * Official SUS score: `((Σ odd items − 5) + (25 − Σ even items)) × 2.5`, where odd/even refer to
 * the 1-based questionnaire position. Result is in 0..100.
 */
export function calculateSusScore(answers: readonly number[]): number {
  if (answers.length !== SUS_ITEM_COUNT) {
    throw new RangeError(`SUS requires exactly ${SUS_ITEM_COUNT} answers`)
  }
  assertLikert(answers)
  let oddSum = 0
  let evenSum = 0
  answers.forEach((answer, index) => {
    if (index % 2 === 0) oddSum += answer
    else evenSum += answer
  })
  return (oddSum - 5 + (25 - evenSum)) * 2.5
}

/** Mean of a non-empty set of Likert answers (used for the TAM constructs). */
export function meanLikert(answers: readonly number[]): number {
  if (answers.length === 0) throw new RangeError('At least one Likert answer is required')
  assertLikert(answers)
  return answers.reduce((sum, answer) => sum + answer, 0) / answers.length
}
