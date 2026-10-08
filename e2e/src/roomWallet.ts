// B32.85 — a room's wallet, its budget and who may spend it (Lens B32.32), on Lens's API, once a run, on a Free
// workspace of its own.
//
// The owner opens a public room whose spend policy is members_with_spend. Its read (GET /v1/rooms/{id}) shows the owner
// the room's wallet, and the owner's agents (GET /v1/workspaces/{ws}/agents) hold exactly one agent of kind room by that
// id, named "Room: <title>", with one key. The owner funds it 5 LXC, and the workspace's statement holds the fund entry's
// two postings: the workspace −5,000,000 µLXC and the wallet +5,000,000. A monthly limit of 1,000,000,001 µLXC — past
// Free's room_budget_max_usd — is 402 naming rooms_plan_limits, plan free and limit room_budget_max_usd, and saves no
// rules (the wallet's rules history stays empty); 100,000,000 µLXC is 200 and one version. A second company joins and
// reads the wallet: may_spend false, why_not naming may_spend; once the owner gives it may_spend its read says true.
// Lens's reads are the oracle. The operator closes the room at the end, so a nightly run leaves nothing in the directory
// people read.

import { fail } from './bank.ts'
import type { AgentRulesVersion, LensClient, LensRoomDetail, SyntheticUser } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario, type Verdict } from './scenarios.ts'

/** The item's amounts: the wallet's funding, a monthly limit past Free's room budget, and one within it — all µLXC. */
const FUND_ULXC = 5_000_000
const OVER_ULXC = 1_000_000_001
const WITHIN_ULXC = 100_000_000

/** Lens economy.Statement as GET /v1/workspaces/{ws}/agents/statement answers it: every account's postings this month. */
interface Statement { lines: { entry_id: string; account: string; kind: string; amount_ulxc: number; counterparty: string }[] | null }
/** Lens's refusal under rooms_plan_limits (cmd/lens writeRoomPlanLimit). */
interface PlanLimit { error: string; setting: string; plan: string; limit: string; max: number; allows: string }

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

