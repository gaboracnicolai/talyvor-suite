import { describe, expect, it } from 'vitest'
import { stillAsking } from '../src/screens.ts'

describe('stillAsking (B17.39)', () => {
  it('reads every AI card’s pending label as not yet an answer — Docs Ask’s bare "Asking…" too', () => {
    // apps/web/src/areas/docs/AskAI.tsx: what user 215's card showed when it was read as the answer.
    expect(stillAsking('Ask the documentation\nQuestion\nAsking…\nAnswered from the pages you can open, by Docs through Lens.\nAsking a question buys a metered Lens call')).toBe(true)
    for (const label of ['Asking Track…', 'Asking Docs…', 'Summarising…', 'Translating…', 'Suggesting…']) expect(stillAsking(label)).toBe(true)
    expect(stillAsking('Ask the documentation\nQuestion\nAsk\nThe access code is QX-4215.\nSources\nLaunch memo 215\nThis answer was a metered Lens call')).toBe(false)
  })
})
