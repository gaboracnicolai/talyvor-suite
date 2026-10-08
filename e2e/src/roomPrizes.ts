// B32.87 — a room's prizes (Lens B32.35), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room, funds its wallet and sets its monthly limit to 600,000,000 µLXC ($60), with the amount
// above which a spend waits for its approval set above the prize, so the award is not held for one. A second company
// joins and proposes a prompt. A $70 prize is more than the room's budget has left: 403, and Lens holds no prize and the
// room no prize message for it. A $50 prize is posted, and a $5 one due in seconds. The owner awards the $50 prize to
// the contribution. Lens's reads are the oracle: the owner's marketplace bill holds exactly one row for the
// contribution's listing (market_uses), billed at 500,000,000 µLXC with the room's wallet as its agent, and the owner
// holds one licence to it (market_licences) — kind prize, source prize, commercial, ends_at null — whose use is that
// row. Once the owner's bill is paid, the contribution's author earns its share of the $50 at the take Lens states, and
// Talyvor the rest. The $5 prize, past its deadline, has closed unawarded; awarding it then is 409, and the bill still
// holds the one row. The room holds four prize messages (room_messages, kind prize): two posted, one awarded, one
// closed. The operator closes the room at the end, so a nightly run leaves nothing in the directory people read.
//
// No read of Lens's returns a market_uses row's use_kind, so it is read where Lens shows it: the licence the prize
// bought is of kind prize, and its use is the bill's row.

import { fail } from './bank.ts'
import { keptOf } from './fees.ts'
import type { BillLine, LensRoomMessage, LensRoomPrize, MarketLicence } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'
import { payBill } from './trade.ts'

/** The item's amounts: the wallet's monthly limit and funding (µLXC), and the three prizes (µUSD). */
const MONTHLY_LIMIT_ULXC = 600_000_000
const FUND_ULXC = 5_000_000
const OVER_USD_MICROS = 70_000_000
const PRIZE_USD_MICROS = 50_000_000
const CLOSING_USD_MICROS = 5_000_000
/** One µUSD is ten µLXC at the peg: the $50 prize's billed price. */
const PRIZE_ULXC = PRIZE_USD_MICROS * 10
/** How far past the closing prize's deadline it is read, for the clocks of this machine and Lens's. */
const CLOCK_SKEW_MS = 5_000

/** Lens rooms.Contribution as POST /v1/rooms/{id}/contributions answers it. */
interface Contribution { id: string; listing_id: string; author_workspace_id: string }
/** Lens rooms.Award: the prize as awarded, and the owner's licence to what won it. */
interface Award { prize: LensRoomPrize; licence: MarketLicence }

