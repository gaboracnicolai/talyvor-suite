// B32.90 — DISCOVERY. Lens's search, collections and trending (B32.50), on two workspaces of the run's own:
//   market-discovery — a seller publishes three listings with capabilities: extract at $0.04 a use and extract at $0.06,
//        both declared on the publish, and summarize at $0.01, declared after with PUT …/capabilities. Searched by
//        capability=extract and max_price_per_use=50000 (µUSD: $0.05), the $0.04 one is found and neither of the others,
//        and every hit declares extract and is billed at most $0.05 a use. Two controls make each absence mean its
//        filter: without the price the $0.06 one is found, and by capability=summarize the summarize one. A curator,
//        another workspace, publishes a public collection of the summarize and the $0.06 listings, in that order — not
//        the order they were published in —, and read by the seller it lists exactly those two in that order. The
//        operator features it, and the public collections list it first — ahead of an unfeatured one the curator makes
//        after it, which a list ordered only by the latest change would put first. Trending is computed nightly, so
//        sort=trending is held only to every hit carrying its distinct_buyers_7d and trending_score. The collections are
//        deleted after.
//   market-discover-screen — B32.61: the same search and a collection on the app's Discover screen. A seller publishes an
//        extract listing at $0.04 a use and one at $0.06; Discover opened filtered by capability extract and at most $0.05
//        a use shows the $0.04 one and not the $0.06 one, and a curator's public collection of the $0.06 then the $0.04
//        listing, opened from its link, shows exactly those two in that order. Lens's own reads of the search and the
//        collection are asked too, so a fault is the screen's only where Lens answered right; where Lens did not, it SKIPs.
// Nothing is used or bought, so nothing is charged. A listing the similarity check holds (another night's of the same
// words) is approved by the operator first, as a person would: what is tested here is how it is found.

