import { describe, expect, it } from 'vitest'
import type { Turn } from '../src/app.ts'
import { type ScenarioCtx, editResendRerunsThread } from '../src/scenarios.ts'

/** A chat whose model slips on the sum by `slip` and multiplies whatever the thread holds; an edit re-runs from
 *  the turn before it unless `keepsOld`, when it multiplies the old "by 2" answer instead. */
function chat(slip: number, keepsOld = false) {
  let questions: string[] = []
  let answers: number[] = []
  const turn = (question: string, n: number): Turn =>
    ({ question, answer: String(n), footerText: '', footer: { kind: 'none' }, costUSD: undefined }) as unknown as Turn
  const answer = (q: string): number => {
    const sum = q.match(/What is (\d+) \+ (\d+)/)
    if (sum) return Number(sum[1]) + Number(sum[2]) + slip
    return Number(q.match(/by (\d+)/)![1]) * answers[answers.length - 1]
  }
  const app = {
    newChat: async () => { questions = []; answers = [] },
    ask: async (q: string) => { const n = answer(q); questions.push(q); answers.push(n); return turn(q, n) },
    editAndResend: async (i: number, q: string) => {
      if (!keepsOld) { questions = questions.slice(0, i); answers = answers.slice(0, i) }
      const n = answer(q)
      questions = [...questions.slice(0, i), q]
      answers = [...answers.slice(0, i), n]
      return turn(q, n)
    },
    page: {
      locator: (sel: string) => ({
        allInnerTexts: async () => questions,
        count: async () => (sel.includes('turn-assistant') ? answers.length : questions.length),
      }),
    },
  }
  return { app, evidence: [] } as unknown as ScenarioCtx
}

describe('B17.191 — chat-edit-resend measures the thread from the sum the model gave', () => {
  it('passes when the model slips on the sum, and still fails an edit that kept the old thread', async () => {
    const slipped = await editResendRerunsThread(85).run(chat(1))
    expect(slipped.pass).toBe(true)
    const keptOld = await editResendRerunsThread(85).run(chat(1, true))
    expect(keptOld.pass).toBe(false)
    expect(keptOld.detail).toMatch(/^expected \d+ from the turn before the edit/)
  })
})
