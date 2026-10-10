import { describe, expect, it } from 'vitest'
import { chargeULXC, type Turn } from '../src/app.ts'
import { type CatalogModel, chargedFigure, listPriceUSD } from '../src/oracles.ts'
import { type ScenarioCtx, everyModelAnswers } from '../src/scenarios.ts'

const catalog: CatalogModel[] = [
  { id: 'gpt-4o', provider: 'openai', display_name: 'GPT-4o', input_per_1m: 2.5, output_per_1m: 10 },
  { id: 'gpt-4.1', provider: 'openai', display_name: 'GPT-4.1', input_per_1m: 2, output_per_1m: 8 },
]
const usdPerLXC = 1

/** A picker and a chat whose models answer `reply(model, word, nth ask of that model)`, each priced at the catalog. */
function chat(reply: (model: string, word: string, nth: number) => string) {
  const asked: string[] = []
  const times = new Map<string, number>()
  let model = 'GPT-4.1'
  const app = {
    page: { url: () => 'http://app.test/chat', request: { get: async () => ({ ok: () => true, json: async () => ({ unconfigured: [] }) }) } },
    get modelNameInUse() { return model },
    chooseModel: async (name: string) => { model = name; return true },
    newChat: async () => {},
    ask: async (q: string): Promise<Turn> => {
      asked.push(q)
      const m = catalog.find((c) => c.display_name === model)!
      const nth = (times.get(model) ?? 0) + 1
      times.set(model, nth)
      const charged = chargeULXC(listPriceUSD(m, 597, 11), usdPerLXC)
      return {
        question: q,
        answer: reply(model, q.split(': ')[1], nth),
        footerText: `${chargedFigure(charged)} · ${model} · 597 in / 11 out tokens`,
        footer: { kind: 'priced', figure: charged / 1e6, unit: 'LXC', model, inputTokens: 597, outputTokens: 11, chargedULXC: charged },
        costUSD: listPriceUSD(m, 597, 11),
      }
    },
  }
  const ctx = () => ({ app, env: { catalog, usdPerLXC }, evidence: [] }) as unknown as ScenarioCtx
  return { asked, ctx }
}

describe('B17.200 — every-model asks a model that refuses the echo once more', () => {
  it('passes a model that refuses once and echoes the second word, and fails one that misses both', async () => {
    const refuseOnce = chat((model, word, nth) => model === 'GPT-4o' && nth === 1 ? "I'm sorry, I can't comply with that request." : word)
    const once = await everyModelAnswers(['openai']).run(refuseOnce.ctx())
    expect(once).toEqual({ pass: true, detail: '2 models answered at their catalog price' })
    expect(refuseOnce.asked).toHaveLength(3)
    expect(refuseOnce.asked[1]).not.toBe(refuseOnce.asked[0])

    const refuseTwice = chat((model, word) => model === 'GPT-4o' ? "I'm sorry, I can't comply with that request." : word)
    const twice = await everyModelAnswers(['openai']).run(refuseTwice.ctx())
    expect(twice.pass).toBe(false)
    expect(twice.detail).toMatch(/^GPT-4o: asked to say "\w+", it answered "I'm sorry[^"]*"; then asked to say "\w+", it answered "I'm sorry[^"]*"$/)
  })

  it('asks a second attempt words the first did not', async () => {
    const { asked, ctx } = chat((_, word) => word)
    const scenario = everyModelAnswers(['openai'])
    await scenario.run(ctx())
    const first = asked.splice(0)
    await scenario.run(ctx())
    expect(first).toHaveLength(2)
    expect(asked).toHaveLength(2)
    expect(asked.filter((q) => first.includes(q))).toEqual([])
  })
})