import type { Page } from 'playwright'
import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { verdictOf } from './gateway.ts'
import type { Answered, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

/** µLXC to the µUSD (Lens market.ulxcPerUSDMicro). */
const ULXC_PER_USD_MICRO = 10
/** The search's price ceiling, $0.05 a use, and the three listings' prices around it. */
export const MAX_PRICE_USD_MICROS = 50_000
const CHEAP_USD_MICROS = 40_000
const DEAR_USD_MICROS = 60_000
const OTHER_USD_MICROS = 10_000
/** The most pages of a search read looking for the run's own listings: they are the newest, on the first. */
const PAGES = 4

/** A listing a search found (Lens market.DiscoverHit). */
export interface Hit {
  id: string
  title: string
  capabilities?: string[] | null
  price_per_use_usd_micros: number | null
  distinct_buyers_7d?: unknown
  trending_score?: unknown
}

/** One page of a search (market.DiscoverPage). */
interface SearchPage { listings: Hit[]; sort: string; page: number; total: number; has_more: boolean }

/** A collection (market.Collection): its listings on a read of it alone. */
export interface Collection { id: string; title: string; public: boolean; featured: boolean; listing_count: number; listings?: { id: string }[] }

/** The run's three listings. */
export interface Mine { cheap: string; dear: string; other: string }

/** What is wrong with the capability-and-price search: the $0.04 extract listing missing, the $0.06 or the summarize one returned, or a hit outside the filter. */
export function searchFaults(hits: readonly Hit[], mine: Mine): string[] {
  const wrong: string[] = []
  const has = (id: string) => hits.some((h) => h.id === id)
  if (!has(mine.cheap)) wrong.push(`the $0.04 extract listing ${mine.cheap} is not found`)
  if (has(mine.dear)) wrong.push(`the $0.06 extract listing ${mine.dear} is found, above max_price_per_use ${MAX_PRICE_USD_MICROS}`)
  if (has(mine.other)) wrong.push(`the summarize listing ${mine.other} is found for capability=extract`)
  for (const h of hits) {
    if (h.id === mine.dear || h.id === mine.other) continue
    if (!(h.capabilities ?? []).includes('extract')) wrong.push(`${h.id} "${h.title}" is found for capability=extract and declares ${JSON.stringify(h.capabilities ?? [])}`)
    if (h.price_per_use_usd_micros === null || h.price_per_use_usd_micros > MAX_PRICE_USD_MICROS) {
      wrong.push(`${h.id} "${h.title}" is found under max_price_per_use ${MAX_PRICE_USD_MICROS} and is billed ${String(h.price_per_use_usd_micros)} µUSD a use`)
    }
  }
  return wrong
}

/** What is wrong with a trending page: none found, or a hit without the figures it is ranked by. */
export function trendingFaults(hits: readonly Hit[]): string[] {
  if (hits.length === 0) return ['sort=trending found no listing']
  return hits.filter((h) => typeof h.distinct_buyers_7d !== 'number' || typeof h.trending_score !== 'number')
    .map((h) => `${h.id} carries distinct_buyers_7d ${JSON.stringify(h.distinct_buyers_7d)} and trending_score ${JSON.stringify(h.trending_score)}`)
}

/** What is wrong with a read of the collection: its listings not exactly `want`, in that order. */
export function collectionFaults(read: Collection, want: readonly string[]): string[] {
  const got = (read.listings ?? []).map((l) => l.id)
  return got.length === want.length && got.every((id, i) => id === want[i]) ? []
    : [`the collection lists ${JSON.stringify(got)}, not ${JSON.stringify(want)} in that order`]
}

/** What is wrong with the public collections once `id` is featured: it is not first, or not marked featured. */
export function featuredFaults(list: readonly Collection[], id: string): string[] {
  const at = list.findIndex((c) => c.id === id)
  if (at < 0) return [`the featured collection ${id} is not among the ${list.length} public collections`]
  const wrong = at === 0 ? [] : [`the featured collection ${id} is listed at ${at + 1}, after ${list[0].id} "${list[0].title}"`]
  if (!list[at].featured) wrong.push(`the featured collection ${id} reads featured false`)
  return wrong
}

const said = (a: Answered<unknown>): string => a.ok ? `${a.status} ${JSON.stringify(a.value).slice(0, 300)}` : `refused ${a.status}: ${a.error}`

/** Every hit of a search, page by page, up to PAGES; or what Lens said instead. */
async function search(ctx: ScenarioCtx, user: SyntheticUser, query: string): Promise<Hit[] | string> {
  const hits: Hit[] = []
  for (let page = 1; page <= PAGES; page++) {
    const r = await ctx.env.lens.act<SearchPage>(user, 'GET', `/v1/marketplace/search?${query}&page=${page}`)
    if (!r.ok) return `GET /v1/marketplace/search?${query}&page=${page}: ${said(r)}`
    hits.push(...r.value.listings)
    if (!r.value.has_more) break
  }
  ctx.evidence.push({ note: `search ${query}: ${hits.length} found — ${hits.slice(0, 8).map((h) => `${h.id} ${JSON.stringify(h.capabilities ?? [])} ${String(h.price_per_use_usd_micros)} µUSD`).join(', ')}${hits.length > 8 ? ', …' : ''}` })
  return hits
}

/**
 * A prompt listing `seller` publishes for the run, sold per use at `usdMicros` on a commercial licence and approved: its
 * id. A listing the similarity check holds (another night's of the same words) is approved by the operator first.
 */
async function publishPriced(ctx: ScenarioCtx, seller: SyntheticUser, title: string, template: string, usdMicros: number, capabilities?: string[]): Promise<string> {
  const { lens } = ctx.env
  const pub = await lens.publishListing(seller, { title: `${title} ${RUN_SALT}`, template: `${template} (${RUN_SALT})`, priceULXC: usdMicros * ULXC_PER_USD_MICRO, model: ctx.env.judgeModel, capabilities })
  ctx.evidence.push({ note: `published "${title}": ${said(pub)}` })
  if (!pub.ok) throw new Error(`publishing "${title}" was refused: ${pub.status} ${pub.error}`)
  const id = pub.value.id
  const offers = await lens.act(seller, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${id}/offers`, { offers: [{ kind: 'per_use', licence: 'commercial', price_usd_micros: usdMicros }] })
  if (!offers.ok) throw new Error(`pricing "${title}" at ${usdMicros} µUSD a use was refused: ${said(offers)}`)
  if (pub.value.review_status !== 'approved') {
    const ok = await lens.moderate(id, 'approve')
    ctx.evidence.push({ note: `"${title}" was ${pub.value.review_status}; the operator approves it: ${said(ok)}` })
    if (!ok.ok) throw new Error(`approving the held listing ${id}: ${said(ok)}`)
  }
  return id
}

export function marketDiscovery(): Scenario {
  return {
    id: 'market-discovery',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: 'searched by capability=extract under $0.05 a use, the marketplace finds the $0.04 extract listing and neither the $0.06 one nor a summarize one; ' +
      "a public collection lists exactly its two listings in its curator's order, and featured by the operator it is the first public collection; every trending hit carries its distinct buyers and score",
    run: async (ctx) => {
      const { env } = ctx
      const { lens } = env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to feature a collection: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const seller = ctx.app.user
      const publish = (title: string, template: string, usdMicros: number, capabilities?: string[]) =>
        publishPriced(ctx, seller, title, template, usdMicros, capabilities)
      const mine: Mine = {
        cheap: await publish('Extract dates', 'Extract every date in this text, one per line: {{text}}', CHEAP_USD_MICROS, ['extract']),
        dear: await publish('Extract names', 'Extract every person named in this text, one per line: {{text}}', DEAR_USD_MICROS, ['extract']),
        other: await publish('Summarise', 'Summarise this text in one line: {{text}}', OTHER_USD_MICROS),
      }
      const caps = await lens.act<{ capabilities: string[] }>(seller, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${mine.other}/capabilities`, { capabilities: ['summarize'] })
      ctx.evidence.push({ note: `the summarize listing's capabilities: ${said(caps)}` })
      if (!caps.ok || caps.value.capabilities.join() !== 'summarize') return fail(`declaring summarize on ${mine.other} with PUT …/capabilities: ${said(caps)}`)

      const wrong: string[] = []
      const found = await search(ctx, seller, `capability=extract&max_price_per_use=${MAX_PRICE_USD_MICROS}&sort=new`)
      if (typeof found === 'string') return fail(found)
      wrong.push(...searchFaults(found, mine))
      const unpriced = await search(ctx, seller, 'capability=extract&sort=new')
      if (typeof unpriced === 'string') return fail(unpriced)
      if (!unpriced.some((h) => h.id === mine.dear)) wrong.push(`the control: the $0.06 extract listing ${mine.dear} is not found by capability=extract with no price, so its absence under $0.05 proves nothing`)
      const summaries = await search(ctx, seller, 'capability=summarize&sort=new')
      if (typeof summaries === 'string') return fail(summaries)
      if (!summaries.some((h) => h.id === mine.other)) wrong.push(`the control: the summarize listing ${mine.other} is not found by capability=summarize, so its absence under extract proves nothing`)

      const trending = await lens.act<SearchPage>(seller, 'GET', '/v1/marketplace/search?sort=trending')
      if (!trending.ok) return fail(`GET /v1/marketplace/search?sort=trending: ${said(trending)}`)
      ctx.evidence.push({ note: `sort=trending, page 1: ${trending.value.listings.slice(0, 5).map((h) => `${h.id} ${String(h.distinct_buyers_7d)} buyers, score ${String(h.trending_score)}`).join(', ')}` })
      wrong.push(...trendingFaults(trending.value.listings))

      const [curator] = await lens.createUsers(1)
      const order = [mine.other, mine.dear]
      const made = await lens.act<Collection>(curator, 'POST', '/v1/workspaces/{ws}/marketplace/collections',
        { title: `Picked ${RUN_SALT}`, description: 'A summary, then the names in it.', public: true, listing_ids: order })
      ctx.evidence.push({ note: `the curator's public collection: ${said(made)}` })
      if (!made.ok) return verdictOf([...wrong, `publishing a public collection of ${order.join(', ')}: ${said(made)}`], '')
      const col = made.value.id
      const curated = [col]
      try {
        const read = await lens.act<Collection>(seller, 'GET', `/v1/marketplace/collections/${col}`)
        ctx.evidence.push({ note: `the collection, read by the seller: ${said(read)}` })
        if (!read.ok) wrong.push(`reading the public collection ${col} as another workspace: ${said(read)}`)
        else wrong.push(...collectionFaults(read.value, order))
        const featured = await lens.featureCollection(col, true)
        ctx.evidence.push({ note: `the operator features it: ${said(featured)}` })
        if (!featured.ok) return verdictOf([...wrong, `featuring ${col}: ${said(featured)}`], '')
        // The control: an unfeatured public collection changed after it, which the most recently changed first would put first.
        const newer = await lens.act<Collection>(curator, 'POST', '/v1/workspaces/{ws}/marketplace/collections',
          { title: `Newer ${RUN_SALT}`, description: 'Changed last, never featured.', public: true, listing_ids: [mine.cheap] })
        ctx.evidence.push({ note: `an unfeatured public collection made after it: ${said(newer)}` })
        if (!newer.ok) return verdictOf([...wrong, `publishing a second public collection: ${said(newer)}`], '')
        curated.push(newer.value.id)
        const listed = await lens.act<{ collections: Collection[] }>(seller, 'GET', '/v1/marketplace/collections')
        if (!listed.ok) return verdictOf([...wrong, `GET /v1/marketplace/collections: ${said(listed)}`], '')
        ctx.evidence.push({ note: `the public collections: ${listed.value.collections.slice(0, 4).map((c) => `${c.id}${c.featured ? ' featured' : ''}`).join(', ')} (${listed.value.collections.length})` })
        wrong.push(...featuredFaults(listed.value.collections, col))
      } finally {
        for (const c of curated) ctx.evidence.push({ note: `${c} deleted: ${said(await lens.act(curator, 'DELETE', `/v1/workspaces/{ws}/marketplace/collections/${c}`))}` })
      }
      return verdictOf(wrong, `capability=extract under ${MAX_PRICE_USD_MICROS} µUSD found the $0.04 listing and not the $0.06 one (found with no price) nor the summarize one (found by summarize), ` +
        `every hit declaring extract at or under $0.05; the collection read ${order.join(', ')} in its order and, featured, was the first public collection, ahead of one changed after it; every trending hit carried its buyers and score`)
    },
  }
}

