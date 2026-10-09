// B28.19 — an agent's statement names every kind of line by what it was. A person's agent is topped up automatically
// by the workspace, sent credits by another of the workspace's agents, charged on its test card and has credits moved
// into a pot: the four lines of B28.19's DONE. The top-up, the send, the card and the pot are made on Agent Wallets as a
// person makes them; the purchase is put to Lens as the card's issuer puts it. The ledger is Lens's statement for the
// agent: exactly those four postings, each of its kind and amount, and the agent holding what they add up to. Then
// Agent Wallets' Statement, row for row against it: four different words, each what its line was, signed the way the
// money went, and none "Spent on a request" — the words a received transfer, a card charge, a top-up and a pot move
// all read before B28.19.

import type { AgentLine } from './lens.ts'
import { agentIn, bookOf, fail, lxcText, openAgent, withBank } from './bank.ts'
import { until } from './trade.ts'
import type { Scenario } from './scenarios.ts'

/** The words every kind but a payment fell through to before B28.19. */
export const BORROWED = 'Spent on a request'

/** A line the scenario made on the agent's account: its kind, its amount, who it is with, and the words B28.19 gives it. */
export interface Made {
  kind: string
  amount_ulxc: number
  counterparty?: string
  words: string
}

/** A statement row as Agent Wallets shows it: its words, and its amount as drawn ("+1.5 LXC", "−0.5 LXC"). */
export interface Shown {
  what: string
  amount: string
}

const lineOf = (l: AgentLine): string => `${l.kind} ${l.amount_ulxc}${l.counterparty ? ` (${l.counterparty})` : ''}`
const madeOf = (m: Made): string => `${m.kind} of ${m.amount_ulxc} µLXC${m.counterparty === undefined ? '' : ` with ${m.counterparty}`}`
const matches = (m: Made, l: AgentLine): boolean => l.kind === m.kind && l.amount_ulxc === m.amount_ulxc && (m.counterparty === undefined || l.counterparty === m.counterparty)

/**
 * The oracle: Lens's statement holds exactly the lines `made`, the agent holds what they add up to, and the screen shows
 * each of Lens's lines, in Lens's order, in the words B28.19 gives its kind, signed the way it moved.
 */
export function statementKindsVerdict(made: readonly Made[], lines: readonly AgentLine[], held: number | undefined, shown: readonly Shown[]): { pass: boolean; detail: string } {
  const wrong: string[] = []
  for (const m of made) {
    const n = lines.filter((l) => matches(m, l)).length
    if (n !== 1) wrong.push(`Lens's statement has ${n} line(s) of ${madeOf(m)}, want one`)
  }
  const extra = lines.filter((l) => !made.some((m) => matches(m, l)))
  if (extra.length > 0) wrong.push(`Lens's statement has lines nothing here made: ${extra.map(lineOf).join(', ')}`)
  const sum = made.reduce((s, m) => s + m.amount_ulxc, 0)
  if (held !== sum) wrong.push(`the agent holds ${held} µLXC, not the ${sum} its lines add up to`)

  if (shown.length !== lines.length) wrong.push(`Agent Wallets' Statement shows ${shown.length} row(s) for Lens's ${lines.length} line(s)`)
  lines.forEach((l, i) => {
    const m = made.find((x) => matches(x, l))
    const row = shown[i]
    if (m === undefined || row === undefined) return
    if (row.what !== m.words) wrong.push(`the ${l.kind} line of ${l.amount_ulxc} µLXC reads "${row.what}", not "${m.words}"`)
    const sign = l.amount_ulxc > 0 ? '+' : '−'
    if (!row.amount.startsWith(sign)) wrong.push(`the ${l.kind} line of ${l.amount_ulxc} µLXC is drawn "${row.amount}", not signed ${sign}`)
  })
  const words = shown.map((r) => r.what)
  const borrowed = words.filter((w) => w === BORROWED).length
  if (borrowed > 0) wrong.push(`${borrowed} row(s) read "${BORROWED}", and nothing here was a request`)
  if (new Set(words).size !== words.length) wrong.push(`two rows read alike: ${words.map((w) => `"${w}"`).join(', ')}`)

  return wrong.length === 0
    ? { pass: true, detail: `Lens's statement holds exactly ${made.map(madeOf).join(', ')}, the agent ${held} µLXC; Agent Wallets names them ${shown.map((r) => `"${r.what}" ${r.amount}`).join(', ')}` }
    : { pass: false, detail: wrong.join('; ') }
}

