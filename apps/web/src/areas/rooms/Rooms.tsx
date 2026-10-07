import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { Button, Input, NavIcon, Row, cn, focusRing, inlineLink } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { formatWhen } from '../lens/format'
import { parsePrice } from '../marketplace/marketApi'
import { Card, Note, pressed, readFailure, selectClass } from '../marketplace/parts'
import {
  type Room,
  type RoomLimits,
  type SpendPolicy,
  type SplitRule,
  ROOMS_KEY,
  SPEND_POLICIES,
  SPLIT_RULES,
  STORED_NOTICE,
  byTopic,
  parseShare,
  roomRefusal,
  roomsApi,
  shareText,
  spendPolicyText,
  splitRuleText,
} from './roomsApi'

// Rooms.tsx — B32.53: Chat becomes a list of open chats. A room is a chat other workspaces and their agents
// join to build something together (Lens B32.28–B32.30): the directory of open rooms by topic and the rooms
// this workspace is in, the form that opens a new one with its terms, and a room's first screen — where its
// text is kept, its terms, and joining by accepting them. Chat's rail lists the same rooms (RoomsRail).
//
// Lens decides everything: who may open or join, what the plan allows (rooms_plan_limits) and whether the
// terms accepted are current. On a refusal these screens show Lens's own sentence.

