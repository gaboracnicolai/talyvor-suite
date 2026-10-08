// B32.86 — runs in a room (Lens B32.33), on Lens's API, once a run, on a Free workspace of its own.
//
// The owner opens a public room whose spend policy is members_with_spend and whose default price is 100,000 µUSD a use,
// funds its wallet and sets its monthly limit to 1,500,000 µLXC. A second company joins and proposes a prompt; a third
// joins, is given may_spend, posts a message and runs the prompt paid by the room (POST /v1/rooms/{id}/runs, pay room).
// Lens's reads are the oracle. The use is billed at 1,000,000 µLXC with the room's wallet as its agent, and the
// market_uses row it writes is on the owner's marketplace bill — the owner is its buyer — and on no bill of the runner's;
// the room's run message (room_messages, kind run) is the runner's, and its refs carry the use, the wallet and the owner
// as payer. The same run again would take the wallet past its monthly limit: 403 naming it, and the owner's bill still
// holds the one row. Paid by the runner itself (pay self) the run writes a second billed row, on the runner's bill and
// with no agent. Asking the room's AI on the room's budget (POST /v1/rooms/{id}/ask) answers, and the room gets a run
// message carrying the question and the answer. The operator closes the room at the end, so a nightly run leaves nothing
// in the directory people read.
//
// No read of Lens's returns a market_uses row's room_id or actor_workspace_id, so the room and the runner are read where
// Lens shows them: the run message in the room, by the runner, whose refs name the use.