export function statementLineKinds(seed: number): Scenario {
  const below = 1_000_000
  const to = 10_000_000
  const sent = 1_500_000
  const pence = 20
  const potted = 500_000
  return {
    id: 'statement-line-kinds',
    owner: 'talyvor-suite',
    items: ['B28.19'],
    agents: 2,
    title: "an agent topped up automatically, sent credits by another agent, charged on its card and moving credits into a pot: its statement on Agent Wallets names the four lines Lens posts for them, each by what it was",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const name = `Labelled ${seed}`
      const a = await openAgent(ctx, bank, name)
      if (typeof a === 'string') return fail(a)

      // The workspace tops it up: it holds nothing, so Lens's next tick fills it. The top-up then comes off, so no
      // later move dips it under the level and earns a second.
      let err = await bank.setTopUp(a, below, to)
      if (err !== undefined) return fail(`setting ${name}'s top-up below ${lxcText(below)} to ${lxcText(to)} LXC was refused: ${err}`)
      const filled = await until(async () => agentIn(await env.lens.agentBook(app.user), a.id)?.balance_ulxc ?? 0, (v) => v >= to)
      ctx.evidence.push({ note: `after Lens's tick ${name} holds ${filled} µLXC` })
      if (filled < to) return fail(`${name}'s top-up below ${lxcText(below)} to ${lxcText(to)} LXC never filled it: it holds ${filled} µLXC`)
      err = await bank.removeTopUp(a)
      if (err !== undefined) return fail(`removing ${name}'s top-up was refused: ${err}`)

      // Another of the workspace's agents sends it credits, to its wallet ID.
      const writer = await openAgent(ctx, bank, `Writer ${seed}`)
      if (typeof writer === 'string') return fail(writer)
      err = await bank.move(writer, 2 * sent, 'Fund')
      if (err !== undefined) return fail(`funding ${writer.name} was refused: ${err}`)
      const said = await bank.send(writer, a.id, sent, `statement words ${seed}`)
      ctx.evidence.push({ note: `${writer.name} sends ${lxcText(sent)} LXC to ${a.id}: ${said}` })
      if (!/^Sent/.test(said)) return fail(`${writer.name} sending ${lxcText(sent)} LXC to ${name} was refused: "${said}"`)

      // It pays with its test card.
      err = await bank.issueCard(a, { first: 'Test', last: 'Labelled', line1: '1 High Street', city: 'London', postcode: 'EC1A 1BB' })
      if (err !== undefined) return fail(`issuing ${name} a card was refused: ${err}`)
      const merchant = `Label Co ${seed}`
      const bought = await env.lens.cardPurchase(app.user, a.id, { amount_minor: pence, currency: 'gbp', merchant })
      ctx.evidence.push({ note: `${name} pays £0.${pence} at ${merchant} with its card (B25.7)`, answer: JSON.stringify(bought) })
      if (!bought.ok) return fail(`the purchase could not be put to Lens: ${bought.status} ${bought.error}`)
      if (!bought.value.approved) return fail(`a £0.${pence} purchase by ${name}, holding ${lxcText(to + sent)} LXC, was declined: ${bought.value.reason}`)

      // And sets credits aside in a pot.
      const pot = `Kept ${seed}`
      err = await bank.createPot(a, pot, 2 * potted)
      if (err !== undefined) return fail(`creating the pot ${pot} was refused: ${err}`)
      err = await bank.movePot(a, pot, potted, 'in')
      if (err !== undefined) return fail(`moving ${lxcText(potted)} LXC into ${pot} was refused: ${err}`)

      const made: Made[] = [
        { kind: 'topup', amount_ulxc: to, words: 'Topped up automatically by the workspace' },
        { kind: 'transfer', amount_ulxc: sent, counterparty: `agent:${writer.id}`, words: `Transfer from ${writer.name}` },
        { kind: 'card', amount_ulxc: -bought.value.amount_ulxc, words: 'Card charge' },
        { kind: 'pot_in', amount_ulxc: -potted, words: 'Moved into a pot' },
      ]
      const lines = await env.lens.agentLines(app.user, a.id)
      ctx.evidence.push({ note: `${name}'s statement on Lens: ${JSON.stringify(lines.map((l) => ({ kind: l.kind, amount_ulxc: l.amount_ulxc, counterparty: l.counterparty, balance_after_ulxc: l.balance_after_ulxc })))}` })
      const held = agentIn(await bookOf(ctx), a.id)?.balance_ulxc
      const shown = await bank.statement(a)
      ctx.evidence.push({ note: `${name}'s Statement on Agent Wallets: ${JSON.stringify(shown)}` })
      return statementKindsVerdict(made, lines, held, shown)
    }),
  }
}
