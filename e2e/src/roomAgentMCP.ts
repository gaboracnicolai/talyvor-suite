// B32.88 — an agent in a room over MCP (Lens B32.36), within its rules, once a run, on a Free workspace of its own.
//
// The owner opens a public room whose spend policy is members_with_spend. A second company joins and proposes two
// prompts, one at 100,000 µUSD a use and one at 500,000. A third company joins, creates an agent, sets its limit per
// request to 2,000,000 µLXC ($0.20), funds it for its model calls and gives it a key. Over POST /mcp with that key the
// agent joins the room (room_join), posts (room_post), proposes a skill (room_propose), votes for the $0.10 prompt
// (room_vote) and runs it paying itself (room_run, pay self). Lens's reads are the oracle. The run is one billed row for
// the listing (market_uses) on the third company's marketplace bill — it is the buyer — with the agent as its agent, at
// 1,000,000 µLXC, and the room's run message (room_messages, kind run) is the agent's and names that use. The $0.50
// prompt run the same way is isError naming the agent's limit per request, and its listing has no row on any bill.
// Paying room is isError naming may_spend, which the owner never gave the third company. The agent's post carries its
// name (author_agent_name).
//
// No read of Lens's returns agent_tool_calls rows, so they are counted where Lens counts them: an agent makes at most
// LENS_ROOM_MESSAGES_PER_MINUTE room calls a minute, counted on those rows, refused calls among them. After its seven
// calls the agent reads the room (room_messages) until it is refused; within the minute that refusal comes after exactly
// LENS_ROOM_MESSAGES_PER_MINUTE − 7 reads only if each of the seven — the two refused runs too — has its row. No read of
// Lens's returns a market_uses row's room_id either, so the room is read where Lens shows it: the run message in the
// room, whose refs name the use. The operator closes the room at the end, so a nightly run leaves nothing in the
// directory people read.

