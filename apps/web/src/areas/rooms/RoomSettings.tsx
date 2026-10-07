import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Button, Input, Pill, Row, type PillStatus, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { Approvals, Rules, rulesKey } from '../lens/AgentBank'
import { type Agent, type AgentRules, agentBankApi, formatULXC } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { parsePrice } from '../marketplace/marketApi'
import { Card, Note, pressed, readFailure, selectClass } from '../marketplace/parts'
import {
  type Invite,
  type Member,
  type MemberChange,
  type Prize,
  type RoomDetail,
  type RoomWallet,
  type SpendPolicy,
  type SplitRule,
  ROLES,
  ROOMS_KEY,
  SPEND_POLICIES,
  SPLIT_RULES,
  inviteHref,
  parseShare,
  roomRefusal,
  roomsApi,
  shareText,
  spendPolicyText,
  splitRuleText,
  usdText,
} from './roomsApi'
import { RoomBudget } from './Room'

// RoomSettings.tsx — B32.55: a room's settings, for its owner and its editors, at /rooms/:id/settings. The members
// with their roles and whether each may spend the room's money (Lens B32.28); invite links for a private room, made,
// copied and revoked (B32.29); the room wallet's budget and rules through Agent Wallets' own rules editor, and its
// approvals (B32.32); prizes posted, awarded and closed (B32.35); and the room's terms with their version.
//
// Lens decides everything — an editor manages members and invites; only the owner funds the room, sets its budget and
// rules, posts and awards prizes and changes the terms — and its sentence is shown on a refusal: a budget above what
// the owner's plan allows a room names rooms_plan_limits.

export const roomKey = (id: string) => [...ROOMS_KEY, 'room', id]
const invitesKey = (id: string) => [...ROOMS_KEY, 'invites', id]
const prizesKey = (id: string) => [...ROOMS_KEY, 'prizes', id]

const roomHref = (id: string) => `/rooms/${encodeURIComponent(id)}`

function Who({ ws, me }: { ws: string; me: string }) {
  return ws === me ? (
    <span className="text-ink">You</span>
  ) : (
    <span className="inline-block max-w-xs truncate align-bottom font-figure text-ink" title={ws}>
      {ws}
    </span>
  )
}

// ── Members ────────────────────────────────────────────────────────────────────────────────────────

function MemberRow({ room, m, me }: { room: RoomDetail; m: Member; me: string }) {
  const qc = useQueryClient()
  const change = useMutation({
    mutationFn: (c: MemberChange) => roomsApi.changeMember(room.id, m.workspace_id, c),
    onSuccess: () => qc.invalidateQueries({ queryKey: roomKey(room.id) }),
  })
  const name = m.workspace_id === me ? 'you' : m.workspace_id
  return (
    <li>
      <Row
        stack
        label={<Who ws={m.workspace_id} me={me} />}
        hint={
          m.role === 'owner'
            ? 'Owner — opened the room and spends its money'
            : `${m.terms_current ? 'Under the current terms' : 'Has not accepted the current terms'} · joined ${formatWhen(m.joined_at)}`
        }
      >
        {m.role === 'owner' ? (
          <span className="text-body text-ink">Owner</span>
        ) : (
          <div className="flex w-full flex-col gap-2 wide:w-auto wide:flex-row wide:items-center">
            <select
              aria-label={`Role of ${name}`}
              className={`${selectClass} mt-0 wide:w-32`}
              value={m.role}
              disabled={change.isPending}
              onChange={(e) => change.mutate({ role: e.target.value as 'editor' | 'member' | 'viewer' })}
            >
              {ROLES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              aria-label={`${m.workspace_id === me ? 'You' : m.workspace_id} may spend the room’s money`}
              aria-pressed={m.may_spend}
              className={pressed}
              disabled={change.isPending}
              onClick={() => change.mutate({ may_spend: !m.may_spend })}
            >
              {m.may_spend ? 'May spend' : 'May not spend'}
            </Button>
            <Button aria-label={`Remove ${name}`} disabled={change.isPending} onClick={() => change.mutate({ remove: true })}>
              Remove
            </Button>
          </div>
        )}
      </Row>
      {change.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{roomRefusal(change.error)}</Note>
        </div>
      ) : null}
    </li>
  )
}