import { fail } from './bank.ts'
import type { BillLine, LensClient, LensRoomMessage, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

/** The item's amounts: the room's default price (µUSD), the wallet's monthly limit and funding, and a use's price (µLXC). */
const DEFAULT_PRICE_USD_MICROS = 100_000
const MONTHLY_LIMIT_ULXC = 1_500_000
const FUND_ULXC = 5_000_000
const PRICE_ULXC = 1_000_000

/** Lens market.Use as a run answers it. */
interface Use { id: string; listing_id: string; charge: string; price_ulxc: number; agent_id?: string; output?: string }
/** Lens rooms.RunResult: the use or the AI's answer, who paid, and the room's run message. */
interface RunResult { use?: Use; answer?: string; pay: string; payer_workspace_id: string; message?: LensRoomMessage; message_error?: string }
/** Lens rooms.Contribution as POST /v1/rooms/{id}/contributions answers it. */
interface Contribution { id: string; listing_id: string; author_workspace_id: string }

/** One request as `who` makes it: Lens's status and its whole body. */
async function raw<T>(lens: LensClient, who: SyntheticUser, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await lens.as(who.token, method, path.replace('{ws}', who.workspaceID), body, headers)
  let parsed: T | undefined
  try {
    parsed = JSON.parse(r.text) as T
  } catch {
    parsed = undefined
  }
  return { status: r.status, body: parsed, text: r.text.slice(0, 400) }
}

export function roomRuns(i: number): Scenario {
  return {
    id: 'room-runs',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: `a member given may_spend runs a room's contribution on the room's budget: one billed use of ${PRICE_ULXC} µLXC on the owner's bill with the room's wallet ` +
      `as its agent, and a run message naming it; again past the wallet's ${MONTHLY_LIMIT_ULXC} µLXC monthly limit it is 403 naming it and bills nothing; ` +
      "paid by the member it is a second billed use on the member's bill; the room's AI answers a question on the room's budget, posted to the room",
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to approve a held contribution and close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const title = `Runs check ${i}-${RUN_SALT}`
        const made = await lens.act<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title, topic: `e2e-room-runs-${RUN_SALT}`, visibility: 'public', description: 'A nightly test room; the testers close it when they are done.',
          terms: { spend_policy: 'members_with_spend', default_price_usd_micros: DEFAULT_PRICE_USD_MICROS },
        })
        ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens a public room, members_with_spend at ${DEFAULT_PRICE_USD_MICROS} µUSD a use: ${said(made)}` })
        if (!made.ok) return fail(`opening a public room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const first = await lens.room(owner, id)
        const wallet = first.wallet
        if (wallet === undefined || wallet.agent_id === '') return fail(`Lens shows the owner of room ${id} no wallet`)
        if (first.terms.spend_policy !== 'members_with_spend' || first.terms.default_price_usd_micros !== DEFAULT_PRICE_USD_MICROS) {
          return fail(`room ${id}'s terms read spend policy ${first.terms.spend_policy} at ${first.terms.default_price_usd_micros} µUSD, not members_with_spend at ${DEFAULT_PRICE_USD_MICROS}`)
        }

        // The wallet: funded, and a monthly limit room for one use and not two.
        const book = await lens.agentBook(owner)
        if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC the wallet is funded`)
        const funded = await lens.act(owner, 'POST', `/v1/workspaces/{ws}/agents/${wallet.agent_id}/fund`, { amount_ulxc: FUND_ULXC }, { 'Idempotency-Key': `e2e-room-runs-${id}` })
        ctx.evidence.push({ note: `the owner funds the wallet ${wallet.agent_id} ${FUND_ULXC} µLXC: ${said(funded)}` })
        if (!funded.ok) return fail(`funding room ${id}'s wallet was refused: ${said(funded)}`)
        const rules = await lens.agentRules(owner, wallet.agent_id)
        const limited = await lens.act(owner, 'PUT', `/v1/workspaces/{ws}/agents/${wallet.agent_id}/rules`, { ...rules, monthly_limit_ulxc: MONTHLY_LIMIT_ULXC })
        ctx.evidence.push({ note: `the owner sets the wallet's monthly limit to ${MONTHLY_LIMIT_ULXC} µLXC: ${said(limited)}` })
        if (!limited.ok) return fail(`a monthly limit of ${MONTHLY_LIMIT_ULXC} µLXC on room ${id}'s wallet was refused: ${said(limited)}`)

        // A second company proposes a prompt; a third joins, is given may_spend and posts.
        const [author, runner] = await lens.createUsers(2)
        for (const [who, what] of [[author, 'a second company'], [runner, 'a third company']] as const) {
          const joined = await lens.act(who, 'POST', `${room}/join`, { terms_version: first.terms.version })
          ctx.evidence.push({ note: `${what} (${who.workspaceID}) joins: ${said(joined)}` })
          if (!joined.ok) return fail(`${what} joining the public room was refused: ${said(joined)}`)
        }
        const template = `Name one risk in launching {{product}} next week, in one line. (room check ${RUN_SALT})`
        const proposed = await raw<Contribution>(lens, author, 'POST', `${room}/contributions`,
          { kind: 'prompt', title: `One launch risk ${RUN_SALT}`, artifact: { template, model: ctx.env.judgeModel } }, { 'Idempotency-Key': `e2e-room-runs-contribute-${id}` })
        ctx.evidence.push({ note: `the second company proposes a prompt: ${proposed.status} ${proposed.text}` })
        if (proposed.status !== 201 || proposed.body?.id === undefined) return fail(`the second company's contribution was answered ${proposed.status} ${proposed.text}`)
        const work = proposed.body
        const listed = await raw<{ review_status: string }>(lens, author, 'GET', `/v1/marketplace/listings/${encodeURIComponent(work.listing_id)}`)
        if (listed.status !== 200 || listed.body === undefined) return fail(`the author reads its contribution's listing ${work.listing_id} as ${listed.status} ${listed.text}`)
        if (listed.body.review_status !== 'approved') {
          const ok = await lens.moderate(work.listing_id, 'approve')
          ctx.evidence.push({ note: `the contribution's listing was ${listed.body.review_status}; the operator approves it: ${said(ok)}` })
          if (!ok.ok) return fail(`approving the contribution's listing ${work.listing_id}, held for review, was refused: ${said(ok)}`)
        }
        const given = await lens.act(owner, 'PATCH', `${room}/members/${encodeURIComponent(runner.workspaceID)}`, { may_spend: true })
        ctx.evidence.push({ note: `the owner gives the third company may_spend: ${said(given)}` })
        if (!given.ok) return fail(`the owner giving the third company may_spend was refused: ${said(given)}`)
        const posted = await lens.act(runner, 'POST', `${room}/messages`, { body: `Let's see what the prompt says about the launch (${RUN_SALT}).` })
        if (!posted.ok) return fail(`the third company's message to the room was refused: ${said(posted)}`)

        /** The bill's rows for the contribution's listing, on `who`'s bill. */
        const rows = async (who: SyntheticUser): Promise<BillLine[]> => ((await lens.marketBill(who)).lines ?? []).filter((l) => l.listing_id === work.listing_id)
        const runs = async (): Promise<LensRoomMessage[]> => (await lens.roomMessages(owner, id)).filter((m) => m.kind === 'run')
        const run = (pay: 'room' | 'self') => raw<RunResult>(lens, runner, 'POST', `${room}/runs`,
          { target: work.id, variables: { product: 'a budgeting app for agents' }, pay })
        const ownerBefore = await rows(owner)
        const runnerBefore = await rows(runner)
        if (ownerBefore.length + runnerBefore.length > 0) return fail(`before any run, the bills hold rows for listing ${work.listing_id}: ${JSON.stringify([...ownerBefore, ...runnerBefore])}`)

        // Paid by the room: one billed row bought by the owner, its agent the wallet, and a run message naming it.
        const onRoom = await run('room')
        ctx.evidence.push({ note: `the third company runs it, pay room: ${onRoom.status} ${onRoom.text}` })
        const use = onRoom.body?.use
        if (onRoom.status !== 200 || use === undefined) return fail(`a run on the room's budget by a member given may_spend was answered ${onRoom.status} ${onRoom.text}`)
        if (onRoom.body?.pay !== 'room' || onRoom.body.payer_workspace_id !== owner.workspaceID) {
          return fail(`a run on the room's budget was paid ${onRoom.body?.pay} by ${onRoom.body?.payer_workspace_id}, not room by the owner ${owner.workspaceID}`)
        }
        if (use.listing_id !== work.listing_id || use.charge !== 'billed' || use.price_ulxc !== PRICE_ULXC || use.agent_id !== wallet.agent_id) {
          return fail(`the room's run is use ${use.id} of ${use.listing_id}, charge ${use.charge} at ${use.price_ulxc} µLXC by agent ${use.agent_id ?? 'none'} — ` +
            `not of ${work.listing_id}, billed at ${PRICE_ULXC} µLXC by the wallet ${wallet.agent_id}`)
        }
        const ownerRows = await rows(owner)
        const runnerRows = await rows(runner)
        ctx.evidence.push({ note: `listing ${work.listing_id} on the owner's bill: ${JSON.stringify(ownerRows)}; on the runner's: ${JSON.stringify(runnerRows)}` })
        if (ownerRows.length !== 1 || ownerRows[0].use_id !== use.id || ownerRows[0].agent_id !== wallet.agent_id || ownerRows[0].price_ulxc !== PRICE_ULXC) {
          return fail(`after one run on the room's budget, the owner's bill holds ${JSON.stringify(ownerRows)} for listing ${work.listing_id}, not use ${use.id} alone at ${PRICE_ULXC} µLXC by the wallet ${wallet.agent_id}`)
        }
        if (runnerRows.length !== 0) return fail(`a run on the room's budget is on the runner's own bill: ${JSON.stringify(runnerRows)}`)
        const told = (await runs()).filter((m) => m.refs?.use_id === use.id)
        ctx.evidence.push({ note: `the room's run messages naming use ${use.id}: ${JSON.stringify(told)}` })
        const m = told[0]
        if (told.length !== 1 || m.author_workspace_id !== runner.workspaceID || m.refs?.pay !== 'room' || m.refs.payer_workspace_id !== owner.workspaceID ||
          m.refs.wallet_agent_id !== wallet.agent_id || m.refs.charge !== 'billed' || m.refs.contribution_id !== work.id) {
          return fail(`room ${id} holds ${told.length} run message(s) naming use ${use.id}: ${JSON.stringify(told).slice(0, 400)} — not one by the runner ${runner.workspaceID}, ` +
            `paid room by the owner from the wallet ${wallet.agent_id}, billed, for contribution ${work.id}`)
        }

        // Again: past the wallet's monthly limit, refused naming it, and nothing more billed or posted.
        const runsBefore = (await runs()).length
        const again = await run('room')
        ctx.evidence.push({ note: `the same run again, pay room: ${again.status} ${again.text}` })
        if (again.status !== 403 || !again.text.includes('monthly limit')) {
          return fail(`a second run of ${PRICE_ULXC} µLXC on a wallet whose monthly limit is ${MONTHLY_LIMIT_ULXC} µLXC was answered ${again.status} ${again.text}, not 403 naming its monthly limit`)
        }
        const afterRefusal = await rows(owner)
        const runsAfter = (await runs()).length
        if (afterRefusal.length !== 1 || (await rows(runner)).length !== 0) {
          return fail(`the run refused past the monthly limit was billed anyway: the owner's bill holds ${afterRefusal.length} rows for listing ${work.listing_id}: ${JSON.stringify(afterRefusal)}`)
        }
        if (runsAfter !== runsBefore) return fail(`the run refused past the monthly limit posted ${runsAfter - runsBefore} run message(s) to the room`)

        // Paid by the member itself: a second billed row, bought by the runner.
        const onSelf = await run('self')
        ctx.evidence.push({ note: `the third company runs it, pay self: ${onSelf.status} ${onSelf.text}` })
        const own = onSelf.body?.use
        if (onSelf.status !== 200 || own === undefined) return fail(`a run on the member's own account was answered ${onSelf.status} ${onSelf.text}`)
        if (onSelf.body?.pay !== 'self' || onSelf.body.payer_workspace_id !== runner.workspaceID) {
          return fail(`a run on the member's own account was paid ${onSelf.body?.pay} by ${onSelf.body?.payer_workspace_id}, not self by ${runner.workspaceID}`)
        }
        const selfRows = await rows(runner)
        const ownerAfter = await rows(owner)
        ctx.evidence.push({ note: `listing ${work.listing_id} on the runner's bill: ${JSON.stringify(selfRows)}; on the owner's: ${ownerAfter.length} row(s)` })
        if (own.charge !== 'billed' || own.price_ulxc !== PRICE_ULXC || selfRows.length !== 1 || selfRows[0].use_id !== own.id || selfRows[0].price_ulxc !== PRICE_ULXC ||
          (selfRows[0].agent_id ?? '') !== '') {
          return fail(`a run on the member's own account is use ${own.id}, ${own.charge} at ${own.price_ulxc} µLXC, and the runner's bill holds ${JSON.stringify(selfRows)} — ` +
            `not one billed row of ${PRICE_ULXC} µLXC with no agent`)
        }
        if (ownerAfter.length !== 1) return fail(`a run on the member's own account changed the owner's bill: ${JSON.stringify(ownerAfter)}`)
        if (!(await runs()).some((x) => x.refs?.use_id === own.id && x.refs.pay === 'self' && x.author_workspace_id === runner.workspaceID)) {
          return fail(`room ${id} has no run message by the runner naming its own use ${own.id}, paid self`)
        }

        // The room's AI, asked on the room's budget: an answer, and the question and the answer in the room.
        const question = `What is this room testing? (${RUN_SALT})`
        const asked = await raw<RunResult>(lens, runner, 'POST', `${room}/ask`, { question, model: ctx.env.judgeModel, pay: 'room' })
        ctx.evidence.push({ note: `the third company asks the room's AI, pay room: ${asked.status} ${asked.text}` })
        const answer = (asked.body?.answer ?? '').trim()
        if (asked.status !== 200 || answer === '' || asked.body?.pay !== 'room') return fail(`asking the room's AI on the room's budget was answered ${asked.status} ${asked.text}`)
        const posts = (await runs()).filter((x) => x.refs?.run === 'ask' && x.author_workspace_id === runner.workspaceID)
        ctx.evidence.push({ note: `the room's ask messages by the runner: ${JSON.stringify(posts).slice(0, 600)}` })
        if (posts.length !== 1 || !posts[0].body.includes(question) || !posts[0].body.includes(answer.slice(0, 80))) {
          return fail(`room ${id} holds ${posts.length} ask message(s) by the runner, not one carrying the question "${question}" and the answer: ${JSON.stringify(posts).slice(0, 400)}`)
        }
        return {
          pass: true,
          detail: `in room ${id}, a member given may_spend ran contribution ${work.id} on the room's budget: use ${use.id} billed ${PRICE_ULXC} µLXC on the owner's bill by the wallet ` +
            `${wallet.agent_id}, named by the runner's run message; again past the ${MONTHLY_LIMIT_ULXC} µLXC monthly limit it was 403 naming it and billed nothing; ` +
            `on its own account it was use ${own.id}, billed ${PRICE_ULXC} µLXC on its own bill; the room's AI answered on the room's budget, and the room got the question and the answer`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
