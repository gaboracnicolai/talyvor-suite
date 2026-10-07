import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, NavIcon, cn, focusRing } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { formatULXC } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { ARTIFACT, artifactOf } from '../marketplace/Marketplace'
import { KINDS, type ListingKind, kindLabel, marketApi, parsePrice, variablesNamedIn } from '../marketplace/marketApi'
import { CATALOG_KEY, Card, KIND_ICON, Note, pressed, readFailure, selectClass } from '../marketplace/parts'
import {
  type Contribution,
  type MessagePage,
  type RoomDetail,
  type RoomMessage,
  type RoomWallet,
  type RunRefs,
  ROOMS_KEY,
  followRoom,
  roomRefusal,
  roomsApi,
  upsertMessage,
  usdText,
} from './roomsApi'

// Room.tsx — B32.54: the room screen, for a member under the room's current terms. The conversation is fed by the
// room's event stream (Lens B32.30 through apps/bff/rooms.go), so another member's message appears as it is posted;
// the contributions board proposes, forks and votes on work (B32.31); and the run panel runs a contribution or a
// marketplace listing on the room's budget or the member's own (B32.33), whose run message — what it cost and who
// paid — reaches everyone in the room. The room wallet's spend this month against its budget sits at the top.
//
// Lens decides everything — who may post, contribute, vote, accept and spend — and its sentence is shown on a refusal.

const messagesKey = (id: string) => [...ROOMS_KEY, 'messages', id]
const contributionsKey = (id: string) => [...ROOMS_KEY, 'contributions', id]

/** Who wrote something, as this member reads it: "You", or the workspace by its id. */
function Author({ ws, me }: { ws: string; me: string }) {
  return ws === me ? (
    <span className="text-ink">You</span>
  ) : (
    <span className="inline-block max-w-xs truncate align-bottom font-figure text-ink" title={ws}>
      {ws}
    </span>
  )
}

// ── The budget ─────────────────────────────────────────────────────────────────────────────────────

/** The room wallet's spend this month against its monthly limit — the room's budget. */
export function RoomBudget({ wallet }: { wallet: RoomWallet }) {
  const limit = wallet.monthly_limit_ulxc
  const spent = wallet.spent_this_month_ulxc
  const share = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0
  return (
    <div className="flex flex-col gap-2 rounded-card border border-rule bg-raised p-4" data-testid="room-budget">
      <span className="font-figure text-eyebrow uppercase text-label">The room’s budget this month</span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-figure text-title text-ink" data-testid="room-budget-spent">
          {formatULXC(spent)}
        </span>
        {limit > 0 ? (
          <span className="text-body text-muted">
            spent of <span className="font-figure text-ink">{formatULXC(limit)}</span>
          </span>
        ) : (
          <span className="text-body text-muted">spent · no monthly limit set</span>
        )}
      </span>
      {limit > 0 ? (
        <span
          className="h-1 w-full overflow-hidden rounded-control bg-surface"
          role="meter"
          aria-label="The room’s budget spent this month"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={share}
        >
          <span className="block h-full bg-accent" style={{ width: `${share}%` }} />
        </span>
      ) : null}
      <span className="text-caption text-muted">
        Balance <span className="font-figure text-ink">{formatULXC(wallet.balance_ulxc)}</span> ·{' '}
        {wallet.may_spend ? 'You may run things on the room.' : (wallet.why_not ?? 'You may not spend the room’s money.')}
      </span>
    </div>
  )
}

// ── The conversation ───────────────────────────────────────────────────────────────────────────────

/** What a run cost and who paid, from its message's refs. */
export function RunCost({ refs, me }: { refs: RunRefs; me: string }) {
  const cost =
    refs.run === 'ask'
      ? 'Model calls'
      : refs.charge === 'billed'
        ? usdText(refs.price_usd_micros ?? 0)
        : refs.charge === 'own'
          ? 'No charge — the payer’s own work'
          : refs.charge === 'licensed'
            ? 'Covered by a licence'
            : refs.charge === 'trial'
              ? 'A free trial use'
              : 'No charge'
  return (
    <span className="flex flex-wrap gap-x-6 gap-y-1 border-t border-rule pt-2" data-testid="run-cost">
      <span className="flex items-baseline gap-2">
        <span className="font-figure text-eyebrow uppercase text-label">Cost</span>
        <span className="font-figure text-body text-ink">{cost}</span>
      </span>
      <span className="text-body text-ink">
        {refs.pay === 'room' ? (
          'Paid by the room'
        ) : refs.payer_workspace_id === me ? (
          'Paid by you'
        ) : (
          <>
            Paid by <Author ws={refs.payer_workspace_id} me={me} />
          </>
        )}
      </span>
    </span>
  )
}