function Members({ room, me }: { room: RoomDetail; me: string }) {
  const members = room.members ?? []
  return (
    <Region index="01" label="Members" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">
        An editor manages members and invites; a viewer reads the room. A member who may spend can run things on the
        room’s budget when its terms let members spend — now: {spendPolicyText(room.terms.spend_policy).toLowerCase()}.
      </p>
      {/* The owner is always a member, so the list is never empty. */}
      <Card>
        <ul aria-label="Members">
          {members.map((m) => (
            <MemberRow key={m.workspace_id} room={room} m={m} me={me} />
          ))}
        </ul>
      </Card>
    </Region>
  )
}

// ── Invite links ───────────────────────────────────────────────────────────────────────────────────

const EXPIRIES: readonly [number, string][] = [
  [1, 'In a day'],
  [7, 'In a week'],
  [30, 'In 30 days'],
]

function inviteState(i: Invite): { status: PillStatus; label: string } {
  if (i.live) return { status: 'settled', label: 'Live' }
  if (i.revoked_at) return { status: 'slashed', label: 'Revoked' }
  if (i.uses >= i.max_uses) return { status: 'idle', label: 'Used up' }
  return { status: 'idle', label: 'Expired' }
}

function InviteRow({ room, i }: { room: RoomDetail; i: Invite }) {
  const qc = useQueryClient()
  const revoke = useMutation({
    mutationFn: () => roomsApi.revokeInvite(room.id, i.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitesKey(room.id) }),
  })
  const state = inviteState(i)
  return (
    <li>
      <Row
        stack
        label={
          i.kind === 'named' ? (
            <>
              For <span className="font-figure">{i.workspace_id}</span>
            </>
          ) : (
            <>
              Link · <span className="font-figure">{i.uses}</span> of <span className="font-figure">{i.max_uses}</span> used
            </>
          )
        }
        hint={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <Pill status={state.status}>{state.label}</Pill>
            <span>
              made <span className="font-figure">{formatWhen(i.created_at)}</span>
              {i.expires_at ? (
                <>
                  {' '}
                  · expires <span className="font-figure">{formatWhen(i.expires_at)}</span>
                </>
              ) : null}
            </span>
          </span>
        }
      >
        {i.live ? (
          <Button aria-label={`Revoke invite made ${formatWhen(i.created_at)}`} disabled={revoke.isPending} onClick={() => revoke.mutate()}>
            {revoke.isPending ? 'Revoking…' : 'Revoke'}
          </Button>
        ) : null}
      </Row>
      {revoke.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{roomRefusal(revoke.error)}</Note>
        </div>
      ) : null}
    </li>
  )
}