/** A price per use in µUSD, to the cent — or finer, when a use costs less than a cent. */
export function usdText(micros: number): string {
  if (micros <= 0) return 'Free'
  return `$${(micros / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
}

function roomHref(id: string) {
  return `/rooms/${encodeURIComponent(id)}`
}

/** What the plan lets this workspace open, beside what it has open: "1 of 3 public rooms". */
function limitsLine(l: RoomLimits): string {
  const of = (open: number, max: number, noun: string) =>
    max < 0 ? `${open} ${noun} (no limit)` : `${open} of ${max} ${noun}`
  return `Your ${l.plan} plan: ${of(l.public_rooms_open, l.public_rooms, 'public rooms')} and ${of(
    l.private_rooms_open,
    l.private_rooms,
    'private rooms',
  )} open.`
}

function RoomCard({ room, member }: { room: Room; member: boolean }) {
  return (
    <li
      className="relative flex flex-col gap-3 rounded-card border border-rule bg-raised p-4 transition-colors duration-200 hover:border-rule-strong"
      data-testid="room-card"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <NavIcon name="members" className="h-6 w-6 shrink-0 text-accent-strong" />
          <span className="truncate font-figure text-eyebrow uppercase text-label">{room.topic || 'Other'}</span>
        </span>
        <NavIcon name="arrow" className="h-4 w-4 shrink-0 text-muted" />
      </span>
      <span className="flex flex-col gap-1">
        <Link
          className={cn('text-head text-ink after:absolute after:inset-0 after:rounded-card', focusRing)}
          to={roomHref(room.id)}
        >
          {room.title}
        </Link>
        {room.description ? <span className="line-clamp-2 text-body text-muted">{room.description}</span> : null}
      </span>
      <span className="mt-auto flex items-end justify-between gap-3 border-t border-rule pt-3">
        <span className="flex flex-col gap-0.5">
          <span className="font-figure text-eyebrow uppercase text-label">Members</span>
          <span className="font-figure text-body text-ink">{room.member_count}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-figure text-eyebrow uppercase text-label">
            {room.visibility === 'private' ? 'Private' : 'Public'}
          </span>
          <span className="text-body text-ink">{member ? 'You are in it' : 'Open to join'}</span>
        </span>
      </span>
    </li>
  )
}

function RoomGrid({ rooms, member, label }: { rooms: Room[]; member: (r: Room) => boolean; label: string }) {
  return (
    <ul className="grid gap-3 wide:grid-cols-2 xl:grid-cols-3" aria-label={label}>
      {rooms.map((r) => (
        <RoomCard key={r.id} room={r} member={member(r)} />
      ))}
    </ul>
  )
}

// ── The directory ──────────────────────────────────────────────────────────────────────────────────

function Directory() {
  const [topic, setTopic] = useState('')
  const all = useQuery({ queryKey: [...ROOMS_KEY, ''], queryFn: () => roomsApi.list() })
  const shown = useQuery({ queryKey: [...ROOMS_KEY, topic], queryFn: () => roomsApi.list(topic), enabled: topic !== '' })
  const open = topic === '' ? all : shown
  const joined = all.data?.joined ?? []
  const invited = all.data?.invited ?? []
  const isMember = (r: Room) => joined.some((j) => j.id === r.id)
  const topics = [...new Set((all.data?.rooms ?? []).map((r) => r.topic.trim()).filter(Boolean))].sort()
  return (
    <>
      <Region
        index="00"
        label="Rooms"
        heading="Build with other teams and their agents"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          A room is a chat other workspaces join to make something together. Its terms say what a use of the work
          costs, how earnings are split and who may spend the room’s money. {STORED_NOTICE}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="primary">
            <Link to="/rooms/new">New room</Link>
          </Button>
          {all.data?.limits ? <span className="text-caption text-muted">{limitsLine(all.data.limits)}</span> : null}
        </div>
      </Region>
      <Region index="01" label="Your rooms" fullWidth className="flex flex-col gap-4">
        {all.isError ? (
          <p className="text-body text-muted">{readFailure(all.error, 'Your rooms')}</p>
        ) : all.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : joined.length === 0 && invited.length === 0 ? (
          <p className="text-body text-muted">You are in no rooms yet. Join an open one below, or open your own.</p>
        ) : (
          <>
            {joined.length > 0 ? <RoomGrid rooms={joined} member={() => true} label="Your rooms" /> : null}
            {invited.length > 0 ? (
              <>
                <span className="font-figure text-eyebrow uppercase text-label">Invited</span>
                <RoomGrid rooms={invited} member={() => false} label="Rooms you are invited to" />
              </>
            ) : null}
          </>
        )}
      </Region>
      <Region index="02" label="Open rooms" fullWidth className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Topic">
          <Button aria-pressed={topic === ''} className={pressed} onClick={() => setTopic('')}>
            Every topic
          </Button>
          {topics.map((t) => (
            <Button key={t} aria-pressed={topic === t} className={pressed} onClick={() => setTopic(t)}>
              {t}
            </Button>
          ))}
        </div>
        {open.isError ? (
          <p className="text-body text-muted">{readFailure(open.error, 'The open rooms')}</p>
        ) : open.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : (open.data?.rooms ?? []).length === 0 ? (
          <p className="text-body text-muted">No public room is open{topic ? ` on ${topic}` : ''} yet.</p>
        ) : (
          <RoomGrid rooms={open.data?.rooms ?? []} member={isMember} label="Open rooms" />
        )}
      </Region>
    </>
  )
}

// ── A new room ─────────────────────────────────────────────────────────────────────────────────────

function NewRoom() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const limits = useQuery({ queryKey: [...ROOMS_KEY, ''], queryFn: () => roomsApi.list() }).data?.limits
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [price, setPrice] = useState('')
  const [split, setSplit] = useState<SplitRule>('owner_decides')
  const [share, setShare] = useState('')
  const [spend, setSpend] = useState<SpendPolicy>('owner_only')
  const micros = parsePrice(price)
  const bps = parseShare(share)
  const create = useMutation({
    mutationFn: () =>
      roomsApi.create({
        title: title.trim(),
        topic: topic.trim(),
        description: description.trim(),
        visibility,
        terms: {
          split_rule: split,
          remix_share_bps: bps ?? 0,
          default_price_usd_micros: micros ?? 0,
          spend_policy: spend,
        },
      }),
    onSuccess: (room) => {
      void qc.invalidateQueries({ queryKey: ROOMS_KEY })
      navigate(roomHref(room.id))
    },
  })
  const ready = title.trim() !== '' && micros !== null && bps !== null
  return (
    <Region
      index="00"
      label="New room"
      heading="Open a room"
      sectionClassName="pb-10 pt-4 wide:pb-12"
      className="flex max-w-2xl flex-col gap-3"
    >
      <p className="text-body text-muted">
        Your workspace owns the room and sets its terms; everyone who joins accepts them first. A public room is listed
        for everyone to find; a private one only for the workspaces you invite.
      </p>
      {limits ? <p className="text-caption text-muted">{limitsLine(limits)}</p> : null}
      <Card>
        <form
          className="flex flex-col gap-4 p-gutter"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready && !create.isPending) create.mutate()
          }}
        >
          <label className="flex flex-col gap-1 text-caption text-muted">
            Title
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex grow flex-col gap-1 text-caption text-muted">
              Topic
              <Input value={topic} placeholder="research, design, open source…" onChange={(e) => setTopic(e.target.value)} />
            </label>
            <label className="text-caption text-muted">
              Who can find it
              <select
                className={selectClass}
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
              >
                <option value="public">Public — anyone can find and join it</option>
                <option value="private">Private — only workspaces you invite</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-caption text-muted">
            What it is for
            <textarea
              className={`min-h-24 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <fieldset className="flex flex-col gap-3 border-t border-rule pt-4">
            <legend className="font-figure text-eyebrow uppercase text-label">Terms</legend>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-caption text-muted">
                Default price per use, in US dollars
                <Input
                  className="mt-1 block w-32 font-figure"
                  inputMode="decimal"
                  placeholder="Free"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
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
                <Input
                  className="mt-1 block w-32 font-figure"
                  inputMode="decimal"
                  placeholder="0"
                  value={share}
                  onChange={(e) => setShare(e.target.value)}
                />
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
            <p className="text-caption text-muted">
              The remix share is what the author of a piece earns when someone builds on it.
            </p>
          </fieldset>
          {micros === null ? <Note ok={false}>A price is an amount of dollars, like 0.10 — or empty for free.</Note> : null}
          {bps === null ? <Note ok={false}>A remix share is a percentage from 0 to 100, like 12.5.</Note> : null}
          <div>
            <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
              {create.isPending ? 'Opening…' : 'Open room'}
            </Button>
          </div>
          {create.isError ? <Note ok={false}>{roomRefusal(create.error)}</Note> : null}
        </form>
      </Card>
    </Region>
  )
}