import { fail } from './bank.ts'
import type { BillLine, LensRoomMessage, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

/** The item's amounts: the two prompts' prices (µUSD), the agent's limit per request, and the $0.10 prompt's billed price (µLXC). */
const CHEAP_USD_MICROS = 100_000
const DEAR_USD_MICROS = 500_000
const MAX_PER_REQUEST_ULXC = 2_000_000
const CHEAP_ULXC = 1_000_000
/** What the agent is funded with for the model calls its run makes on its own key (µLXC). */
const FUND_ULXC = 1_000_000
/** The agent's room calls before it reads the room until refused: join, post, propose, vote and three runs. */
const CALLS = 7
/** The most reads it makes looking for the minute's limit, and how long its calls may take for all to count in it. */
const PROBES_MAX = 60
const WINDOW_MS = 55_000

/** Lens rooms.Contribution as POST /v1/rooms/{id}/contributions and room_propose answer it. */
interface Contribution { id: string; listing_id: string; author_workspace_id: string; status?: string; tally?: number }
/** Lens market.Use as a run answers it. */
interface Use { id: string; listing_id: string; charge: string; price_ulxc: number; agent_id?: string }
/** Lens rooms.RunResult. */
interface RunResult { use?: Use; pay: string; payer_workspace_id: string; message?: LensRoomMessage }
/** One tools/call as Lens answered it: refused is a result marked isError; text is its first content's text. */
interface ToolAnswer { status: number; ok: boolean; refused: boolean; text: string }

export function roomAgentMCP(i: number): Scenario {
  return {
    id: 'room-agent-mcp',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: `an agent with its own key takes part in a room over MCP — joins, posts under its name, proposes a skill, votes — and runs a $0.10 contribution ` +
      `paying itself: one billed use of ${CHEAP_ULXC} µLXC on its owner's bill with the agent as its agent, named by the room's run message; the $0.50 one ` +
      `is isError naming its limit per request and bills nothing; paying room is isError without may_spend; every call has its agent_tool_calls row`,
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to approve a held contribution and close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const made = await lens.act<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title: `Agents check ${i}-${RUN_SALT}`, topic: `e2e-room-agent-${RUN_SALT}`, visibility: 'public',
          description: 'A nightly test room; the testers close it when they are done.', terms: { spend_policy: 'members_with_spend' },
        })
        ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens a public room, members_with_spend: ${said(made)}` })
        if (!made.ok) return fail(`opening a public room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const first = await lens.room(owner, id)

        // A second company proposes the two prompts; a third joins.
        const [author, company] = await lens.createUsers(2)
        for (const [who, what] of [[author, 'a second company'], [company, 'a third company']] as const) {
          const joined = await lens.act(who, 'POST', `${room}/join`, { terms_version: first.terms.version })
          ctx.evidence.push({ note: `${what} (${who.workspaceID}) joins: ${said(joined)}` })
          if (!joined.ok) return fail(`${what} joining the public room was refused: ${said(joined)}`)
        }
        const template = `Name one risk in launching {{product}} next week, in one line. (agent check ${RUN_SALT})`
        const propose = async (title: string, price: number): Promise<Contribution | string> => {
          const proposed = await lens.act<Contribution>(author, 'POST', `${room}/contributions`,
            { kind: 'prompt', title, artifact: { template, model: ctx.env.judgeModel }, price_usd_micros: price }, { 'Idempotency-Key': `e2e-room-agent-${price}-${id}` })
          ctx.evidence.push({ note: `the second company proposes "${title}" at ${price} µUSD: ${said(proposed)}` })
          if (!proposed.ok) return `the second company's ${price} µUSD contribution was refused: ${said(proposed)}`
          const listed = await lens.listing(author, proposed.value.listing_id)
          if (!listed.ok) return `the author reads its contribution's listing ${proposed.value.listing_id}: ${said(listed)}`
          if (listed.value.review_status !== 'approved') {
            const ok = await lens.moderate(proposed.value.listing_id, 'approve')
            ctx.evidence.push({ note: `its listing was ${listed.value.review_status}; the operator approves it: ${said(ok)}` })
            if (!ok.ok) return `approving the contribution's listing ${proposed.value.listing_id}, held for review, was refused: ${said(ok)}`
          }
          return proposed.value
        }
        const cheap = await propose(`One launch risk ${RUN_SALT}`, CHEAP_USD_MICROS)
        if (typeof cheap === 'string') return fail(cheap)
        const dear = await propose(`Every launch risk ${RUN_SALT}`, DEAR_USD_MICROS)
        if (typeof dear === 'string') return fail(dear)

        // The third company's agent: its limit per request, money for its model calls, and its own key.
        const agent = await lens.createAgent(company, `Room scout ${i}`)
        const rules = await lens.agentRules(company, agent.id)
        const ruled = await lens.act<{ max_per_request_ulxc: number }>(company, 'PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { ...rules, max_per_request_ulxc: MAX_PER_REQUEST_ULXC })
        ctx.evidence.push({ note: `the third company creates ${agent.name} (${agent.id}) and sets its limit per request to ${MAX_PER_REQUEST_ULXC} µLXC: ${said(ruled)}` })
        if (!ruled.ok || ruled.value.max_per_request_ulxc !== MAX_PER_REQUEST_ULXC) return fail(`${agent.name}'s limit per request of ${MAX_PER_REQUEST_ULXC} µLXC was answered ${said(ruled)}`)
        const book = await lens.agentBook(company)
        if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the third company has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC its agent is funded`)
        const funded = await lens.act(company, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/fund`, { amount_ulxc: FUND_ULXC }, { 'Idempotency-Key': `e2e-room-agent-fund-${id}` })
        if (!funded.ok) return fail(`funding ${agent.name} ${FUND_ULXC} µLXC was refused: ${said(funded)}`)
        const k = await lens.act<{ key: string }>(company, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'room-agent-mcp' })
        if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${said(k)}`)

        // One JSON-RPC tools/call on POST /mcp with the agent's own key.
        let rpc = 0
        const tool = async (name: string, args: Record<string, unknown>): Promise<ToolAnswer> => {
          const got = await lens.as(k.value.key, 'POST', '/mcp', { jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: { room_id: id, ...args } } })
          ctx.evidence.push({ note: `${agent.name} calls ${name} ${JSON.stringify(args)}`, answer: `${got.status} ${got.text.slice(0, 400)}` })
          let body: { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } } = {}
          try {
            body = JSON.parse(got.text) as typeof body
          } catch {
            // not JSON: the status and the text say what happened
          }
          const refused = body.result?.isError === true
          return { status: got.status, ok: got.status === 200 && body.result !== undefined && !refused, refused, text: body.result?.content?.[0]?.text ?? body.error?.message ?? got.text.slice(0, 300) }
        }
        const valueOf = <T>(t: ToolAnswer): T | undefined => {
          try {
            return JSON.parse(t.text) as T
          } catch {
            return undefined
          }
        }
        const answered = (t: ToolAnswer) => `${t.status}${t.refused ? ' isError' : ''} ${t.text.slice(0, 300)}`

        // The seven calls, the first timed: every one of them must be counted within the same minute.
        const started = Date.now()
        const joined = await tool('room_join', {})
        const member = valueOf<{ agent_id: string; workspace_id: string }>(joined)
        if (!joined.ok || member?.agent_id !== agent.id || member.workspace_id !== company.workspaceID) {
          return fail(`room_join should put ${agent.name} in the room as the third company's agent; Lens answered ${answered(joined)}`)
        }
        const words = `I can turn these into a checklist (${RUN_SALT}).`
        const posted = await tool('room_post', { body: words })
        const message = valueOf<{ id: string; author_agent_id?: string; author_agent_name?: string; author_workspace_id: string }>(posted)
        if (!posted.ok || message?.author_agent_id !== agent.id || message.author_agent_name !== agent.name || message.author_workspace_id !== company.workspaceID) {
          return fail(`room_post should be a message by ${agent.name} (${agent.id}) carrying its name, for the third company; Lens answered ${answered(posted)}`)
        }
        const skill = await tool('room_propose', { kind: 'skill', title: `Launch checklist ${RUN_SALT}`, idempotency_key: `e2e-room-agent-skill-${id}`,
          artifact: { instructions: 'Turn the risks named in the room into a checklist, one line each.', model: ctx.env.judgeModel } })
        const offered = valueOf<Contribution>(skill)
        if (!skill.ok || offered?.author_workspace_id !== company.workspaceID || offered.status !== 'proposed') {
          return fail(`room_propose of a skill should be a proposed contribution of the third company's; Lens answered ${answered(skill)}`)
        }
        const voted = await tool('room_vote', { contribution_id: cheap.id, vote: 1 })
        if (!voted.ok || valueOf<Contribution>(voted)?.tally !== 1) return fail(`room_vote +1 on the $0.10 prompt should tally 1; Lens answered ${answered(voted)}`)
        const variables = { product: 'a budgeting app for agents' }
        const ran = await tool('room_run', { target: cheap.id, variables, pay: 'self' })
        const run = valueOf<RunResult>(ran)
        const use = run?.use
        if (!ran.ok || use === undefined) return fail(`room_run of the $0.10 prompt paying itself, within ${agent.name}'s ${MAX_PER_REQUEST_ULXC} µLXC limit per request, was answered ${answered(ran)}`)
        const over = await tool('room_run', { target: dear.id, variables, pay: 'self' })
        const onRoom = await tool('room_run', { target: cheap.id, variables, pay: 'room' })

        // Reading the room until refused: the count Lens keeps of the agent's room calls, its agent_tool_calls rows.
        let reads = 0
        let limited: ToolAnswer | undefined
        while (reads < PROBES_MAX) {
          const read = await tool('room_messages', { limit: 1 })
          if (read.refused) {
            limited = read
            break
          }
          if (!read.ok) return fail(`room_messages, read by ${agent.name} in the room it joined, was answered ${answered(read)}`)
          reads++
        }
        const took = Date.now() - started

        // The runs: one billed use on the third company's bill by the agent; nothing for the $0.50 run or paying room.
        if (run?.pay !== 'self' || run.payer_workspace_id !== company.workspaceID || use.listing_id !== cheap.listing_id || use.charge !== 'billed' ||
          use.price_ulxc !== CHEAP_ULXC || use.agent_id !== agent.id) {
          return fail(`${agent.name}'s run paying itself is use ${use.id} of ${use.listing_id}, ${use.charge} at ${use.price_ulxc} µLXC by agent ${use.agent_id ?? 'none'}, paid ${run?.pay} ` +
            `by ${run?.payer_workspace_id} — not of ${cheap.listing_id}, billed at ${CHEAP_ULXC} µLXC by ${agent.id}, paid self by the third company ${company.workspaceID}`)
        }
        if (!over.refused || !over.text.includes('limit per request')) {
          return fail(`room_run of the $0.50 prompt, above ${agent.name}'s ${MAX_PER_REQUEST_ULXC} µLXC limit per request, should be isError naming its limit per request; Lens answered ${answered(over)}`)
        }
        if (!onRoom.refused || !onRoom.text.includes('may_spend')) {
          return fail(`room_run paying room, by an agent whose owner was never given may_spend, should be isError naming may_spend; Lens answered ${answered(onRoom)}`)
        }
        const rows = async (who: SyntheticUser, listing: string): Promise<BillLine[]> => ((await lens.marketBill(who)).lines ?? []).filter((l) => l.listing_id === listing)
        const billed = await rows(company, cheap.listing_id)
        ctx.evidence.push({ note: `the $0.10 prompt's listing ${cheap.listing_id} on the third company's bill: ${JSON.stringify(billed)}` })
        if (billed.length !== 1 || billed[0].use_id !== use.id || billed[0].agent_id !== agent.id || billed[0].price_ulxc !== CHEAP_ULXC) {
          return fail(`the third company's bill holds ${JSON.stringify(billed)} for listing ${cheap.listing_id}, not ${agent.name}'s use ${use.id} alone at ${CHEAP_ULXC} µLXC by ${agent.id}`)
        }
        const stray = [...await rows(company, dear.listing_id), ...await rows(owner, dear.listing_id), ...await rows(owner, cheap.listing_id)]
        if (stray.length > 0) {
          return fail(`the refused runs were billed: the $0.50 prompt's listing ${dear.listing_id} or the owner's bill (paying room) holds ${JSON.stringify(stray)}`)
        }

        // The room: the agent's post under its name, and one run message, the agent's, naming the use it paid itself.
        const all = await lens.roomMessages(owner, id)
        const mine = all.find((m) => m.id === message.id)
        const runs = all.filter((m) => m.kind === 'run')
        ctx.evidence.push({ note: `the room's run messages: ${JSON.stringify(runs).slice(0, 600)}` })
        if (mine === undefined || mine.body !== words || mine.author_agent_id !== agent.id || mine.author_agent_name !== agent.name) {
          return fail(`the room shows ${agent.name}'s post as ${JSON.stringify(mine)}, not "${words}" by ${agent.id} under the name ${agent.name}`)
        }
        const r = runs[0]
        if (runs.length !== 1 || r.refs?.use_id !== use.id || r.refs.pay !== 'self' || r.refs.payer_workspace_id !== company.workspaceID ||
          r.refs.contribution_id !== cheap.id || r.author_agent_id !== agent.id) {
          return fail(`room ${id} holds ${runs.length} run message(s), not one by ${agent.name} naming use ${use.id}, paid self by the third company, of contribution ${cheap.id}: ` +
            JSON.stringify(runs.map((m) => ({ by: m.author_agent_id, refs: m.refs }))).slice(0, 400))
        }

        // Every call has its row: the minute's limit came after exactly (limit − seven) reads.
        if (limited === undefined) {
          throw new CannotTest(`${agent.name} read the room ${PROBES_MAX} times after its ${CALLS} calls and was not refused: LENS_ROOM_MESSAGES_PER_MINUTE is above ` +
            `${CALLS + PROBES_MAX}, more than the scenario reads to count its agent_tool_calls rows`)
        }
        const limit = Number(/at most (\d+) room calls a minute/.exec(limited.text)?.[1] ?? NaN)
        if (!limited.text.includes('LENS_ROOM_MESSAGES_PER_MINUTE') || !Number.isInteger(limit)) {
          return fail(`after ${CALLS + reads} room calls, ${agent.name} was refused ${answered(limited)} — not the minute's limit, naming LENS_ROOM_MESSAGES_PER_MINUTE`)
        }
        if (took > WINDOW_MS) throw new CannotTest(`${agent.name}'s calls took ${took} ms, past the minute LENS_ROOM_MESSAGES_PER_MINUTE counts its agent_tool_calls rows in`)
        if (CALLS + reads !== limit) {
          return fail(`Lens refused ${agent.name} at its limit of ${limit} room calls a minute after ${CALLS} calls and ${reads} reads: ` +
            (CALLS + reads > limit ? `${CALLS + reads - limit} of its calls have no agent_tool_calls row` : `it counts ${limit - CALLS - reads} more agent_tool_calls rows than calls`) +
            ' — the two refused runs and paying room are calls too')
        }
        return {
          pass: true,
          detail: `in room ${id}, ${agent.name} joined over MCP, posted under its name, proposed a skill and voted; its run of the $0.10 prompt paying itself is use ${use.id}, ` +
            `the one row for its listing on its owner's bill, billed ${CHEAP_ULXC} µLXC by ${agent.id}, named by the room's one run message; the $0.50 run was isError ` +
            `naming its limit per request and paying room isError naming may_spend, neither billed; Lens refused its call after ${CALLS} calls and ${reads} reads at its ` +
            `limit of ${limit} a minute, so each has its agent_tool_calls row`,
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