function Invites({ room }: { room: RoomDetail }) {
  const qc = useQueryClient()
  const [uses, setUses] = useState('10')
  const [days, setDays] = useState(7)
  const [copied, setCopied] = useState<boolean | null>(null)
  const list = useQuery({ queryKey: invitesKey(room.id), queryFn: () => roomsApi.invites(room.id), enabled: room.visibility === 'private' })
  const maxUses = /^\s*\d{1,9}\s*$/.test(uses) && Number(uses) >= 1 ? Number(uses) : null
  const create = useMutation({
    mutationFn: () => roomsApi.createInvite(room.id, maxUses ?? 1, new Date(Date.now() + days * 86_400_000).toISOString()),
    onSuccess: () => {
      setCopied(null)
      void qc.invalidateQueries({ queryKey: invitesKey(room.id) })
    },
  })
  const link = create.data?.token ? `${window.location.origin}${inviteHref(create.data.token)}` : ''
  const copy = () =>
    navigator.clipboard
      .writeText(link)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  return (
    <Region index="02" label="Invite links" className="flex max-w-2xl flex-col gap-3">
      {room.visibility !== 'private' ? (
        <p className="text-body text-muted">Anyone can find and join a public room; invite links are for private rooms.</p>
      ) : (
        <>
          <p className="text-body text-muted">
            A link admits workspaces until it is used up, expires or is revoked. It is shown once, when it is made — copy
            it then.
          </p>
          <Card>
            <form
              className="flex flex-col gap-3 p-gutter"
              onSubmit={(e) => {
                e.preventDefault()
                if (maxUses !== null && !create.isPending) create.mutate()
              }}
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-caption text-muted">
                  How many workspaces it admits
                  <Input
                    className="mt-1 block w-28 font-figure"
                    inputMode="numeric"
                    value={uses}
                    onChange={(e) => setUses(e.target.value)}
                  />
                </label>
                <label className="text-caption text-muted">
                  It expires
                  <select className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {EXPIRIES.map(([d, label]) => (
                      <option key={d} value={d}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" variant="primary" disabled={maxUses === null || create.isPending}>
                  {create.isPending ? 'Making…' : 'Make a link'}
                </Button>
              </div>
              {maxUses === null ? <Note ok={false}>A link admits a whole number of workspaces, at least 1.</Note> : null}
              {link ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input aria-label="Invite link" readOnly className="min-w-0 grow font-figure" value={link} onFocus={(e) => e.target.select()} />
                    <Button onClick={copy}>Copy</Button>
                  </div>
                  {copied === true ? <Note ok>Copied. Send it to the people you want in the room.</Note> : null}
                  {copied === false ? <Note ok={false}>This browser would not copy it — select the link and copy it.</Note> : null}
                </div>
              ) : null}
              {create.isError ? <Note ok={false}>{roomRefusal(create.error)}</Note> : null}
            </form>
          </Card>
          <Card>
            {list.isError ? (
              <p className="p-gutter text-body text-muted">{readFailure(list.error, 'The invites')}</p>
            ) : list.isPending ? (
              <p className="p-gutter text-body text-muted">Reading…</p>
            ) : list.data.length === 0 ? (
              <p className="p-gutter text-body text-muted">No invites yet. Make a link above to invite a workspace.</p>
            ) : (
              <ul aria-label="Invites">
                {list.data.map((i) => (
                  <InviteRow key={i.id} room={room} i={i} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </Region>
  )
}

// ── The room's budget ──────────────────────────────────────────────────────────────────────────────

function budgetMaxText(w: RoomWallet): string {
  return w.budget_max_ulxc < 0
    ? 'Your plan allows a room any budget.'
    : `Your plan allows a room a budget of at most ${formatULXC(w.budget_max_ulxc)} a month.`
}

function Budget({ room, owner }: { room: RoomDetail; owner: boolean }) {
  const w = room.wallet
  // The rules Agent Wallets' editor reads and saves: the budget shown is the monthly limit as last saved.
  const rules = useQuery<AgentRules>({ queryKey: rulesKey(w?.agent_id ?? ''), queryFn: () => agentBankApi.rules(w!.agent_id), enabled: owner && !!w })
  if (!w) {
    return (
      <Region index="03" label="The room’s budget" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">This room has no wallet yet.</p>
      </Region>
    )
  }
  const agent: Agent = { id: w.agent_id, name: w.name, balance_ulxc: w.balance_ulxc, spent_ulxc: w.spent_this_month_ulxc, keys: [], created_at: '' }
  const shown = rules.isSuccess ? { ...w, monthly_limit_ulxc: rules.data.monthly_limit_ulxc } : w
  return (
    <Region index="03" label="The room’s budget" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">
        The room has a wallet of its own, “{w.name}”. Its monthly limit is the room’s budget. {budgetMaxText(w)}
      </p>
      <RoomBudget wallet={shown} />
      {owner ? (
        <>
          <p className="text-body text-muted">
            Fund it as any of your agents, in{' '}
            <Link className={`text-ink ${inlineLink}`} to={`/agents?agent=${encodeURIComponent(w.agent_id)}`}>
              Agent Wallets
            </Link>
            . Set its budget with its monthly limit below.
          </p>
          <Rules agent={agent} agents={[]} />
          <span className="font-figure text-eyebrow uppercase text-label">Its approvals</span>
          <Approvals nameOf={() => w.name} held={{}} onSent={() => undefined} agentId={w.agent_id} />
        </>
      ) : (
        <p className="text-body text-muted">Only the room’s owner funds the room and sets its budget and rules.</p>
      )}
    </Region>
  )
}

// ── Prizes ─────────────────────────────────────────────────────────────────────────────────────────

const PRIZE_STATE: Record<Prize['status'], { status: PillStatus; label: string }> = {
  open: { status: 'held', label: 'Open' },
  awarded: { status: 'settled', label: 'Awarded' },
  closed: { status: 'idle', label: 'Closed' },
}

function PrizeRow({ room, p, owner, titleOf }: { room: RoomDetail; p: Prize; owner: boolean; titleOf: (cid: string) => string }) {
  const qc = useQueryClient()
  const contributions = useQuery({
    queryKey: [...ROOMS_KEY, 'contributions', room.id],
    queryFn: () => roomsApi.contributions(room.id),
    enabled: owner && p.status === 'open',
  })
  const [winner, setWinner] = useState('')
  const award = useMutation({
    mutationFn: () => roomsApi.awardPrize(room.id, p.id, winner),
    onSuccess: () => qc.invalidateQueries({ queryKey: prizesKey(room.id) }),
  })
  const state = PRIZE_STATE[p.status] ?? PRIZE_STATE.closed
  return (
    <li>
      <Row
        stack
        label={
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-ink">{p.title}</span>
            <span className="font-figure text-ink">{usdText(p.amount_usd_micros)}</span>
          </span>
        }
        hint={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <Pill status={state.status}>{state.label}</Pill>
            <span className="whitespace-normal">
              {p.status === 'awarded' ? (
                <>Awarded to “{titleOf(p.contribution_id ?? '')}”</>
              ) : p.status === 'closed' ? (
                'Closed at its deadline unawarded — nothing was charged'
              ) : (
                <>
                  {p.criteria ? `${p.criteria} · ` : ''}closes <span className="font-figure">{formatWhen(p.deadline)}</span>
                </>
              )}
            </span>
          </span>
        }
      >
        {owner && p.status === 'open' ? (
          <div className="flex w-full flex-col gap-2 wide:w-auto wide:flex-row wide:items-center">
            <select
              aria-label={`Winner of ${p.title}`}
              className={`${selectClass} mt-0 wide:w-48`}
              value={winner}
              onChange={(e) => setWinner(e.target.value)}
            >
              <option value="">Choose a contribution</option>
              {(contributions.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <Button aria-label={`Award ${p.title}`} disabled={winner === '' || award.isPending} onClick={() => award.mutate()}>
              {award.isPending ? 'Awarding…' : 'Award'}
            </Button>
          </div>
        ) : null}
      </Row>
      {award.isSuccess ? (
        <div className="px-gutter pb-3">
          <Note ok>
            Awarded. <span className="font-figure">{usdText(p.amount_usd_micros)}</span> is on your marketplace bill, and the
            winner is paid when it clears.
          </Note>
        </div>
      ) : null}
      {award.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{roomRefusal(award.error)}</Note>
        </div>
      ) : null}
    </li>
  )
}

function PostPrize({ room }: { room: RoomDetail }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [criteria, setCriteria] = useState('')
  const [amount, setAmount] = useState('')
  const [deadline, setDeadline] = useState('')
  const micros = parsePrice(amount)
  const ready = title.trim() !== '' && micros !== null && micros > 0 && deadline !== ''
  const post = useMutation({
    mutationFn: () =>
      roomsApi.postPrize(room.id, {
        title: title.trim(),
        criteria: criteria.trim(),
        amount_usd_micros: micros ?? 0,
        deadline: new Date(`${deadline}T23:59:59`).toISOString(),
      }),
    onSuccess: () => {
      setTitle('')
      setCriteria('')
      setAmount('')
      setDeadline('')
      void qc.invalidateQueries({ queryKey: prizesKey(room.id) })
    },
  })
  return (
    <Card>
      <form
        className="flex flex-col gap-3 p-gutter"
        aria-label="Post a prize"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !post.isPending) post.mutate()
        }}
      >
        <label className="flex flex-col gap-1 text-caption text-muted">
          Prize
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          What wins it
          <Input value={criteria} onChange={(e) => setCriteria(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-caption text-muted">
            Amount, in US dollars
            <Input className="mt-1 block w-32 font-figure" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="text-caption text-muted">
            Deadline
            <Input type="date" className="mt-1 block font-figure" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <Button type="submit" variant="primary" disabled={!ready || post.isPending}>
            {post.isPending ? 'Posting…' : 'Post prize'}
          </Button>
        </div>
        {amount.trim() !== '' && (micros === null || micros <= 0) ? (
          <Note ok={false}>A prize is an amount of dollars, like 50 or 12.50.</Note>
        ) : null}
        {post.isError ? <Note ok={false}>{roomRefusal(post.error)}</Note> : null}
      </form>
    </Card>
  )
}

function Prizes({ room, owner }: { room: RoomDetail; owner: boolean }) {
  const list = useQuery({ queryKey: prizesKey(room.id), queryFn: () => roomsApi.prizes(room.id) })
  const contributions = useQuery({ queryKey: [...ROOMS_KEY, 'contributions', room.id], queryFn: () => roomsApi.contributions(room.id) })
  const titleOf = (cid: string) => contributions.data?.find((c) => c.id === cid)?.title ?? cid
  return (
    <Region index="04" label="Prizes" className="flex max-w-2xl flex-col gap-3">
      <p className="text-body text-muted">
        A prize comes out of the room’s budget: at most what this month’s budget has left, less the prizes still open.
        Awarding it buys the winning contribution for your workspace — it goes on your marketplace bill, and the winner is
        paid when that clears. A prize nobody wins closes at its deadline and nothing is charged.
      </p>
      {owner ? <PostPrize room={room} /> : <p className="text-body text-muted">Only the room’s owner posts and awards prizes.</p>}
      <Card>
        {list.isError ? (
          <p className="p-gutter text-body text-muted">{readFailure(list.error, 'The prizes')}</p>
        ) : list.isPending ? (
          <p className="p-gutter text-body text-muted">Reading…</p>
        ) : list.data.length === 0 ? (
          <p className="p-gutter text-body text-muted">No prizes yet. A prize appears here when the room’s owner posts one.</p>
        ) : (
          <ul aria-label="Prizes">
            {list.data.map((p) => (
              <PrizeRow key={p.id} room={room} p={p} owner={owner} titleOf={titleOf} />
            ))}
          </ul>
        )}
      </Card>
    </Region>
  )
}

// ── Terms ──────────────────────────────────────────────────────────────────────────────────────────

function TermsForm({ room }: { room: RoomDetail }) {
  const qc = useQueryClient()
  const t = room.terms
  const [price, setPrice] = useState(() => (t.default_price_usd_micros > 0 ? String(t.default_price_usd_micros / 1_000_000) : ''))
  const [split, setSplit] = useState<SplitRule>(t.split_rule)
  const [share, setShare] = useState(() => (t.remix_share_bps > 0 ? String(t.remix_share_bps / 100) : ''))
  const [spend, setSpend] = useState<SpendPolicy>(t.spend_policy)
  const micros = parsePrice(price)
  const bps = parseShare(share)
  const save = useMutation({
    mutationFn: () =>
      roomsApi.setTerms(room.id, { split_rule: split, remix_share_bps: bps ?? 0, default_price_usd_micros: micros ?? 0, spend_policy: spend }),
    onSuccess: () => qc.invalidateQueries({ queryKey: roomKey(room.id) }),
  })
  const ready = micros !== null && bps !== null
  return (
    <form
      className="flex flex-col gap-3 p-gutter"
      aria-label="Change the terms"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !save.isPending) save.mutate()
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-caption text-muted">
          Default price per use, in US dollars
          <Input className="mt-1 block w-32 font-figure" inputMode="decimal" placeholder="Free" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="text-caption text-muted">
          How earnings are split
          <select className={selectClass} value={split} onChange={(e) => setSplit(e.target.value as SplitRule)}>
            {SPLIT_RULES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-caption text-muted">
          Remix share, in percent
          <Input className="mt-1 block w-32 font-figure" inputMode="decimal" placeholder="0" value={share} onChange={(e) => setShare(e.target.value)} />
        </label>
        <label className="text-caption text-muted">
          Who may spend the room’s money
          <select className={selectClass} value={spend} onChange={(e) => setSpend(e.target.value as SpendPolicy)}>
            {SPEND_POLICIES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {micros === null ? <Note ok={false}>A price is an amount of dollars, like 0.10 — or empty for free.</Note> : null}
      {bps === null ? <Note ok={false}>A remix share is a percentage from 0 to 100, like 12.5.</Note> : null}
      <div>
        <Button type="submit" disabled={!ready || save.isPending}>
          {save.isPending ? 'Saving…' : `Save as version ${t.version + 1}`}
        </Button>
      </div>
      {save.isSuccess ? <Note ok>Saved. Each member accepts the new terms before their next contribution.</Note> : null}
      {save.isError ? <Note ok={false}>{roomRefusal(save.error)}</Note> : null}
    </form>
  )
}

function Terms({ room, owner }: { room: RoomDetail; owner: boolean }) {
  const t = room.terms
  return (
    <Region index="05" label="Terms" className="flex max-w-2xl flex-col gap-3">
      <Card>
        <Row stack label="Version">
          <span className="font-figure text-body text-ink" data-testid="room-terms-version">
            {t.version}
          </span>
        </Row>
        <Row stack label="Default price per use">
          <span className="font-figure text-body text-ink">{usdText(t.default_price_usd_micros)}</span>
        </Row>
        <Row stack label="How earnings are split">
          <span className="text-body text-ink">{splitRuleText(t.split_rule)}</span>
        </Row>
        <Row stack label="Remix share">
          <span className="font-figure text-body text-ink">{shareText(t.remix_share_bps)}</span>
        </Row>
        <Row stack label="Who may spend the room’s money">
          <span className="text-body text-ink">{spendPolicyText(t.spend_policy)}</span>
        </Row>
      </Card>
      {owner ? (
        <Card>
          <TermsForm key={t.version} room={room} />
        </Card>
      ) : (
        <p className="text-body text-muted">Only the room’s owner changes its terms.</p>
      )}
    </Region>
  )
}

// ── The screen ─────────────────────────────────────────────────────────────────────────────────────

export function RoomSettings() {
  const { id = '' } = useParams()
  const room = useQuery({ queryKey: roomKey(id), queryFn: () => roomsApi.room(id) })
  // Another room's settings start afresh: a link made, a prize or terms half typed belong to the room they were for.
  const [stateOf, setStateOf] = useState(id)
  if (stateOf !== id) setStateOf(id)
  const back = (
    <Link className={`text-body text-ink ${inlineLink}`} to={roomHref(id)}>
      Back to the room
    </Link>
  )
  if (room.isError || room.isPending) {
    return (
      <Region index="00" label="Room settings" heading="Room settings" sectionClassName="pb-10 pt-4" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">{room.isPending ? 'Reading…' : readFailure(room.error, 'This room')}</p>
        {back}
      </Region>
    )
  }
  const r = room.data
  const role = r.me?.role
  const me = r.me?.workspace_id ?? ''
  if (role !== 'owner' && role !== 'editor') {
    return (
      <Region index="00" label="Room settings" heading={r.title} sectionClassName="pb-10 pt-4" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">Only the room’s owner and its editors change its settings.</p>
        {back}
      </Region>
    )
  }
  const owner = role === 'owner'
  return (
    <Fragment key={stateOf}>
      <Region index="00" label="Room settings" heading={r.title} sectionClassName="pb-8 pt-4 wide:pb-10" className="flex max-w-2xl flex-col gap-3">
        <p className="text-caption text-muted">
          {r.visibility === 'private' ? 'Private' : 'Public'} · you are its {owner ? 'owner' : 'editor'} · terms version{' '}
          <span className="font-figure">{r.terms.version}</span>
        </p>
        {back}
      </Region>
      <Members room={r} me={me} />
      <Invites room={r} />
      <Budget room={r} owner={owner} />
      <Prizes room={r} owner={owner} />
      <Terms room={r} owner={owner} />
    </Fragment>
  )
}
