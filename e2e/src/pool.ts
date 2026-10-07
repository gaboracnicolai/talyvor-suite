// B28.283 — THE POOL DOES NOT LEAK OR GET POISONED. Lens serves one workspace's answer to another from its pool only
// when the first chose to share (cache_poolable) with its personal-data detection on, never an answer to a question
// carrying personal data, and only to the question as it was asked (talyvor-lens proxy storeCaches / sharesAnswers,
// cache_pooling MaybeAllowPooledHit). One scenario, on a workspace of its own — the contributor — and a second it makes
// — the reader, which shares too and has switched its own personal-data detection off, as a workspace fishing for other
// workspaces' answers would:
//   pool-isolation — first the reader is served from the pool a question the contributor asked while sharing, so the
//     pool is live between the two and anything below that leaked could be seen. Then:
//     1. the existence probe: with sharing off, the contributor asks a question (kept: its own repeat is replayed). The
//        reader asking it is asked afresh at the catalog price, and what Lens says about its cache and pool reads the
//        same as for a question nobody has asked: the reader cannot tell the contributor asked it.
//     2. personal data: sharing again, the contributor asks a question carrying an email and a phone number. It is not
//        kept (its own repeat is asked afresh), and the reader asking it is asked afresh, never served that answer.
//     3. direction and negation: the contributor asks "a minus b" and "is a greater than b". The reader asking "b minus
//        a" and "is a not greater than b" is asked afresh and not given the contributor's answer, while the two
//        questions as the contributor asked them are served from the pool. Whether a reworded question is served from
//        the pool — whether Lens's similarity pool is live, the layer a direction or negation would slip through — is
//        noted with the verdict.

import { fail } from './bank.ts'
import { type Asked, ask, freshQuestion, judgeRoute, proxyKey, rowsText, servedRight, verdictOf } from './gateway.ts'
import { RUN_SALT, statesNumber } from './oracles.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { call, ok, said, setSwitch } from './settings.ts'

const pooledULXC = (a: Asked): string | null => a.headers.get('X-Talyvor-Pool-Charged-ULXC')

/** How an answer came: from the pool, from the asker's own earlier answer, or asked of the model. */
const how = (a: Asked): string => (pooledULXC(a) !== null ? `from the pool (${pooledULXC(a)} µLXC)` : a.replayed ? 'from its own earlier answer' : 'asked afresh')

/** What Lens says about its cache and its pool on an answer (X-Talyvor-Cache…, X-Talyvor-Pool-…): where a reader would see that another asked. */
function cacheSays(a: Asked): string {
  const said: string[] = []
  a.headers.forEach((v, k) => { if (/^x-talyvor-(cache|pool)/i.test(k)) said.push(`${k.toLowerCase()}: ${v}`) })
  return said.sort().join('; ') || '(nothing)'
}

/** The workspace's personal-data detection switched `on`, read back; undefined once it is, else what is wrong. */
async function detectPII(ctx: ScenarioCtx, on: boolean): Promise<string | undefined> {
  const start = await call<Record<string, unknown>>(ctx, 'GET', '/v1/workspaces/{ws}/guardrails')
  if (start.value === undefined || !ok(start.status)) return `reading the guardrails answered ${said(start)}`
  const set = await call(ctx, 'POST', '/v1/workspaces/{ws}/guardrails', { ...start.value, enable_pii: on })
  const back = await call<{ enable_pii?: boolean }>(ctx, 'GET', '/v1/workspaces/{ws}/guardrails')
  ctx.evidence.push({ note: `personal-data detection ${on ? 'on' : 'off'}: ${said(set)}; reads back enable_pii ${back.value?.enable_pii}` })
  return ok(set.status) && back.value?.enable_pii === on ? undefined : `switching personal-data detection ${on ? 'on' : 'off'} answered ${said(set)} and reads back ${back.text.slice(0, 160)}`
}

