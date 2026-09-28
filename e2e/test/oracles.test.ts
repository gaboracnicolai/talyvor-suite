import { describe, expect, it } from 'vitest'
import { expectedFigure, judgeVerdict, listPriceUSD, namesWord, parseFooter, statesNumber } from '../src/oracles.ts'

describe('parseFooter reads every line the Chat screen writes under an answer', () => {
  it('a priced answer, in LXC or dollars', () => {
    expect(parseFooter('≈ 0.00059 LXC · Claude Haiku 4.5 · 14 in / 9 out tokens')).toEqual({
      kind: 'priced', figure: 0.00059, unit: 'LXC', model: 'Claude Haiku 4.5', inputTokens: 14, outputTokens: 9,
    })
    expect(parseFooter('≈ $0.000059 · GPT-6 Luna · 1,204 in / 9 out tokens')).toMatchObject({ unit: 'USD', inputTokens: 1204 })
  })
  it('a replay, a shared answer, no price, and anything else', () => {
    expect(parseFooter('from your earlier answer · 0 LXC')).toEqual({ kind: 'cache' })
    expect(parseFooter('shared answer · 30% off · ≈ 0.0004 LXC')).toEqual({ kind: 'pool', discountPct: 30, figure: 0.0004 })
    expect(parseFooter('Price not known — the provider reported no token counts for this answer')).toEqual({ kind: 'unpriced' })
    expect(parseFooter('≈ $0.1 LXC · x · 1 in / 1 out tokens').kind).toBe('unreadable')
  })
})

describe('the catalog price oracle', () => {
  it('prints what the screen should print for a token count', () => {
    const haiku = { input_per_1m: 1, output_per_1m: 5 }
    expect(listPriceUSD(haiku, 14, 9)).toBeCloseTo(0.000059)
    expect(expectedFigure(listPriceUSD(haiku, 14, 9), 0.1)).toBe('≈ 0.00059 LXC')
    expect(expectedFigure(listPriceUSD(haiku, 14, 9), undefined)).toBe('≈ $0.000059')
  })
})

describe('known-answer oracles', () => {
  it('statesNumber finds the number as a number, not inside another', () => {
    expect(statesNumber('2 + 2 = 4.', 4)).toBe(true)
    expect(statesNumber('The answer is 1,042', 1042)).toBe(true)
    expect(statesNumber('41', 4)).toBe(false)
    expect(statesNumber('4.5', 4)).toBe(false)
  })
  it('namesWord matches a whole word, any case', () => {
    expect(namesWord('The capital is buenos aires.', 'Buenos Aires')).toBe(true)
    expect(namesWord('Parisian', 'Paris')).toBe(false)
  })
  it('judgeVerdict takes YES or NO and nothing else', () => {
    expect(judgeVerdict(' Yes.')).toBe(true)
    expect(judgeVerdict('NO')).toBe(false)
    expect(judgeVerdict('Maybe')).toBeUndefined()
  })
})
