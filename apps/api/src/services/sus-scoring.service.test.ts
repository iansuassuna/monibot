import { describe, expect, test } from 'bun:test'
import { calculateSusScore, meanLikert } from './sus-scoring.service'

describe('calculateSusScore', () => {
  test('neutral answers score 50', () => {
    expect(calculateSusScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50)
  })

  test('best possible answers (odd = 5, even = 1) score 100', () => {
    expect(calculateSusScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100)
  })

  test('worst possible answers (odd = 1, even = 5) score 0', () => {
    expect(calculateSusScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0)
  })

  test('applies odd/even polarity by questionnaire position, not by value', () => {
    expect(calculateSusScore([4, 2, 4, 2, 4, 2, 4, 2, 4, 2])).toBe(75)
    expect(calculateSusScore([5, 5, 5, 5, 5, 5, 5, 5, 5, 5])).toBe(50)
  })

  test('rejects a questionnaire that does not have exactly 10 answers', () => {
    expect(() => calculateSusScore([3, 3, 3])).toThrow()
    expect(() => calculateSusScore(Array.from({ length: 11 }, () => 3))).toThrow()
  })

  test('rejects answers outside the 1–5 Likert range or non-integers', () => {
    expect(() => calculateSusScore([0, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toThrow()
    expect(() => calculateSusScore([6, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toThrow()
    expect(() => calculateSusScore([3.5, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toThrow()
  })
})

describe('meanLikert', () => {
  test('averages answers', () => {
    expect(meanLikert([5, 4, 3])).toBe(4)
  })

  test('rejects an empty list instead of returning NaN', () => {
    expect(() => meanLikert([])).toThrow()
  })
})