/** `closesInMs`: how long after it is posted the unawarded prize's deadline falls. */
export function roomPrizes(i: number, closesInMs = 30_000): Scenario {
  return {
    id: 'room-prizes',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: `a room's owner posts a prize within the room's budget and awards it to a contribution: one billed prize use of ${PRIZE_ULXC} µLXC on the owner's bill ` +
      `with the room's wallet as its agent and a perpetual commercial licence, cleared to the author at Lens's take once paid; a prize above the ` +
      `budget is 403 and kept nowhere; one past its deadline closes unawarded and bills nothing; the room is told of each`,
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to approve a held contribution and close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Prizes check ${i}-${RUN_SALT}`, topic: `e2e-room-prizes-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.',
        })
        ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens a public room: ${said(made)}` })
        if (!made.ok) return fail(`opening a public room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const first = await lens.room(owner, id)
        const wallet = first.wallet
        if (wallet === undefined || wallet.agent_id === '') return fail(`Lens shows the owner of room ${id} no wallet`)

        // The wallet: funded, and a monthly limit of $60 that no approval amount holds a $50 prize under.
        const book = await lens.agentBook(owner)
        if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC the wallet is funded`)
        const funded = await lens.act(owner, 'POST', `/v1/workspaces/{ws}/agents/${wallet.agent_id}/fund`, { amount_ulxc: FUND_ULXC }, { 'Idempotency-Key': `e2e-room-prizes-${id}` })
        ctx.evidence.push({ note: `the owner funds the wallet ${wallet.agent_id} ${FUND_ULXC} µLXC: ${said(funded)}` })
        if (!funded.ok) return fail(`funding room ${id}'s wallet was refused: ${said(funded)}`)
        const rules = await lens.agentRules(owner, wallet.agent_id)
        const limited = await lens.act(owner, 'PUT', `/v1/workspaces/{ws}/agents/${wallet.agent_id}/rules`, {
          ...rules, monthly_limit_ulxc: MONTHLY_LIMIT_ULXC, approval_above_ulxc: MONTHLY_LIMIT_ULXC,
          max_per_request_ulxc: rules.max_per_request_ulxc === 0 ? 0 : Math.max(rules.max_per_request_ulxc, MONTHLY_LIMIT_ULXC),
        })
        ctx.evidence.push({ note: `the owner sets the wallet's monthly limit to ${MONTHLY_LIMIT_ULXC} µLXC, approvals above it: ${said(limited)}` })
        if (!limited.ok) return fail(`a monthly limit of ${MONTHLY_LIMIT_ULXC} µLXC on room ${id}'s wallet was refused: ${said(limited)}`)

        // A second company joins and proposes a prompt.
        const [author] = await lens.createUsers(1)
        const joined = await lens.act(author, 'POST', `${room}/join`, { terms_version: first.terms.version })
        ctx.evidence.push({ note: `a second company (${author.workspaceID}) joins: ${said(joined)}` })
        if (!joined.ok) return fail(`a second company joining the public room was refused: ${said(joined)}`)
        const template = `Name the riskiest assumption in launching {{product}}, in one line. (prize check ${RUN_SALT})`
        const proposed = await lens.act<Contribution>(author, 'POST', `${room}/contributions`,
          { kind: 'prompt', title: `Riskiest assumption ${RUN_SALT}`, artifact: { template, model: ctx.env.judgeModel } }, { 'Idempotency-Key': `e2e-room-prizes-contribute-${id}` })
        ctx.evidence.push({ note: `the second company proposes a prompt: ${said(proposed)}` })
        if (!proposed.ok) return fail(`the second company's contribution was refused: ${said(proposed)}`)
        const work = proposed.value
        const listed = await lens.listing(author, work.listing_id)
        if (!listed.ok) return fail(`the author reads its contribution's listing ${work.listing_id}: ${said(listed)}`)
        if (listed.value.review_status !== 'approved') {
          const ok = await lens.moderate(work.listing_id, 'approve')
          ctx.evidence.push({ note: `the contribution's listing was ${listed.value.review_status}; the operator approves it: ${said(ok)}` })
          if (!ok.ok) return fail(`approving the contribution's listing ${work.listing_id}, held for review, was refused: ${said(ok)}`)
        }

        /** The owner's bill's rows and licences for the contribution's listing; the room's prize messages. */
        const rows = async (): Promise<BillLine[]> => ((await lens.marketBill(owner)).lines ?? []).filter((l) => l.listing_id === work.listing_id)
        const licences = async (): Promise<MarketLicence[] | string> => {
          const held = await lens.act<{ licences: MarketLicence[] | null }>(owner, 'GET', '/v1/workspaces/{ws}/marketplace/licences')
          return held.ok ? (held.value.licences ?? []).filter((l) => l.listing_id === work.listing_id) : `reading the owner's licences: ${said(held)}`
        }
        const told = async (): Promise<LensRoomMessage[]> => (await lens.roomMessages(owner, id)).filter((m) => m.kind === 'prize')
        const prize = (title: string, amount: number, deadline: number) => lens.act<LensRoomPrize>(owner, 'POST', `${room}/prizes`,
          { title, criteria: 'The clearest single risk, in one line.', amount_usd_micros: amount, deadline: new Date(deadline).toISOString() })
        const inADay = Date.now() + 86_400_000

        // $70 against a $60 budget: refused, and kept nowhere.
        const over = await prize(`Too large ${RUN_SALT}`, OVER_USD_MICROS, inADay)
        ctx.evidence.push({ note: `the owner posts a $70 prize: ${said(over)}` })
        if (over.ok || over.status !== 403 || !over.error.includes('budget')) {
          return fail(`a $70 prize against the wallet's ${MONTHLY_LIMIT_ULXC} µLXC monthly limit was answered ${said(over)}, not 403 naming the room's budget`)
        }
        const keptOver = await lens.roomPrizes(owner, id)
        const toldOver = await told()
        if (keptOver.length + toldOver.length > 0) {
          return fail(`the $70 prize refused over the room's budget was kept: Lens lists ${JSON.stringify(keptOver)} and the room holds ${toldOver.length} prize message(s)`)
        }

        // $50, and $5 due in seconds.
        const posted = await prize(`Best launch risk ${RUN_SALT}`, PRIZE_USD_MICROS, inADay)
        ctx.evidence.push({ note: `the owner posts a $50 prize: ${said(posted)}` })
        if (!posted.ok || posted.value.status !== 'open' || posted.value.amount_usd_micros !== PRIZE_USD_MICROS) {
          return fail(`a $50 prize within the room's $60 budget was answered ${said(posted)}, not an open prize of ${PRIZE_USD_MICROS} µUSD`)
        }
        const closesAt = Date.now() + closesInMs
        const brief = await prize(`Quickest answer ${RUN_SALT}`, CLOSING_USD_MICROS, closesAt)
        ctx.evidence.push({ note: `the owner posts a $5 prize due ${new Date(closesAt).toISOString()}: ${said(brief)}` })
        if (!brief.ok) return fail(`a $5 prize within the $10 the room's budget has left was answered ${said(brief)}`)

        // The $50 prize awarded: one billed prize row on the owner's bill, by the wallet, and a perpetual commercial licence.
        const awarded = await lens.act<Award>(owner, 'POST', `${room}/prizes/${encodeURIComponent(posted.value.id)}/award`, { contribution_id: work.id })
        ctx.evidence.push({ note: `the owner awards the $50 prize to contribution ${work.id}: ${said(awarded)}` })
        if (!awarded.ok) return fail(`awarding the $50 prize to the second company's contribution was refused: ${said(awarded)}`)
        const won = awarded.value.prize
        const lic = awarded.value.licence
        if (won.status !== 'awarded' || won.contribution_id !== work.id || won.winner_workspace_id !== author.workspaceID || won.use_id !== lic.use_id || won.licence_id !== lic.id) {
          return fail(`the award reads ${JSON.stringify(won)} with licence ${lic.id} on use ${lic.use_id} — not awarded to ${work.id} by ${author.workspaceID} on that use and licence`)
        }
        const billed = await rows()
        ctx.evidence.push({ note: `listing ${work.listing_id} on the owner's bill: ${JSON.stringify(billed)}` })
        if (billed.length !== 1 || billed[0].use_id !== lic.use_id || billed[0].price_ulxc !== PRIZE_ULXC || billed[0].agent_id !== wallet.agent_id) {
          return fail(`after the award, the owner's bill holds ${JSON.stringify(billed)} for listing ${work.listing_id}, not use ${lic.use_id} alone at ${PRIZE_ULXC} µLXC by the wallet ${wallet.agent_id}`)
        }
        const held = await licences()
        if (typeof held === 'string') return fail(held)
        ctx.evidence.push({ note: `the owner's licences to listing ${work.listing_id}: ${JSON.stringify(held)}` })
        const l = held[0]
        if (held.length !== 1 || l.id !== lic.id || l.kind !== 'prize' || l.source !== 'prize' || l.licence !== 'commercial' || l.ends_at !== null ||
          l.use_id !== lic.use_id || l.charge !== 'billed' || l.price_ulxc !== PRIZE_ULXC || l.agent_id !== wallet.agent_id) {
          return fail(`the owner holds ${JSON.stringify(held)} for listing ${work.listing_id}, not one perpetual commercial licence ${lic.id} of kind and source prize, ` +
            `bought by the wallet ${wallet.agent_id} on billed use ${lic.use_id} at ${PRIZE_ULXC} µLXC`)
        }

        // Paid: the author earns its share of the $50 at the take Lens states, and Talyvor the rest.
        const paid = await payBill(ctx)
        if (typeof paid === 'string') return fail(paid)
        const take = (await lens.fees()).market_take_bps
        const share = keptOf(PRIZE_USD_MICROS, take)
        const earned = ((await lens.marketEarnings(author)).earnings ?? []).find((x) => x.use_id === lic.use_id)
        ctx.evidence.push({ note: `the owner's bill paid (${paid.invoice_id}); the author's earning from the prize: ${JSON.stringify(earned)}` })
        if (earned === undefined || earned.gross_usd_micros !== PRIZE_USD_MICROS || earned.share_usd_micros !== share || earned.fee_usd_micros !== PRIZE_USD_MICROS - share) {
          return fail(`once paid, the prize cleared to the author as ${JSON.stringify(earned)}, not gross ${PRIZE_USD_MICROS}, the author's ${share} and Talyvor's ${PRIZE_USD_MICROS - share} µUSD at ${take} bps`)
        }

        // The $5 prize, past its deadline: closed unawarded, and awarding it now bills nothing.
        const wait = closesAt + CLOCK_SKEW_MS - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        const closed = (await lens.roomPrizes(owner, id)).find((x) => x.id === brief.value.id)
        ctx.evidence.push({ note: `the $5 prize past its deadline: ${JSON.stringify(closed)}` })
        if (closed?.status !== 'closed') return fail(`the $5 prize ${brief.value.id}, ${CLOCK_SKEW_MS / 1000} s past its deadline, reads ${JSON.stringify(closed)}, not closed`)
        const late = await lens.act(owner, 'POST', `${room}/prizes/${encodeURIComponent(brief.value.id)}/award`, { contribution_id: work.id })
        ctx.evidence.push({ note: `the owner awards the closed $5 prize: ${said(late)}` })
        const after = await rows()
        const heldAfter = await licences()
        if (after.length !== 1 || typeof heldAfter === 'string' || heldAfter.length !== 1) {
          return fail(`awarding the $5 prize closed at its deadline was answered ${said(late)}, and the owner's bill now holds ${after.length} rows for listing ${work.listing_id}: ` +
            `${JSON.stringify(after)}; licences: ${JSON.stringify(heldAfter)}`)
        }
        if (late.ok || late.status !== 409) return fail(`awarding the $5 prize closed at its deadline was answered ${said(late)}, not 409`)

        // The room: told of the two prizes posted, the one awarded and the one closed.
        const messages = await told()
        ctx.evidence.push({ note: `the room's prize messages: ${JSON.stringify(messages).slice(0, 800)}` })
        const one = (what: string, prizeID: string) => messages.filter((m) => m.refs?.prize === what && m.refs.prize_id === prizeID)
        const award = one('awarded', posted.value.id)
        if (messages.length !== 4 || one('posted', posted.value.id).length !== 1 || one('posted', brief.value.id).length !== 1 || award.length !== 1 ||
          one('closed', brief.value.id).length !== 1 || award[0]?.refs?.use_id !== lic.use_id || award[0]?.refs?.licence_id !== lic.id) {
          return fail(`room ${id} holds ${messages.length} prize message(s), not four — the $50 and the $5 posted, the $50 awarded on use ${lic.use_id}, the $5 closed: ` +
            JSON.stringify(messages.map((m) => m.refs)).slice(0, 400))
        }
        return {
          pass: true,
          detail: `in room ${id}, a $70 prize was 403 over the $60 budget and kept nowhere; the $50 prize awarded to contribution ${work.id} is use ${lic.use_id}, ` +
            `the one row for its listing on the owner's bill, billed ${PRIZE_ULXC} µLXC by the wallet ${wallet.agent_id}, with the owner's perpetual commercial prize licence ${lic.id}; ` +
            `paid, it cleared ${share} µUSD to the author and ${PRIZE_USD_MICROS - share} to Talyvor; the $5 prize closed at its deadline, its award 409 with no row; ` +
            'the room got four prize messages: two posted, one awarded, one closed',
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