/** What is wrong with the listings Discover showed for capability=extract under $0.05: the $0.04 one missing, or the $0.06 one shown. */
export function screenFaults(shown: readonly string[], cheap: string, dear: string): string[] {
  const wrong: string[] = []
  if (!shown.includes(cheap)) wrong.push(`Discover filtered by capability extract and at most $0.05 a use does not show "${cheap}" (shows ${JSON.stringify(shown)})`)
  if (shown.includes(dear)) wrong.push(`Discover filtered by capability extract and at most $0.05 a use shows "${dear}", billed $0.06 a use`)
  return wrong
}

/** What is wrong with a collection's page: its listings not exactly `want`, in that order. */
export function collectionPageFaults(shown: readonly string[], want: readonly string[]): string[] {
  return shown.length === want.length && shown.every((t, i) => t === want[i]) ? []
    : [`the collection's page shows ${JSON.stringify(shown)}, not ${JSON.stringify(want)} in that order`]
}

/** The titles of the listing cards in the list named `list` once it is drawn, or none when the screen says nothing matches. */
async function cardTitles(page: Page, list: string): Promise<string[]> {
  const grid = page.getByRole('list', { name: list, exact: true })
  await grid.or(page.getByText(/^Nothing (published matches|in this collection)/)).first().waitFor({ timeout: ACTION_TIMEOUT_MS })
  if (!(await grid.isVisible())) return []
  return (await grid.getByTestId('listing-card').getByRole('link').allInnerTexts()).map((t) => t.trim())
}