export function roomWallet(i: number): Scenario {
  return {
    id: 'room-wallet',
    owner: 'talyvor-lens',
    feature: 'Rooms',
    own: true,
    title: "a room's wallet is one agent of kind room with one key, funded 5 LXC in two postings; a budget past Free's room_budget_max_usd is 402 naming " +
      'rooms_plan_limits and saves no rules, one within it is saved; a member may spend it only once the owner gives it may_spend',
    run: async (ctx): Promise<Verdict> => {
      const { lens } = ctx.env
      if (!lens.canModerate) throw new CannotTest('needs a moderator key to close the public room it opens: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
      const owner = ctx.app.user
      let opened: string | undefined
      try {
        const title = `Wallet check ${i}-${RUN_SALT}`
        const made = await lens.act<{ id: string }>(owner, 'POST', '/v1/workspaces/{ws}/rooms', {
          title, topic: `e2e-room-wallet-${RUN_SALT}`, visibility: 'public', description: 'A nightly test room; the testers close it when they are done.',
          terms: { spend_policy: 'members_with_spend' },
        })
        ctx.evidence.push({ note: `the owner (${owner.workspaceID}) opens a public room, members_with_spend: ${said(made)}` })
        if (!made.ok) return fail(`opening a public room was refused: ${said(made)}`)
        const id = made.value.id
        opened = id
        const room = `/v1/rooms/${encodeURIComponent(id)}`
        const read = async (who: SyntheticUser): Promise<LensRoomDetail> => lens.room(who, id)

        // The wallet: one agent of the owner's, of kind room, named for the room, with one key.
        const first = await read(owner)
        ctx.evidence.push({ note: `GET ${room} as the owner: wallet ${JSON.stringify(first.wallet)}` })
        const wallet = first.wallet
        if (wallet === undefined || wallet.agent_id === '') return fail(`Lens shows the owner of room ${id} no wallet`)
        if (wallet.name !== `Room: ${title}` || first.terms.spend_policy !== 'members_with_spend') {
          return fail(`room ${id}'s wallet is named "${wallet.name}" under spend policy ${first.terms.spend_policy}, not "Room: ${title}" under members_with_spend`)
        }
        const book = await lens.agentBook(owner)
        const rooms = book.agents.filter((a) => a.kind === 'room' && (a.id === wallet.agent_id || a.name === wallet.name))
        ctx.evidence.push({ note: `the owner's agents of kind room for it: ${JSON.stringify(rooms)}` })
        if (rooms.length !== 1 || rooms[0].id !== wallet.agent_id) {
          return fail(`the owner's agents hold ${rooms.length} of kind room for room ${id} (${rooms.map((a) => a.id).join(', ')}), not its wallet ${wallet.agent_id} alone`)
        }
        if ((rooms[0].keys ?? []).length !== 1) return fail(`room ${id}'s wallet ${wallet.agent_id} has keys ${JSON.stringify(rooms[0].keys)}, not the one key it spends with`)

        // Funded 5 LXC: one entry, the workspace's side out and the wallet's in.
        if (book.unallocated_ulxc < FUND_ULXC) throw new CannotTest(`the workspace has ${book.unallocated_ulxc} µLXC free, under the ${FUND_ULXC} µLXC the wallet is funded`)
        const funded = await lens.act(owner, 'POST', `/v1/workspaces/{ws}/agents/${wallet.agent_id}/fund`, { amount_ulxc: FUND_ULXC }, { 'Idempotency-Key': `e2e-room-wallet-${id}` })
        ctx.evidence.push({ note: `the owner funds the wallet ${FUND_ULXC} µLXC: ${said(funded)}` })
        if (!funded.ok) return fail(`funding room ${id}'s wallet ${FUND_ULXC} µLXC was refused: ${said(funded)}`)
        const st = await raw<Statement>(lens, owner, 'GET', '/v1/workspaces/{ws}/agents/statement?format=json')
        if (st.status !== 200 || st.body === undefined) return fail(`the workspace's statement was answered ${st.status} ${st.text}`)
        const lines = st.body.lines ?? []
        const account = `agent:${wallet.agent_id}`
        const funds = lines.filter((l) => l.account === account && l.kind === 'fund')
        if (funds.length !== 1) return fail(`the wallet's account holds ${funds.length} fund postings after one funding: ${JSON.stringify(funds)}`)
        const entry = lines.filter((l) => l.entry_id === funds[0].entry_id).map((l) => `${l.account} ${l.amount_ulxc}`).sort()
        ctx.evidence.push({ note: `the fund entry ${funds[0].entry_id}'s postings: ${entry.join(', ')}` })
        const want = [`${account} ${FUND_ULXC}`, `workspace ${-FUND_ULXC}`].sort()
        if (entry.join(', ') !== want.join(', ')) return fail(`the fund entry ${funds[0].entry_id} posts ${entry.join(', ')}, not ${want.join(', ')}`)

        // The budget: past Free's room_budget_max_usd is refused naming it, and saves nothing; within it is saved once.
        const rules = `/v1/workspaces/{ws}/agents/${wallet.agent_id}/rules`
        const open = await lens.agentRules(owner, wallet.agent_id)
        const over = await raw<PlanLimit>(lens, owner, 'PUT', rules, { ...open, monthly_limit_ulxc: OVER_ULXC })
        ctx.evidence.push({ note: `a monthly limit of ${OVER_ULXC} µLXC: ${over.status} ${over.text}` })
        const r = over.body
        if (over.status !== 402 || r?.setting !== 'rooms_plan_limits' || r.plan !== 'free' || r.limit !== 'room_budget_max_usd') {
          return fail(`a room budget of ${OVER_ULXC} µLXC on Free was answered ${over.status} ${over.text}, not 402 naming rooms_plan_limits, plan free, limit room_budget_max_usd`)
        }
        const history = async () => (await raw<{ versions: AgentRulesVersion[] | null }>(lens, owner, 'GET', `${rules}/history`)).body?.versions ?? []
        const refused = await history()
        const kept = (await lens.agentRules(owner, wallet.agent_id)).monthly_limit_ulxc
        if (refused.length !== 0 || kept !== open.monthly_limit_ulxc) {
          return fail(`the refused budget saved rules: the wallet's rules history holds ${refused.length} versions and its monthly limit reads ${kept} µLXC, not none and ${open.monthly_limit_ulxc}`)
        }
        const within = await lens.act(owner, 'PUT', rules, { ...open, monthly_limit_ulxc: WITHIN_ULXC })
        ctx.evidence.push({ note: `a monthly limit of ${WITHIN_ULXC} µLXC: ${said(within)}` })
        if (!within.ok || within.status !== 200) return fail(`a room budget of ${WITHIN_ULXC} µLXC on Free was answered ${said(within)}`)
        const saved = await history()
        if (saved.length !== 1 || saved[0].rules.monthly_limit_ulxc !== WITHIN_ULXC) {
          return fail(`after one budget saved, the wallet's rules history holds ${JSON.stringify(saved.map((v) => [v.version, v.rules.monthly_limit_ulxc]))}, not one version at ${WITHIN_ULXC} µLXC`)
        }

        // Who may spend it: a member, only once the owner gives it may_spend.
        const [member] = await lens.createUsers(1)
        const joined = await lens.act(member, 'POST', `${room}/join`, { terms_version: first.terms.version })
        ctx.evidence.push({ note: `a second company (${member.workspaceID}) joins: ${said(joined)}` })
        if (!joined.ok) return fail(`a second company joining the public room was refused: ${said(joined)}`)
        const before = (await read(member)).wallet
        ctx.evidence.push({ note: `the member reads the wallet: ${JSON.stringify(before)}` })
        if (before === undefined || before.agent_id !== wallet.agent_id) return fail(`the member of room ${id} reads its wallet as ${JSON.stringify(before)}, not ${wallet.agent_id}`)
        if (before.balance_ulxc !== FUND_ULXC || before.monthly_limit_ulxc !== WITHIN_ULXC) {
          return fail(`the member reads the wallet holding ${before.balance_ulxc} µLXC under a monthly limit of ${before.monthly_limit_ulxc}, not ${FUND_ULXC} under ${WITHIN_ULXC}`)
        }
        if (before.may_spend || !(before.why_not ?? '').includes('may_spend')) {
          return fail(`a member never given may_spend reads the wallet as may_spend ${before.may_spend}, why_not "${before.why_not ?? ''}" — not false, naming may_spend`)
        }
        const given = await lens.act(owner, 'PATCH', `${room}/members/${encodeURIComponent(member.workspaceID)}`, { may_spend: true })
        ctx.evidence.push({ note: `the owner gives the member may_spend: ${said(given)}` })
        if (!given.ok) return fail(`the owner giving the member may_spend was refused: ${said(given)}`)
        const after = (await read(member)).wallet
        ctx.evidence.push({ note: `the member reads the wallet again: ${JSON.stringify(after)}` })
        if (after?.may_spend !== true || after.why_not) {
          return fail(`after the owner gave it may_spend, the member reads the wallet as may_spend ${after?.may_spend}, why_not "${after?.why_not ?? ''}"`)
        }
        return {
          pass: true,
          detail: `room ${id}'s wallet ${wallet.agent_id} is the owner's one agent of kind room, "${wallet.name}", with one key; funded in one entry, workspace −${FUND_ULXC} and wallet +${FUND_ULXC} µLXC; ` +
            `a ${OVER_ULXC} µLXC budget was 402 under rooms_plan_limits (free, room_budget_max_usd) and saved no rules, ${WITHIN_ULXC} µLXC was saved as one version; ` +
            'the member read may_spend false naming may_spend, then true once given it',
        }
      } finally {
        if (opened !== undefined) await lens.moderateRoom(opened, 'close', 'a nightly test room, closed by the testers').catch(() => undefined)
      }
    },
  }
}