// ── A room's first screen ──────────────────────────────────────────────────────────────────────────

function RoomPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const [accepted, setAccepted] = useState(false)
  const room = useQuery({ queryKey: [...ROOMS_KEY, 'room', id], queryFn: () => roomsApi.room(id) })
  const join = useMutation({
    mutationFn: (version: number) => roomsApi.join(id, version),
    onSuccess: () => {
      setAccepted(false)
      void qc.invalidateQueries({ queryKey: ROOMS_KEY })
    },
  })
  // Another room's terms are not accepted by ticking this one's: the box and a refusal belong to the room.
  const [stateOf, setStateOf] = useState(id)
  if (stateOf !== id) {
    setStateOf(id)
    setAccepted(false)
    join.reset()
  }
  if (room.isError || room.isPending) {
    return (
      <Region index="00" label="Room" heading="Room" sectionClassName="pb-10 pt-4" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">
          {room.isPending ? 'Reading…' : readFailure(room.error, 'This room')}{' '}
          <Link className={`text-ink ${inlineLink}`} to="/rooms">
            All rooms
          </Link>
        </p>
      </Region>
    )
  }
  const r = room.data
  const t = r.terms
  const members = r.members ?? []
  const asks = r.me === null || !r.me.terms_current
  return (
    <>
      <Region
        index="00"
        label={r.topic || 'Room'}
        heading={r.title}
        sectionClassName="pb-8 pt-4 wide:pb-10"
        className="flex max-w-2xl flex-col gap-3"
      >
        {r.description ? <p className="text-body text-muted">{r.description}</p> : null}
        <p className="rounded-card border border-rule bg-raised p-4 text-body text-ink" data-testid="room-stored-notice">
          {STORED_NOTICE}
        </p>
        <p className="text-caption text-muted">
          {r.visibility === 'private' ? 'Private' : 'Public'} · <span className="font-figure">{r.member_count}</span>{' '}
          {r.member_count === 1 ? 'member' : 'members'} · last active{' '}
          <span className="font-figure">{formatWhen(r.last_activity_at)}</span>
        </p>
      </Region>
      <Region index="01" label="Terms" className="flex max-w-2xl flex-col gap-3">
        <Card>
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
          <Row stack label="Version">
            <span className="font-figure text-body text-ink">{t.version}</span>
          </Row>
        </Card>
        {asks ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (accepted && !join.isPending) join.mutate(t.version)
            }}
          >
            <label className="flex items-start gap-2 text-body text-ink">
              <input
                type="checkbox"
                className={cn(
                  'mt-1 h-4 w-4 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
                  focusRing,
                )}
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              {r.me === null
                ? 'I accept these terms for my workspace, and I understand the room’s messages are stored by Talyvor.'
                : 'The terms changed since you joined. I accept the new terms for my workspace.'}
            </label>
            <div>
              <Button type="submit" variant="primary" disabled={!accepted || join.isPending}>
                {join.isPending ? 'Joining…' : r.me === null ? 'Join room' : 'Accept the new terms'}
              </Button>
            </div>
            {join.isError ? <Note ok={false}>{roomRefusal(join.error)}</Note> : null}
          </form>
        ) : (
          <Note ok>You are in this room as {r.me?.role === 'owner' ? 'its owner' : `a ${r.me?.role ?? 'member'}`}.</Note>
        )}
      </Region>
      <Region index="02" label="Members" className="flex max-w-2xl flex-col gap-3">
        <Card>
          {members.length === 0 ? (
            <p className="p-gutter text-body text-muted">Nobody is in this room yet.</p>
          ) : (
            <ul aria-label="Members">
              {members.map((m) => (
                <li key={m.workspace_id}>
                  <Row label={m.role}>
                    <span className="truncate font-figure text-body text-ink" title={m.workspace_id}>
                      {m.workspace_id}
                    </span>
                  </Row>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Link className={`text-body text-ink ${inlineLink}`} to="/rooms">
          All rooms
        </Link>
      </Region>
    </>
  )
}

// ── Chat's rail ────────────────────────────────────────────────────────────────────────────────────

const railLink = cn(
  'block w-full truncate rounded-control px-2 py-1.5 text-left text-body text-ink transition-colors duration-200 hover:bg-surface',
  focusRing,
)

/** Chat's rail, below the private conversations: the rooms this workspace is in, then open rooms by topic. */
export function RoomsRail() {
  const rooms = useQuery({ queryKey: [...ROOMS_KEY, ''], queryFn: () => roomsApi.list() })
  const joined = rooms.data?.joined ?? []
  const open = (rooms.data?.rooms ?? []).filter((r) => !joined.some((j) => j.id === r.id))
  return (
    <section aria-label="Rooms" className="mt-5 border-t border-rule pt-3">
      <div className="flex items-center justify-between gap-2 px-2">
        <Link className={`font-figure text-eyebrow uppercase text-label ${inlineLink}`} to="/rooms">
          Rooms
        </Link>
        <Link className={`text-caption text-ink ${inlineLink}`} to="/rooms/new">
          New room
        </Link>
      </div>
      {rooms.isError ? (
        <p className="mt-2 px-2 text-caption text-muted">{readFailure(rooms.error, 'Rooms')}</p>
      ) : rooms.isPending ? (
        <p className="mt-2 px-2 text-caption text-muted">Reading…</p>
      ) : (
        <>
          {joined.length > 0 ? (
            <ul className="mt-2 space-y-0.5" aria-label="Your rooms">
              {joined.map((r) => (
                <li key={r.id}>
                  <Link className={railLink} to={roomHref(r.id)}>
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 px-2 text-caption text-muted">You are in no rooms yet.</p>
          )}
          {open.length > 0 ? (
            <div className="mt-3" aria-label="Open rooms" role="group">
              {byTopic(open).map(([topic, list]) => (
                <div key={topic} className="mt-2">
                  <span className="block px-2 text-caption text-faint">{topic}</span>
                  <ul aria-label={`Open rooms on ${topic}`} className="space-y-0.5">
                    {list.map((r) => (
                      <li key={r.id}>
                        <Link className={railLink} to={roomHref(r.id)}>
                          {r.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

export function RoomsArea() {
  return (
    <RegionScreen>
      <Routes>
        <Route index element={<Directory />} />
        <Route path="new" element={<NewRoom />} />
        <Route path=":id" element={<RoomPage />} />
        <Route path="*" element={<Directory />} />
      </Routes>
    </RegionScreen>
  )
}