export function marketDiscoverScreen(): Scenario {
  return {
    id: 'market-discover-screen',
    owner: 'talyvor-suite',
    feature: 'Marketplace',
    title: 'Discover filtered by capability extract and at most $0.05 a use shows the $0.04 extract listing and not the $0.06 one, ' +
      "and a public collection's page shows exactly its two listings in its curator's order",
    run: async (ctx) => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to approve a listing the similarity check holds: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const seller = ctx.app.user
      const cheapTitle = 'Extract invoice totals'
      const dearTitle = 'Extract street addresses'
      const cheap = await publishPriced(ctx, seller, cheapTitle, 'List every invoice total in this text with its currency: {{text}}', CHEAP_USD_MICROS, ['extract'])
      const dear = await publishPriced(ctx, seller, dearTitle, 'List every postal address in this text, one per line: {{text}}', DEAR_USD_MICROS, ['extract'])
      const titleOf = (t: string) => `${t} ${RUN_SALT}`
      const wrong: string[] = []

      // Lens's own answer first: the screen is at fault only where Lens found the $0.04 one and not the $0.06 one.
      const found = await search(ctx, seller, `capability=extract&max_price_per_use=${MAX_PRICE_USD_MICROS}&sort=new`)
      if (typeof found === 'string') return fail(found)
      if (!found.some((h) => h.id === cheap) || found.some((h) => h.id === dear)) {
        throw new CannotTest(`Lens's own search for capability=extract under $0.05 found ${found.length} listings, ${found.some((h) => h.id === cheap) ? '' : `not the $0.04 one ${cheap}`}` +
          `${found.some((h) => h.id === dear) ? ` and the $0.06 one ${dear}` : ''} — market-discovery owns that; the screen cannot be judged`)
      }
      const discover = await ctx.app.tab(`/marketplace?capability=extract&max=${MAX_PRICE_USD_MICROS / 1_000_000}&sort=new`)
      try {
        const shown = await cardTitles(discover, 'Listings')
        ctx.evidence.push({ note: `Discover, capability extract, at most $0.05, newest first: ${JSON.stringify(shown.slice(0, 10))}${shown.length > 10 ? ' …' : ''}` })
        wrong.push(...screenFaults(shown, titleOf(cheapTitle), titleOf(dearTitle)))
      } finally {
        await discover.close()
      }

      const [curator] = await lens.createUsers(1)
      const order = [dear, cheap]
      const made = await lens.act<Collection>(curator, 'POST', '/v1/workspaces/{ws}/marketplace/collections',
        { title: `Addresses then totals ${RUN_SALT}`, description: 'Two extractors, in the order to run them.', public: true, listing_ids: order })
      ctx.evidence.push({ note: `the curator's public collection: ${said(made)}` })
      if (!made.ok) return verdictOf([...wrong, `publishing a public collection of ${order.join(', ')}: ${said(made)}`], '')
      const col = made.value.id
      try {
        const read = await lens.act<Collection>(seller, 'GET', `/v1/marketplace/collections/${col}`)
        if (!read.ok || collectionFaults(read.value, order).length > 0) {
          const why = `Lens's own read of the collection ${col} is not ${order.join(', ')} in order (${said(read)}) — market-discovery owns that; the page cannot be judged`
          if (wrong.length > 0) return verdictOf(wrong, '')
          throw new CannotTest(why)
        }
        const page = await ctx.app.tab(`/marketplace/collections/${encodeURIComponent(col)}`)
        try {
          const shown = await cardTitles(page, 'Listings in this collection')
          ctx.evidence.push({ note: `the collection's page: ${JSON.stringify(shown)}` })
          wrong.push(...collectionPageFaults(shown, [titleOf(dearTitle), titleOf(cheapTitle)]))
        } finally {
          await page.close()
        }
      } finally {
        ctx.evidence.push({ note: `${col} deleted: ${said(await lens.act(curator, 'DELETE', `/v1/workspaces/{ws}/marketplace/collections/${col}`))}` })
      }
      return verdictOf(wrong, 'Discover filtered by capability extract and at most $0.05 a use showed the $0.04 listing and not the $0.06 one, as Lens found them; ' +
        "the collection's page showed exactly its two listings in its curator's order")
    },
  }
}