export function poolIsolation(): Scenario {
  return {
    id: 'pool-isolation',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Shared answers',
    title: "Lens's pool, between a contributor and a reader that both share and the reader's personal-data detection off: a question asked with " +
      'sharing off is asked afresh for the reader and its cache and pool headers read as for a question nobody asked; a question carrying an email ' +
      'and a phone number is kept nowhere and never served to the reader; "b minus a" and "is a not greater than b" are asked afresh while ' +
      '"a minus b" and "is a greater than b" are served from the pool',
    run: async (ctx) => {
      const wrong: string[] = []
      const step = (w: string | undefined) => { if (w !== undefined) wrong.push(w) }
      const { route, model } = judgeRoute(ctx)
      const [other] = await ctx.env.lens.createUsers(1)
      const reader: ScenarioCtx = { ...ctx, app: { ...ctx.app, user: { ...other, index: ctx.app.user.index } } as ScenarioCtx['app'] }
      const kc = await proxyKey(ctx, `pool contributor ${RUN_SALT}`)
      if (typeof kc === 'string') return fail(`the contributor: ${kc}`)
      const kr = await proxyKey(reader, `pool reader ${RUN_SALT}`)
      if (typeof kr === 'string') return fail(`the reader: ${kr}`)
      const contribute = (note: string, question: string) => ask(ctx, kc.key, route, model.id, `the contributor: ${note}`, {}, { question, replay: true })
      const read = (note: string, question: string) => ask(reader, kr.key, route, model.id, `the reader: ${note}`, {}, { question, replay: true })
      /** Asked of the model and charged its catalog price, or what is wrong. */
      const asked = async (c: ScenarioCtx, a: Asked, who: string): Promise<string | undefined> =>
        a.replayed ? `${who} was served ${how(a)}, not asked afresh` : servedRight(c, a, model, who)

      // Both share; the contributor's prompts are checked for personal data, the reader's are not.
      for (const [c, who] of [[ctx, 'the contributor'], [reader, 'the reader']] as const) {
        const w = await setSwitch(c, '/cache-poolable', { cache_poolable: true }, (x) => x.cache_poolable)
        if (w !== undefined) return fail(`${who}: ${w}`)
      }
      for (const [c, on, who] of [[ctx, true, 'the contributor'], [reader, false, 'the reader']] as const) {
        const w = await detectPII(c, on)
        if (w !== undefined) return fail(`${who}: ${w}`)
      }

      // 0. The pool is live between them: a question the contributor asked while sharing is served to the reader from it.
      const q0 = freshQuestion()
      step(await asked(ctx, await contribute('a question, sharing', q0), 'the contributor asking a question while sharing'))
      const live = await read('the same question', q0)
      const spend = live.fresh.filter((r) => r.type === 'spend')
      if (pooledULXC(live) === null) {
        return fail([...wrong, `the reader asking a question the contributor shared was ${how(live)}, not served from the pool, so nothing here could be seen to leak`].join('; '))
      }
      if (spend.length !== 1 || -spend[0].amount_ulxc !== Number(pooledULXC(live))) wrong.push(`the pooled answer says it was charged ${pooledULXC(live)} µLXC, and the reader's ledger gained ${rowsText(live.fresh)}`)

      // 1. The existence probe: asked while not sharing, the question is the contributor's alone.
      step(await setSwitch(ctx, '/cache-poolable', { cache_poolable: false }, (x) => !x.cache_poolable))
      const secret = freshQuestion()
      step(await asked(ctx, await contribute('a question, not sharing', secret), 'the contributor asking a question while not sharing'))
      const kept = await contribute('the same question again', secret)
      if (!kept.replayed) wrong.push(`the contributor's own repeat of its question was ${how(kept)}, so its answer was kept nowhere and the probe could not have found it`)
      const probe = await read('the question the contributor asked while not sharing', secret)
      const nobody = await read('a question nobody has asked', freshQuestion())
      ctx.evidence.push({ note: `what Lens said about its cache and pool — to the probe: ${cacheSays(probe)}; to a question nobody asked: ${cacheSays(nobody)}` })
      step(await asked(reader, probe, 'the reader asking the question the contributor asked while not sharing'))
      step(await asked(reader, nobody, 'the reader asking a question nobody has asked'))
      if (cacheSays(probe) !== cacheSays(nobody)) {
        wrong.push(`the reader can tell the contributor asked its question: Lens said "${cacheSays(probe)}" to it and "${cacheSays(nobody)}" to a question nobody asked`)
      }
      step(await setSwitch(ctx, '/cache-poolable', { cache_poolable: true }, (x) => x.cache_poolable))

      // 2. Personal data: kept nowhere, so never served to the reader, whose own detection would not stop it.
      const personal = `My email is pool.${RUN_SALT}.${Date.now().toString(36)}@example.com and my phone number is +1 202 555 ${String(1000 + (RUN_SALT % 9000)).slice(-4)}. ${freshQuestion()}`
      step(await asked(ctx, await contribute('a question carrying an email and a phone number', personal), 'the contributor asking a question carrying personal data'))
      step(await asked(ctx, await contribute('the same question again', personal), "the contributor's repeat of its question carrying personal data"))
      step(await asked(reader, await read('the question carrying the contributor\'s email and phone number', personal), "the reader asking the question carrying the contributor's personal data"))

      // 3. Direction and negation: the contributor's answer is not the answer to the question turned round or denied.
      const a = 5000 + (RUN_SALT % 4000)
      const b = 1000 + ((RUN_SALT * 7) % 3000)
      const tag = `(${RUN_SALT}-${Date.now().toString(36)})`
      const minus = (x: number, y: number) => `What is ${x} minus ${y}? Reply with the number only. ${tag}`
      const greater = (not: boolean) => `Is ${a}${not ? ' not' : ''} greater than ${b}? Reply yes or no. ${tag}`
      step(await asked(ctx, await contribute('a minus b', minus(a, b)), 'the contributor asking a minus b'))
      step(await asked(ctx, await contribute('is a greater than b', greater(false)), 'the contributor asking whether a is greater than b'))
      const turned = await read('b minus a — the contributor\'s question turned round', minus(b, a))
      step(await asked(reader, turned, 'the reader asking b minus a'))
      if (turned.status === 200 && statesNumber(turned.text, a - b) && !statesNumber(turned.text, b - a)) {
        wrong.push(`the reader asking ${b} minus ${a} was answered "${turned.text.slice(0, 80)}" — the contributor's answer to ${a} minus ${b}`)
      }
      step(await asked(reader, await read('is a not greater than b — the contributor\'s question denied', greater(true)), 'the reader asking whether a is not greater than b'))
      for (const [note, q] of [['a minus b, as the contributor asked it', minus(a, b)], ['is a greater than b, as the contributor asked it', greater(false)]] as const) {
        const same = await read(note, q)
        if (pooledULXC(same) === null) wrong.push(`the reader asking ${note} was ${how(same)}, not served from the pool, so its answer was not there to be served to the question turned round or denied`)
      }
      const reworded = await read('a minus b, reworded', `Please tell me: what is ${a} minus ${b}? Reply with the number only. ${tag}`)
      const similarity = pooledULXC(reworded) !== null ? 'live — a reworded question was served from it' : `not seen — a reworded question was ${how(reworded)}`

      return verdictOf(wrong, `the pool served the reader a shared answer at ${pooledULXC(live)} µLXC; a question asked while not sharing was asked afresh for the reader, its cache and pool headers ("${cacheSays(probe)}") as for a question nobody asked; a question carrying personal data was kept nowhere and asked afresh for the reader; "${b} minus ${a}" and "is ${a} not greater than ${b}" were asked afresh while the questions as asked were served from the pool; the similarity pool ${similarity}`)
    },
  }
}
