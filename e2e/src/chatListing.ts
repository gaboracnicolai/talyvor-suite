// B28.426 (for talyvor-lens B28.186) — a paid skill used in Chat, once a run, on workspaces of its own.
//
// A new seller publishes a skill at $1.00 a use. The buyer opens its listing page in the browser and chooses Use in Chat,
// which opens a new chat attached to it, and asks two questions there. Every request names the listing to Lens
// (X-Talyvor-Listing), and Lens asks each through the skill and charges it as a marketplace use. So the buyer's marketplace
// bill holds exactly two billed uses of the listing, and its ledger two new model spend rows — the two answers' tokens,
// which are paid from credits as any answer is; and each answer says it was billed.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { fail } from './bank.ts'
import type { Listing, MarketBill, MarketOffer } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { until } from './trade.ts'

/** The skill's price, $1.00 a use, in µUSD. */
const PRICE_USD_MICROS = 1_000_000
/** Lens puts a billed use on the bill within a minute. */
const BILL_WAIT_MS = 90_000
const QUESTIONS = ['Reply with the single word yes.', 'Reply with the single word no.']

export function chatListing(seed: number): Scenario {
  return {
    id: 'chat-listing',
    owner: 'talyvor-lens',
    own: true,
    items: ['B28.426', 'B28.186'],
    title: 'a paid skill used in Chat from its listing page: two questions write two billed uses on the buyer’s marketplace bill and two model spend rows, and each answer says it was billed',
    run: async (ctx) => {
      const { env, app } = ctx
      const [seller] = await env.lens.createUsers(1)
      const title = `Chat skill ${seed}-${RUN_SALT}`
      const offers: MarketOffer[] = [{ kind: 'per_use', licence: 'commercial', price_usd_micros: PRICE_USD_MICROS }]
      const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'skill', title, description: '', visibility: 'public',
        artifact: { instructions: 'Answer in as few words as the question allows.', model: env.judgeModel }, changelog: '', offers })
      ctx.evidence.push({ note: `the seller publishes the skill "${title}" at ${PRICE_USD_MICROS} µUSD a use`, answer: said(pub) })
      if (!pub.ok) return fail(`publishing the skill "${title}" was refused: ${said(pub)}`)
      const id = pub.value.id
      if (pub.value.review_status !== 'approved') {
        if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
        const ok = await env.lens.moderate(id, 'approve')
        if (!ok.ok) return fail(`approving the held listing ${id}: ${ok.status} ${ok.error}`)
      }

      // From its listing page to a chat attached to it, in the buyer's own browser.
      const page = app.page
      await page.goto(`${new URL(page.url()).origin}/marketplace/listings/${encodeURIComponent(id)}`)
      await page.getByRole('link', { name: 'Use in Chat' }).click()
      const chip = page.getByTestId('chat-listing')
      try {
        await chip.filter({ hasText: title }).waitFor({ timeout: 15_000 })
      } catch {
        return fail(`Use in Chat on ${id}'s page opened ${page.url()}, which shows no chat attached to "${title}"`)
      }
      if (!(await app.chooseModel(app.modelNameInUse))) return fail(`the model picker does not offer ${app.modelNameInUse}`)
      const spent0 = new Set((await env.lens.ledger(app.user)).filter((r) => r.type === 'spend').map((r) => r.id))
      for (const q of QUESTIONS) {
        const t = await app.ask(q)
        ctx.evidence.push({ note: 'asked through the skill', question: q, answer: t.answer.slice(0, 200), footer: t.footerText, error: t.error })
        if (t.error !== undefined) return fail(`"${q}", asked through the skill, was refused: ${t.error}`)
      }
      const charges = await page.getByTestId('turn-listing').evaluateAll((els) => els.map((e) => e.getAttribute('data-charge') ?? ''))
      if (charges.join() !== 'billed,billed') return fail(`each of the two answers should say its use was billed; they say ${JSON.stringify(charges)}`)
      await mkdir(env.outDir, { recursive: true })
      const was = page.viewportSize()
      for (const [width, height] of [[1440, 900], [390, 844]] as const) {
        await page.setViewportSize({ width, height })
        await chip.scrollIntoViewIfNeeded()
        const shot = join(env.outDir, `chat-listing-${width}px-user${app.user.index}.png`)
        await page.screenshot({ path: shot })
        ctx.evidence.push({ note: `the chat asked through the skill at ${width}px: ${shot}` })
      }
      if (was !== null) await page.setViewportSize(was)

      // The ledger: two billed uses of the listing on the buyer's bill, and the two answers' spend.
      const ours = (b: MarketBill) => (b.lines ?? []).filter((l) => l.listing_id === id)
      const bill = await until(() => env.lens.marketBill(app.user), (b) => ours(b).length >= QUESTIONS.length, BILL_WAIT_MS)
      const spends = (await env.lens.ledger(app.user)).filter((r) => r.type === 'spend' && !spent0.has(r.id))
      ctx.evidence.push({ note: `the buyer's bill lines for ${id}`, answer: JSON.stringify(ours(bill)) })
      ctx.evidence.push({ note: 'the spend rows the two questions wrote', answer: JSON.stringify(spends) })
      const price = pub.value.price_per_use_ulxc
      if (ours(bill).length !== QUESTIONS.length || ours(bill).some((l) => l.price_ulxc !== price || l.refunded_at !== undefined)) {
        return fail(`two questions asked through ${id} should be two billed uses at ${price} µLXC on the buyer's bill; it holds ${JSON.stringify(ours(bill))}`)
      }
      if (spends.length !== QUESTIONS.length || spends.some((r) => r.amount_ulxc >= 0)) {
        return fail(`two questions asked through ${id} should write two model spend rows; the ledger has ${spends.length}: ${JSON.stringify(spends)}`)
      }
      return { pass: true, detail: `two questions in a chat opened from Use in Chat on ${id}: two billed uses at ${price} µLXC on the buyer's bill, two spend rows (${spends.map((r) => r.amount_ulxc).join(', ')} µLXC), each answer marked billed` }
    },
  }
}
