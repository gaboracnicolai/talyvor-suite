// B28.10 — sharing answers is a cost saving, and the royalty it earns is a side effect, not the headline. A person
// opens Settings: the sharing card is "Shared answers (saves on repeated questions)", says what it saves before what
// it earns, lists the royalty last on the "on" side, and links it to Royalties. Royalties sits indented under
// Statements, opens by calling a royalty a side effect of that saving, and carries the LENS→LXC conversion, which is
// no longer on Overview; the old /earnings address lands on it, and Billing's nav no longer lists Earnings. Billing
// sends a person on to fund their agents. Nothing here moves money: the conversion Royalties carries is lens-convert's,
// which asserts its ledger rows.

import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

export const SHARING_HEADER = 'Shared answers (saves on repeated questions)'
export const ROYALTIES = '/statements/royalties'

/** What a person saw on the five screens, as the scenario read them. */
export interface RoyaltiesSeen {
  /** Settings' sharing card: its header, the words under it, and where its Royalties link went when pressed. */
  sharing: { header: string; body: string; link: string }
  /** Royalties: its opening paragraph and every word on it. */
  royalties: { framing: string; text: string }
  /** What Lens holds of the workspace's LENS, which decides the conversion Royalties shows. */
  lens: 'none' | 'held' | 'spendable'
  /** Where /earnings landed. */
  earnings: string
  /** The sidebar on Billing: each link's name, its address and where its icon starts, in px. */
  nav: { name: string; href: string; x: number }[]
  /** Billing's words and where its "Fund your agents" button went. */
  billing: { text: string; fund: string }
  /** Overview's words, and whether it offers the conversion's own button. */
  overview: { text: string; converts: boolean }
}

