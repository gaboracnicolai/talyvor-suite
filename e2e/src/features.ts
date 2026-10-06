// B28.441 — Features (/features) opens on Agent Wallets. A person creates an agent on Agent Wallets and
// funds it; Lens's statement for that agent must hold the fund line. Then Features: its first capability
// row is Agent Wallets, whose "See it working" line names the agents and the LXC they hold as Lens's book
// has them, and a Marketplace row counts the catalogue's listings as Lens lists them.

import type { AgentBook } from './lens.ts'
import { ACTION_TIMEOUT_MS, agentIn, bookOf, fail, lxcText, openAgent, withBank } from './bank.ts'
import type { Scenario } from './scenarios.ts'

/** The app's formatULXC (apps/web/src/areas/lens/agentBankApi.ts): "12.5 LXC". */
export const lxcShown = (ulxc: number): string => `${(ulxc / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 })} LXC`

/** What Features showed: its rows' names in page order, and two rows' "See it working" lines. */
export interface FeaturesSeen {
  rows: string[]
  wallets: string
  market: string
}

/**
 * The oracle. `books` and `listings` are Lens's readings just before and just after the screen was
 * read: the wallet line must match one book, and the listing count must lie between the two catalogue
 * counts, since other users publish and take listings down while the run goes on.
 */
export function featuresVerdict(seen: FeaturesSeen, books: readonly AgentBook[], listings: readonly number[]): { pass: boolean; detail: string } {
  if (seen.rows[0] !== 'Agent Wallets') return { pass: false, detail: `Features opens on ${seen.rows[0] ?? 'no row'}, not Agent Wallets: ${seen.rows.join(', ')}` }
  const wants = books.map((b) => {
    const n = b.agents.length
    return n === 0 ? 'No agent has a wallet yet' : `${n.toLocaleString('en-US')} ${n === 1 ? 'agent holds' : 'agents hold'} ${lxcShown(b.allocated_ulxc)} of this workspace`
  })
  if (!wants.some((w) => seen.wallets.startsWith(w))) return { pass: false, detail: `the Agent Wallets row says "${seen.wallets}"; Lens's book says "${wants[wants.length - 1]}…"` }
  if (!seen.rows.includes('Marketplace')) return { pass: false, detail: `Features has no Marketplace row: ${seen.rows.join(', ')}` }
  const m = /^No listing is published yet/.test(seen.market) ? ['', '0'] : /^([\d,]+) listings? (?:is|are) open to use/.exec(seen.market)
  if (m === null) return { pass: false, detail: `the Marketplace row names no listing count: "${seen.market}"` }
  const shown = Number(m[1].replace(/,/g, ''))
  if (shown < Math.min(...listings) || shown > Math.max(...listings)) {
    return { pass: false, detail: `the Marketplace row counts ${shown} listing(s); Lens's catalogue had ${listings.join(', then ')}` }
  }
  return { pass: true, detail: `Features opens on Agent Wallets — "${seen.wallets}" — and its Marketplace row counts ${shown} listing(s), as Lens has them` }
}

export function featuresLeadWithWallets(seed: number): Scenario {
  const amount = (1 + (seed % 3)) * 1e6
  return {
    id: 'features-wallets-first',
    owner: 'talyvor-suite',
    agents: 1,
    title: 'Features opens on Agent Wallets, naming the agents and the LXC they hold, and lists the Marketplace with its listing count',
    run: (ctx) => withBank(ctx, async (bank) => {
      const a = await openAgent(ctx, bank, `Features ${seed}`)
      if (typeof a === 'string') return fail(a)
      const err = await bank.move(a, amount, 'Fund')
      if (err !== undefined) return fail(`funding ${lxcText(amount)} LXC was refused: ${err}`)
      // The money moved: the agent's statement holds one fund line of exactly that, its balance after.
      const lines = await ctx.env.lens.agentLines(ctx.app.user, a.id)
      ctx.evidence.push({ note: `${a.name}'s statement: ${lines.map((l) => `${l.kind} ${l.amount_ulxc} → ${l.balance_after_ulxc}`).join('; ') || 'no lines'}` })
      const funds = lines.filter((l) => l.kind === 'fund')
      if (funds.length !== 1 || funds[0].amount_ulxc !== amount || funds[0].balance_after_ulxc !== amount) {
        return fail(`funded ${amount} µLXC; ${a.name}'s statement does not hold one fund line of +${amount} to ${amount}`)
      }

      const before = await bookOf(ctx)
      if (agentIn(before, a.id)?.balance_ulxc !== amount) return fail(`funded ${amount} µLXC; Lens's book has ${a.name} holding ${agentIn(before, a.id)?.balance_ulxc}`)
      const listed0 = (await ctx.env.lens.catalogListings(ctx.app.user)).length
      const page = await ctx.app.tab('/features')
      let seen: FeaturesSeen
      try {
        const line = (name: string) => page.getByTestId(`evidence-${name}`)
        await line('Agent Wallets').filter({ hasNotText: 'Reading…' }).waitFor({ timeout: ACTION_TIMEOUT_MS })
        await line('Marketplace').filter({ hasNotText: 'Reading…' }).waitFor({ timeout: ACTION_TIMEOUT_MS })
        const said = async (name: string) => (await line(name).innerText()).replace(/^\s*See it working:\s*/, '').trim()
        seen = {
          rows: await page.locator('[data-testid^="evidence-"]').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice('evidence-'.length))),
          wallets: await said('Agent Wallets'),
          market: await said('Marketplace'),
        }
      } finally {
        await page.close()
      }
      const after = await bookOf(ctx)
      const listed1 = (await ctx.env.lens.catalogListings(ctx.app.user)).length
      ctx.evidence.push({ note: `Features: ${seen.rows.join(' · ')}. Agent Wallets: "${seen.wallets}". Marketplace: "${seen.market}". Lens's catalogue: ${listed0}, then ${listed1}` })
      return featuresVerdict(seen, [before, after], [listed0, listed1])
    }),
  }
}