function isRun(m: RoomMessage): m is RoomMessage & { refs: RunRefs } {
  return m.kind === 'run' && m.refs !== null && typeof (m.refs as RunRefs).pay === 'string'
}

function MessageItem({ m, me }: { m: RoomMessage; me: string }) {
  const run = isRun(m)
  return (
    <li className={cn('flex flex-col gap-1', run && 'rounded-card border border-rule bg-raised p-3')} data-testid="room-message">
      <span className="flex items-baseline gap-2 text-caption text-muted">
        <Author ws={m.author_workspace_id} me={me} />
        {run ? <span className="font-figure text-eyebrow uppercase text-label">Run</span> : null}
        {m.kind === 'contribution' ? <span className="font-figure text-eyebrow uppercase text-label">Contribution</span> : null}
        <span className="font-figure">{formatWhen(m.created_at)}</span>
        {m.edited_at && !m.deleted_at ? <span>edited</span> : null}
      </span>
      {m.deleted_at ? (
        <span className="text-body italic text-muted">Message deleted.</span>
      ) : (
        <span className="whitespace-pre-wrap break-words text-body text-ink">{m.body}</span>
      )}
      {run ? <RunCost refs={m.refs} me={me} /> : null}
    </li>
  )
}

function Conversation({ room, me }: { room: RoomDetail; me: string }) {
  const qc = useQueryClient()
  const id = room.id
  const page = useQuery({ queryKey: messagesKey(id), queryFn: () => roomsApi.messages(id) })
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  const cursor = page.data?.events_cursor
  const ready = page.isSuccess

  const upsert = (m: RoomMessage) =>
    qc.setQueryData<MessagePage>(messagesKey(id), (p) =>
      p ? { ...p, messages: upsertMessage(p.messages ?? [], m) } : p,
    )

  // The room's events from the cursor of the first read: each message as it is posted, edited or deleted. A
  // contribution's message refreshes the board, and a run on the room the budget.
  useEffect(() => {
    if (!ready || cursor === undefined) return
    const stop = new AbortController()
    void followRoom(
      id,
      cursor,
      (ev) => {
        if (!ev.message) return
        upsert(ev.message)
        if (ev.message.kind === 'contribution') void qc.invalidateQueries({ queryKey: contributionsKey(id) })
        if (isRun(ev.message) && ev.message.refs.pay === 'room')
          void qc.invalidateQueries({ queryKey: [...ROOMS_KEY, 'room', id] })
      },
      stop.signal,
    )
    return () => stop.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one follow per room and first read
  }, [id, ready, cursor === undefined])

  const messages = page.data?.messages ?? []
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const send = useMutation({
    mutationFn: (body: string) => roomsApi.post(id, body),
    onSuccess: (m) => {
      upsert(m)
      setDraft('')
    },
  })
  const viewer = room.me?.role === 'viewer'
  const submit = () => {
    if (draft.trim() !== '' && !send.isPending && !viewer) send.mutate(draft)
  }

  return (
    <Region index="01" label="Conversation" className="flex flex-col gap-4">
      {page.isError ? (
        <p className="text-body text-muted">{readFailure(page.error, 'The room’s messages')}</p>
      ) : page.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : messages.length === 0 ? (
        <p className="text-body text-muted">No messages yet. Send the first one below: say what you want to build.</p>
      ) : (
        <ol ref={listRef} aria-label="Messages" aria-live="polite" className="flex max-h-96 flex-col gap-4 overflow-y-auto pr-1">
          {messages.map((m) => (
            <MessageItem key={m.id} m={m} me={me} />
          ))}
        </ol>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="flex flex-col gap-1 text-caption text-muted">
          Message
          <textarea
            className={`min-h-20 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            value={draft}
            disabled={viewer}
            placeholder={viewer ? 'A viewer reads the room.' : 'Write to the room'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
        </label>
        <div>
          <Button type="submit" variant="primary" disabled={viewer || draft.trim() === '' || send.isPending}>
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
        {send.isError ? <Note ok={false}>{roomRefusal(send.error)}</Note> : null}
      </form>
    </Region>
  )
}

// ── The contributions board ────────────────────────────────────────────────────────────────────────

/** The text fields of a proposal or a fork: kind (a proposal only), title, the work itself and its price per use. */
function ContributionForm({
  submit,
  pending,
  error,
  fork,
  defaultPrice,
  initialTitle = '',
  onCancel,
}: {
  submit: (d: { kind: ListingKind; title: string; text: string; micros: number | undefined }) => void
  pending: boolean
  error: unknown
  fork?: { kind: ListingKind }
  defaultPrice: number
  initialTitle?: string
  onCancel?: () => void
}) {
  const [kind, setKind] = useState<ListingKind>(fork?.kind ?? 'prompt')
  const [title, setTitle] = useState(initialTitle)
  const [text, setText] = useState('')
  const [price, setPrice] = useState('')
  const micros = price.trim() === '' ? undefined : parsePrice(price)
  const ok = title.trim() !== '' && (fork !== undefined || text.trim() !== '') && micros !== null
  const what = ARTIFACT[kind]
  return (
    <form
      className="flex flex-col gap-3 p-gutter"
      onSubmit={(e) => {
        e.preventDefault()
        if (ok && !pending) submit({ kind, title: title.trim(), text, micros: micros ?? undefined })
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {fork ? null : (
          <label className="text-caption text-muted">
            Kind
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as ListingKind)}>
              {KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex grow flex-col gap-1 text-caption text-muted">
          Title
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-caption text-muted">
        {fork ? `${what.label} — empty keeps the original’s` : what.label}
        <textarea className={`min-h-20 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`} value={text} placeholder={what.hint} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="text-caption text-muted">
        Price per use, in US dollars
        <Input
          className="mt-1 block w-32 font-figure"
          inputMode="decimal"
          placeholder={usdText(defaultPrice)}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </label>
      {micros === null ? <Note ok={false}>A price is an amount of dollars, like 0.10 — or empty for the room’s default.</Note> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!ok || pending}>
          {pending ? (fork ? 'Forking…' : 'Proposing…') : fork ? 'Fork it' : 'Propose'}
        </Button>
        {onCancel ? (
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
      {error ? <Note ok={false}>{roomRefusal(error)}</Note> : null}
    </form>
  )
}

function ContributionCard({
  c,
  all,
  room,
  me,
  update,
}: {
  c: Contribution
  all: Contribution[]
  room: RoomDetail
  me: string
  update: (c: Contribution) => void
}) {
  const qc = useQueryClient()
  const [forking, setForking] = useState(false)
  const vote = useMutation({ mutationFn: (v: 1 | -1) => roomsApi.vote(room.id, c.id, v), onSuccess: update })
  const decide = useMutation({
    mutationFn: (s: 'accepted' | 'rejected') => roomsApi.decide(room.id, c.id, s),
    onSuccess: update,
  })
  const fork = useMutation({
    mutationFn: (d: { kind: ListingKind; title: string; text: string; micros: number | undefined }) =>
      roomsApi.fork(room.id, c.id, {
        title: d.title,
        description: '',
        changelog: '',
        ...(d.text.trim() ? { artifact: artifactOf(d.kind, d.text, '') } : {}),
        ...(d.micros !== undefined ? { price_usd_micros: d.micros } : {}),
      }),
    onSuccess: (made) => {
      setForking(false)
      qc.setQueryData<Contribution[]>(contributionsKey(room.id), (list) => [made, ...(list ?? []).filter((x) => x.id !== made.id)])
    },
  })
  const original = c.forked_from ? all.find((x) => x.id === c.forked_from) : undefined
  const decides = (room.me?.role === 'owner' || room.me?.role === 'editor') && c.status === 'proposed'
  const busy = vote.isPending || decide.isPending
  const failed = vote.error ?? decide.error
  return (
    <li className="flex flex-col rounded-card border border-rule bg-raised" data-testid="contribution-card">
      <div className="flex flex-col gap-3 p-4">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <NavIcon name={KIND_ICON[c.kind] ?? 'prompt'} className="h-5 w-5 shrink-0 text-accent-strong" />
            <span className="font-figure text-eyebrow uppercase text-label">{kindLabel(c.kind)}</span>
          </span>
          {c.status === 'accepted' ? (
            <span
              className="rounded-control bg-accent-tint px-2 py-0.5 font-figure text-eyebrow uppercase text-accent-strong"
              data-testid="accepted-mark"
            >
              Accepted
            </span>
          ) : c.status === 'rejected' ? (
            <span className="font-figure text-eyebrow uppercase text-muted">Not taken</span>
          ) : null}
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-head text-ink">{c.title}</span>
          <span className="text-caption text-muted">
            by <Author ws={c.author_workspace_id} me={me} /> · <span className="font-figure">{formatWhen(c.created_at)}</span>
          </span>
          {c.forked_from ? (
            <span className="text-caption text-muted" data-testid="contribution-original">
              Built on {original ? `“${original.title}”` : 'an earlier contribution'}
              {original ? (
                <>
                  {' '}
                  by <Author ws={original.author_workspace_id} me={me} />
                </>
              ) : null}
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <Button
            aria-pressed={c.my_vote === 1}
            aria-label={`Vote for ${c.title}`}
            className={cn('font-figure', pressed)}
            disabled={busy}
            onClick={() => vote.mutate(1)}
          >
            +1
          </Button>
          <span className="min-w-8 text-center font-figure text-body text-ink" aria-label={`${c.title}: ${c.tally} votes`}>
            {c.tally > 0 ? `+${c.tally}` : c.tally}
          </span>
          <Button
            aria-pressed={c.my_vote === -1}
            aria-label={`Vote against ${c.title}`}
            className={cn('font-figure', pressed)}
            disabled={busy}
            onClick={() => vote.mutate(-1)}
          >
            −1
          </Button>
          <span className="grow" />
          <Button aria-expanded={forking} onClick={() => setForking((f) => !f)}>
            Fork
          </Button>
          {decides ? (
            <>
              <Button disabled={busy} onClick={() => decide.mutate('accepted')}>
                Accept
              </Button>
              <Button disabled={busy} onClick={() => decide.mutate('rejected')}>
                Reject
              </Button>
            </>
          ) : null}
        </span>
        {failed ? <Note ok={false}>{roomRefusal(failed)}</Note> : null}
      </div>
      {forking ? (
        <div className="border-t border-rule" aria-label={`Fork ${c.title}`} role="group">
          <ContributionForm
            fork={{ kind: c.kind }}
            initialTitle={`${c.title} (fork)`}
            defaultPrice={room.terms.default_price_usd_micros}
            submit={(d) => fork.mutate(d)}
            pending={fork.isPending}
            error={fork.error}
            onCancel={() => setForking(false)}
          />
        </div>
      ) : null}
    </li>
  )
}

function Board({ room, me }: { room: RoomDetail; me: string }) {
  const qc = useQueryClient()
  const id = room.id
  const list = useQuery({ queryKey: contributionsKey(id), queryFn: () => roomsApi.contributions(id) })
  const [proposing, setProposing] = useState(false)
  const update = (c: Contribution) =>
    qc.setQueryData<Contribution[]>(contributionsKey(id), (l) => (l ?? []).map((x) => (x.id === c.id ? c : x)))
  const propose = useMutation({
    mutationFn: (d: { kind: ListingKind; title: string; text: string; micros: number | undefined }) =>
      roomsApi.propose(id, {
        kind: d.kind,
        title: d.title,
        description: '',
        changelog: '',
        artifact: artifactOf(d.kind, d.text, ''),
        ...(d.micros !== undefined ? { price_usd_micros: d.micros } : {}),
      }),
    onSuccess: (made) => {
      setProposing(false)
      qc.setQueryData<Contribution[]>(contributionsKey(id), (l) => [made, ...(l ?? []).filter((x) => x.id !== made.id)])
    },
  })
  const all = list.data ?? []
  return (
    <Region index="02" label="Contributions" fullWidth className="flex flex-col gap-4">
      <div className="flex max-w-3xl flex-wrap items-center gap-3">
        <p className="grow text-body text-muted">
          Work proposed to the room. Fork one to build on it — its author earns the room’s remix share — and vote for the
          ones the room should keep.
        </p>
        <Button aria-expanded={proposing} onClick={() => setProposing((p) => !p)}>
          Propose
        </Button>
      </div>
      {proposing ? (
        <Card className="max-w-3xl">
          <ContributionForm
            defaultPrice={room.terms.default_price_usd_micros}
            submit={(d) => propose.mutate(d)}
            pending={propose.isPending}
            error={propose.error}
            onCancel={() => setProposing(false)}
          />
        </Card>
      ) : null}
      {list.isError ? (
        <p className="text-body text-muted">{readFailure(list.error, 'The contributions')}</p>
      ) : list.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : all.length === 0 ? (
        <p className="text-body text-muted">Nothing proposed yet. Add the first piece of work with Propose.</p>
      ) : (
        <ul className="grid gap-3 wide:grid-cols-2" aria-label="Contributions">
          {all.map((c) => (
            <ContributionCard key={c.id} c={c} all={all} room={room} me={me} update={update} />
          ))}
        </ul>
      )}
    </Region>
  )
}

// ── The run panel ──────────────────────────────────────────────────────────────────────────────────

function RunPanel({ room, me }: { room: RoomDetail; me: string }) {
  const qc = useQueryClient()
  const id = room.id
  const contributions = useQuery({ queryKey: contributionsKey(id), queryFn: () => roomsApi.contributions(id) })
  const catalog = useQuery({ queryKey: [...CATALOG_KEY, ''], queryFn: () => marketApi.catalog('') })
  const mayRoom = room.wallet?.may_spend ?? false
  const [target, setTarget] = useState('')
  const [input, setInput] = useState('')
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [pay, setPay] = useState<'room' | 'self'>(mayRoom ? 'room' : 'self')
  const run = useMutation({
    mutationFn: () => roomsApi.run(id, { target, input, variables, model: '', pay }),
    onSuccess: (res) => {
      const m = res.message
      if (m) {
        qc.setQueryData<MessagePage>(messagesKey(id), (p) => (p ? { ...p, messages: upsertMessage(p.messages ?? [], m) } : p))
      }
      if (res.pay === 'room') void qc.invalidateQueries({ queryKey: [...ROOMS_KEY, 'room', id] })
    },
  })
  const named = variablesNamedIn(run.error)
  const result = run.data?.message
  return (
    <Region index="03" label="Run" className="flex flex-col gap-3">
      <p className="text-body text-muted">
        Run one of the room’s contributions or a marketplace listing. What it answered, what it cost and who paid go to
        the room.
      </p>
      <Card>
        <form
          className="flex flex-col gap-3 p-gutter"
          onSubmit={(e) => {
            e.preventDefault()
            if (target && !run.isPending) run.mutate()
          }}
        >
          <label className="text-caption text-muted">
            What to run
            <select className={selectClass} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose…</option>
              {(contributions.data ?? []).length > 0 ? (
                <optgroup label="This room’s contributions">
                  {(contributions.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {(catalog.data ?? []).length > 0 ? (
                <optgroup label="The marketplace">
                  {(catalog.data ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            Input
            <textarea className={`min-h-20 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`} value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          {named.map((v) => (
            <label key={v} className="flex flex-col gap-1 text-caption text-muted">
              {v}
              <Input value={variables[v] ?? ''} onChange={(e) => setVariables((x) => ({ ...x, [v]: e.target.value }))} />
            </label>
          ))}
          <fieldset className="flex flex-col gap-2">
            <legend className="font-figure text-eyebrow uppercase text-label">Who pays</legend>
            <label className={cn('flex items-center gap-2 text-body', mayRoom ? 'text-ink' : 'text-muted')}>
              <input
                type="radio"
                name="pay"
                className={cn('h-4 w-4 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                checked={pay === 'room'}
                disabled={!mayRoom}
                onChange={() => setPay('room')}
              />
              On the room
            </label>
            {!mayRoom ? (
              <span className="pl-6 text-caption text-muted">
                {room.wallet?.why_not ?? 'This room has no budget to spend yet.'}
              </span>
            ) : null}
            <label className="flex items-center gap-2 text-body text-ink">
              <input
                type="radio"
                name="pay"
                className={cn('h-4 w-4 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
                checked={pay === 'self'}
                onChange={() => setPay('self')}
              />
              On me
            </label>
          </fieldset>
          <div>
            <Button type="submit" disabled={!target || run.isPending}>
              {run.isPending ? 'Running…' : 'Run'}
            </Button>
          </div>
          {run.isError ? <Note ok={false}>{roomRefusal(run.error)}</Note> : null}
        </form>
        {result ? (
          <ol aria-label="Run result" className="border-t border-rule p-gutter">
            <MessageItem m={result} me={me} />
          </ol>
        ) : null}
      </Card>
    </Region>
  )
}

/** The room screen's live regions, for a member under the room's current terms. */
export function RoomLive({ room }: { room: RoomDetail }) {
  const me = room.me?.workspace_id ?? ''
  return (
    <>
      <Conversation room={room} me={me} />
      <Board room={room} me={me} />
      <RunPanel room={room} me={me} />
    </>
  )
}