const path = (url: string): string => {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/** The oracle: every way B28.10 can be taken away, each named. */
export function royaltiesVerdict(seen: RoyaltiesSeen): { pass: boolean; detail: string } {
  const wrong: string[] = []
  const { sharing, royalties } = seen

  if (sharing.header !== SHARING_HEADER) wrong.push(`Settings' sharing card is headed "${sharing.header}", not "${SHARING_HEADER}"`)
  const saves = sharing.body.search(/\bsaves?\b|without paying a model/i)
  const earns = sharing.body.search(/royalt|\bearn/i)
  if (saves < 0) wrong.push('the sharing card never says what sharing saves')
  else if (earns >= 0 && earns < saves) wrong.push(`the sharing card says what sharing earns ("${sharing.body.slice(earns, earns + 60)}…") before what it saves`)
  const on = /If sharing is on([\s\S]*?)If sharing is off/.exec(sharing.body)?.[1] ?? ''
  const royaltyAt = on.search(/royalty/i)
  if (royaltyAt < 0) wrong.push('the "If sharing is on" side does not call what an answer earns a royalty')
  else if (on.search(/without paying a model/i) > royaltyAt || on.search(/leaves this workspace/i) > royaltyAt) {
    wrong.push('the royalty is not the last thing on the "If sharing is on" side')
  }
  if (path(sharing.link) !== ROYALTIES) wrong.push(`the sharing card's Royalties link went to ${path(sharing.link) || 'nowhere'}, not ${ROYALTIES}`)

  if (!/save on repeated questions/i.test(royalties.framing) || !/side effect/i.test(royalties.framing)) {
    wrong.push(`Royalties does not open by calling a royalty a side effect of saving on repeated questions: "${royalties.framing.slice(0, 160)}"`)
  }
  // The region's label is drawn in capitals, and a person's eye (innerText) reads it that way.
  if (!/Convert to LXC/i.test(royalties.text)) wrong.push('Royalties does not carry the LENS→LXC conversion')
  const conversion = { none: 'LENS is earned, not bought', held: 'Only spendable LENS converts', spendable: 'Convert to LXC…' }[seen.lens]
  if (!royalties.text.includes(conversion)) wrong.push(`Royalties, for a workspace whose LENS is ${seen.lens}, does not say "${conversion}"`)

  if (path(seen.earnings) !== ROYALTIES) wrong.push(`/earnings landed on ${path(seen.earnings)}, not Royalties`)

  const at = seen.nav.findIndex((l) => path(l.href) === '/statements')
  const next = at >= 0 ? seen.nav[at + 1] : undefined
  if (at < 0) wrong.push('the sidebar has no Statements')
  else if (next === undefined || next.name !== 'Royalties' || path(next.href) !== ROYALTIES) {
    wrong.push(`the sidebar's row under Statements is ${next === undefined ? 'nothing' : `"${next.name}" (${path(next.href)})`}, not Royalties`)
  } else if (!(next.x > seen.nav[at].x)) wrong.push(`Royalties is not indented under Statements (${next.x}px against ${seen.nav[at].x}px)`)
  const earningsRow = seen.nav.find((l) => l.name === 'Earnings' || path(l.href) === '/earnings')
  if (earningsRow !== undefined) wrong.push(`the sidebar still lists "${earningsRow.name}" at ${path(earningsRow.href)}`)

  if (!seen.billing.text.includes('Fund your agents') || path(seen.billing.fund) !== '/agents') {
    wrong.push(`Billing's "Fund your agents" went to ${path(seen.billing.fund) || 'nowhere'}, not Agent Wallets`)
  }

  if (seen.overview.text.includes('LENS is earned, not bought')) wrong.push('Overview still says "LENS is earned, not bought"')
  if (seen.overview.converts) wrong.push('Overview still offers the conversion itself')

  return wrong.length === 0
    ? { pass: true, detail: `Settings leads sharing with the saving and links the royalty to Royalties; Royalties sits under Statements, calls a royalty a side effect and carries the conversion (LENS ${seen.lens}); /earnings lands there; Billing funds the agents; Overview converts nothing` }
    : { pass: false, detail: wrong.join('; ') }
}

/** Opens a screen and waits for words it always shows, so a read never races the app's first render. */
async function opened(ctx: ScenarioCtx, at: string, shows: string): Promise<Page> {
  const page = await ctx.app.tab(at)
  await page.getByText(shows, { exact: false }).first().waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
  return page
}

async function mainText(page: Page): Promise<string> {
  return (await page.locator('main').first().innerText().catch(() => '')).replace(/\s+/g, ' ')
}

export function royaltiesNotHeadline(): Scenario {
  return {
    id: 'royalties-not-headline',
    owner: 'talyvor-suite',
    items: ['B28.10'],
    title: 'sharing is a saving first: Settings leads with it and links the royalty to Royalties, under Statements, which carries the conversion; /earnings lands there and Billing funds the agents',
    run: async (ctx) => {
      const balance = await ctx.env.lens.act<{ balance_ulens: number; held_balance_ulens?: number }>(ctx.app.user, 'GET', '/v1/workspaces/{ws}/tokens/balance')
      if (!balance.ok) return fail(`Lens answered ${balance.status} for this workspace's LENS: ${balance.error}`)
      const lens = balance.value.balance_ulens > 0 ? 'spendable' : (balance.value.held_balance_ulens ?? 0) > 0 ? 'held' : 'none'

      const settings = await opened(ctx, '/settings', SHARING_HEADER)
      let sharing: RoyaltiesSeen['sharing']
      let royalties: RoyaltiesSeen['royalties']
      try {
        // The card is the innermost box holding both its heading and the two sides of the choice.
        const header = settings.getByRole('heading', { name: /^Shar(ed|ing) answers/ }).first()
        const card = settings.locator('div', { has: header }).filter({ hasText: 'If sharing is on' }).last()
        const headerText = (await header.innerText().catch(() => '')).trim()
        const body = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ')
        const after = body.indexOf(headerText)
        await card.getByRole('link', { name: 'Royalties', exact: true }).first().click({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        await settings.getByTestId('royalties-framing').waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        sharing = { header: headerText, body: after >= 0 ? body.slice(after + headerText.length) : body, link: settings.url() }
        await settings.getByText('Convert to LXC').first().waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        // The conversion's own words load after the region's label: wait for whichever this workspace's LENS calls for.
        await settings.getByText(/LENS is earned, not bought|Only spendable LENS converts|Convert to LXC…/).first().waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        royalties = {
          framing: (await settings.getByTestId('royalties-framing').innerText().catch(() => '')).replace(/\s+/g, ' '),
          text: await mainText(settings),
        }
      } finally {
        await settings.close()
      }
      ctx.evidence.push({ note: `Settings: "${sharing.header}" — ${sharing.body.slice(0, 400)}; its Royalties link went to ${sharing.link}` })
      ctx.evidence.push({ note: `Royalties (LENS ${lens}): ${royalties.framing.slice(0, 300)}` })

      const old = await opened(ctx, '/earnings', 'Royalties')
      let earnings: string
      try {
        await old.waitForURL((u) => u.pathname !== '/earnings', { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        earnings = old.url()
      } finally {
        await old.close()
      }

      const billingPage = await opened(ctx, '/billing', 'Fund your agents')
      let billing: RoyaltiesSeen['billing']
      let nav: RoyaltiesSeen['nav']
      try {
        // On Billing its own nav group is open, which is where Earnings used to be listed.
        nav = await billingPage.locator('nav[aria-label="Sections"] a').evaluateAll((as) =>
          as.map((a) => ({
            name: (a.textContent ?? '').trim(),
            href: a.getAttribute('href') ?? '',
            x: Math.round((a.querySelector('svg') ?? a).getBoundingClientRect().left),
          })),
        )
        const text = await mainText(billingPage)
        await billingPage.locator('main').getByRole('link', { name: 'Fund your agents' }).first().click({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        await billingPage.waitForURL((u) => u.pathname !== '/billing', { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        billing = { text, fund: billingPage.url() }
      } finally {
        await billingPage.close()
      }
      ctx.evidence.push({ note: `/earnings landed on ${earnings}; Billing's Fund your agents went to ${billing.fund}; the sidebar: ${nav.map((l) => `${l.name} ${l.href} @${l.x}`).join(', ')}` })

      const overviewPage = await opened(ctx, '/overview', 'LENS')
      let overview: RoyaltiesSeen['overview']
      try {
        await overviewPage.getByText(/Convert to LXC/).first().waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        overview = {
          text: await mainText(overviewPage),
          converts: (await overviewPage.locator('main').getByRole('button', { name: 'Convert to LXC…' }).count()) > 0,
        }
      } finally {
        await overviewPage.close()
      }

      return royaltiesVerdict({ sharing, royalties, lens, earnings, nav, billing, overview })
    },
  }
}
