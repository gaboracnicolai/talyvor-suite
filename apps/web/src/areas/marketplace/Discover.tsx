import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, Input, NavIcon, Pill, cn, focusRing, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { formatWhen } from '../lens/format'
import { ROOMS_KEY, type Room, roomsApi } from '../rooms/roomsApi'
import {
  type Collection,
  type DiscoverHit,
  type DiscoverQuery,
  type DiscoverSort,
  KINDS,
  type ListingKind,
  MarketError,
  marketApi,
  parsePrice,
} from './marketApi'
import { DISCOVER_KEY, KIND_ICON, ListingGrid, pressed, readFailure, selectClass } from './parts'

// Discover.tsx — B32.61: the marketplace's front page, on Lens's discovery (B32.50). What is trending and what is
// new; a search by words with capability, kind, licence, the most a use may cost and verified publishers only; the
// public collections, the operator's featured ones first, each a page listing exactly its listings in its curator's
// order; and the open rooms building the same thing.
//
// Lens decides what matches, how it is ranked (trending is distinct buyers over seven days, the seller's own and
// linked workspaces never counted) and what a use is billed. The search rides the address, so a filtered Discover
// is a link that can be shared, and the price on each card is the one the search filtered on: US dollars a use.

const SORTS: readonly [DiscoverSort, string][] = [
  ['trending', 'Trending'],
  ['new', 'New'],
  ['price', 'Lowest price'],
]

const LICENCES: readonly [DiscoverQuery['licence'], string][] = [
  ['', 'Any licence'],
  ['personal', 'Personal'],
  ['commercial', 'Commercial'],
  ['enterprise', 'Enterprise'],
]

const isKind = (k: string): k is ListingKind => KINDS.some((x) => x.kind === k)
const isLicence = (l: string): l is DiscoverQuery['licence'] => LICENCES.some(([v]) => v === l)
const isSort = (s: string): s is DiscoverSort => s === 'relevance' || SORTS.some(([v]) => v === s)

/** How many rooms the strip shows. */
const ROOMS_SHOWN = 4

/** The words of a topic worth matching a room on: three letters or more, lower case. */
function topicWords(...texts: string[]): string[] {
  return [
    ...new Set(
      texts
        .join(' ')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3),
    ),
  ]
}

/** The open rooms on the topic, in Lens's order (latest activity first): its topic, title or description names a word. */
export function roomsOnTopic(rooms: readonly Room[], words: readonly string[]): Room[] {
  const onTopic = (r: Room) => {
    const text = `${r.topic} ${r.title} ${r.description}`.toLowerCase()
    return words.some((w) => text.includes(w))
  }
  return words.length > 0 ? rooms.filter(onTopic) : [...rooms]
}

export function Discover() {
  const [params, setParams] = useSearchParams()
  const set = (name: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (value) next.set(name, value)
        else next.delete(name)
        if (name !== 'page') next.delete('page')
        return next
      },
      { replace: true },
    )
  const words = params.get('q') ?? ''
  const capability = params.get('capability') ?? ''
  const kind = params.get('kind') ?? ''
  const licence = params.get('licence') ?? ''
  const sort = params.get('sort') ?? ''
  const maxText = params.get('max') ?? ''
  const verified = params.get('verified') === '1'
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  // A ceiling is US dollars as a person writes them, `0.05`; Lens takes µUSD. One that is not a price is not sent.
  const maxMicros = maxText.trim() === '' ? null : parsePrice(maxText)
  const query: DiscoverQuery = {
    q: words,
    capability,
    kind: isKind(kind) ? kind : '',
    licence: isLicence(licence) ? licence : '',
    max_price_per_use: maxMicros,
    verified_only: verified,
    sort: isSort(sort) ? sort : '',
    page,
  }
  const results = useQuery({
    queryKey: [...DISCOVER_KEY, query],
    queryFn: () => marketApi.search(query),
    placeholderData: (prev) => prev,
  })
  const capabilities = useQuery({ queryKey: ['market-capabilities'], queryFn: marketApi.capabilities, staleTime: 300_000 })
  const capLabel = capabilities.data?.find((c) => c.slug === capability)?.label ?? capability
  const hits: DiscoverHit[] = results.data?.listings ?? []
  const filtered =
    words.trim() !== '' || capability !== '' || query.kind !== '' || query.licence !== '' || maxMicros !== null || verified
  // Lens names the order it used: relevance with words, trending without, unless one was asked for.
  const shownSort = results.data?.sort ?? (query.sort || (words.trim() ? 'relevance' : 'trending'))
  return (
    <>
      <Region
        index="00"
        label="Marketplace"
        heading="Use what other teams built, and sell what yours did"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          Agents, prompts, skills and evaluations published by other Talyvor workspaces. Using one runs it through Lens
          as your workspace; a paid listing’s price goes on your monthly marketplace bill, never on your credits.
        </p>
        <p className="text-body text-muted">
          <Link className={`text-ink ${inlineLink}`} to="/marketplace/publish">
            Publish a listing
          </Link>{' '}
          and earn when others use it.
        </p>
      </Region>
      <Region index="01" label="Discover" fullWidth className="flex flex-col gap-4">
        <form
          className="flex flex-col gap-3"
          role="search"
          aria-label="Search the marketplace"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search listings"
              placeholder="Search, or describe what you need"
              className="w-full wide:w-80"
              value={words}
              onChange={(e) => set('q', e.target.value)}
            />
            <Button aria-pressed={query.kind === ''} className={pressed} onClick={() => set('kind', '')}>
              Everything
            </Button>
            {KINDS.map((k) => (
              <Button
                key={k.kind}
                aria-pressed={query.kind === k.kind}
                className={pressed}
                onClick={() => set('kind', k.kind)}
              >
                <NavIcon name={KIND_ICON[k.kind]} className="h-4 w-4" />
                {k.plural}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 wide:grid-cols-2 xl:grid-cols-4">
            <label className="text-caption text-muted">
              Capability
              <select className={selectClass} value={capability} onChange={(e) => set('capability', e.target.value)}>
                <option value="">Any capability</option>
                {(capabilities.data ?? []).map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-caption text-muted">
              Licence
              <select className={selectClass} value={query.licence} onChange={(e) => set('licence', e.target.value)}>
                {LICENCES.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-caption text-muted">
              Most a use may cost, in US$
              <Input
                className="mt-1 w-full font-figure"
                inputMode="decimal"
                placeholder="No limit"
                value={maxText}
                onChange={(e) => set('max', e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-body text-ink">
              <input
                type="checkbox"
                className={cn(
                  'h-4 w-4 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
                  focusRing,
                )}
                checked={verified}
                onChange={(e) => set('verified', e.target.checked ? '1' : '')}
              />
              Verified publishers only
            </label>
          </div>
          {maxMicros === null && maxText.trim() !== '' ? (
            <p role="alert" className="text-body text-ink">
              A price is a number of US dollars, such as 0.05 — this one is not used.
            </p>
          ) : null}
        </form>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Order">
          {words.trim() !== '' ? (
            <Button aria-pressed={shownSort === 'relevance'} className={pressed} onClick={() => set('sort', 'relevance')}>
              Best match
            </Button>
          ) : null}
          {SORTS.map(([v, text]) => (
            <Button key={v} aria-pressed={shownSort === v} className={pressed} onClick={() => set('sort', v)}>
              {text}
            </Button>
          ))}
          {results.data ? (
            <span className="ml-auto text-caption text-muted" data-testid="discover-total">
              <span className="font-figure">{results.data.total.toLocaleString('en-US')}</span>{' '}
              {results.data.total === 1 ? 'listing' : 'listings'}
              {shownSort === 'trending' ? ' · ranked by distinct buyers this week' : ''}
            </span>
          ) : null}
        </div>
        {results.isError ? (
          <p className="text-body text-muted">{searchFailure(results.error)}</p>
        ) : results.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : hits.length === 0 ? (
          <p className="text-body text-muted">
            {filtered ? 'Nothing published matches that search.' : 'Nothing is published here yet.'}
          </p>
        ) : (
          <ListingGrid listings={hits} label="Listings" usd={(h) => h.price_per_use_usd_micros} />
        )}
        {results.data && (page > 1 || results.data.has_more) ? (
          <nav className="flex items-center gap-3" aria-label="Pages">
            <Button disabled={page <= 1} onClick={() => set('page', page - 1 > 1 ? String(page - 1) : '')}>
              Previous
            </Button>
            <span className="text-caption text-muted">
              Page <span className="font-figure">{page}</span>
            </span>
            <Button disabled={!results.data.has_more} onClick={() => set('page', String(page + 1))}>
              Next
            </Button>
          </nav>
        ) : null}
      </Region>
      <Collections />
      <RoomsBuildingThis words={topicWords(words, capability, capLabel)} />
    </>
  )
}

function searchFailure(err: unknown): string {
  // A filter Lens refuses (a capability not on its list) comes back with its sentence: that is the answer.
  if (err instanceof MarketError && err.status === 400 && err.sentence) return err.sentence
  return readFailure(err, 'The marketplace')
}

// ── Collections ─────────────────────────────────────────────────────────────────────────────────────

const collectionHref = (id: string) => `/marketplace/collections/${encodeURIComponent(id)}`

function CollectionCard({ c }: { c: Collection }) {
  return (
    <li
      className="relative flex flex-col gap-3 rounded-card border border-rule bg-raised p-4 transition-colors duration-200 hover:border-rule-strong"
      data-testid="collection-card"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2">
          <NavIcon name="layers" className="h-6 w-6 text-accent-strong" />
          <span className="font-figure text-eyebrow uppercase text-label">Collection</span>
        </span>
        {c.featured ? <Pill status="lens">Featured</Pill> : <NavIcon name="arrow" className="h-4 w-4 text-muted" />}
      </span>
      <span className="flex flex-col gap-1">
        <Link
          className={cn('text-head text-ink after:absolute after:inset-0 after:rounded-card', focusRing)}
          to={collectionHref(c.id)}
        >
          {c.title}
        </Link>
        {c.description ? <span className="line-clamp-2 text-body text-muted">{c.description}</span> : null}
      </span>
      <span className="mt-auto flex items-end justify-between gap-3 border-t border-rule pt-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-figure text-eyebrow uppercase text-label">Curator</span>
          <span className="truncate font-figure text-body text-ink" title={c.workspace_id}>
            {c.featured ? 'Talyvor' : c.workspace_id}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="font-figure text-eyebrow uppercase text-label">Listings</span>
          <span className="font-figure text-body text-ink">{c.listing_count}</span>
        </span>
      </span>
    </li>
  )
}

function Collections() {
  const list = useQuery({ queryKey: ['market-collections'], queryFn: marketApi.collections })
  return (
    <Region index="02" label="Collections" fullWidth className="flex flex-col gap-4">
      <p className="max-w-2xl text-body text-muted">
        Listings other workspaces picked out and put in order. Talyvor’s featured collections come first.
      </p>
      {list.isError ? (
        <p className="text-body text-muted">{readFailure(list.error, 'The collections')}</p>
      ) : list.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : list.data.length === 0 ? (
        <p className="text-body text-muted">
          No collection is public yet — one appears here when a workspace publishes it.
        </p>
      ) : (
        <ul className="grid gap-3 wide:grid-cols-2 xl:grid-cols-3" aria-label="Collections">
          {list.data.map((c) => (
            <CollectionCard key={c.id} c={c} />
          ))}
        </ul>
      )}
    </Region>
  )
}

/** /marketplace/collections/:id — a collection and exactly its listings, in its curator's order. */
export function CollectionPage() {
  const { id = '' } = useParams()
  const c = useQuery({ queryKey: ['market-collection', id], queryFn: () => marketApi.collection(id) })
  if (c.isError || c.isPending) {
    const missing = c.error instanceof ApiError && c.error.status === 404
    return (
      <Region index="00" label="Collection" heading="Marketplace" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="text-body text-muted">
          {c.isPending
            ? 'Reading…'
            : missing
              ? 'This collection does not exist, or its curator made it private.'
              : readFailure(c.error, 'This collection')}{' '}
          <Link className={`text-ink ${inlineLink}`} to="/marketplace">
            Back to the marketplace
          </Link>
        </p>
      </Region>
    )
  }
  const listings = c.data.listings ?? []
  return (
    <>
      <Region
        index="00"
        label="Collection"
        heading={c.data.title}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-caption text-muted">
          <Link className={`text-ink ${inlineLink}`} to="/marketplace">
            Marketplace
          </Link>{' '}
          · {c.data.featured ? 'featured by Talyvor' : <>curated by <span className="font-figure">{c.data.workspace_id}</span></>} ·
          updated <span className="font-figure">{formatWhen(c.data.updated_at)}</span>
        </p>
        {c.data.description ? <p className="whitespace-pre-wrap text-body text-ink">{c.data.description}</p> : null}
      </Region>
      <Region index="01" label="Listings" fullWidth className="flex flex-col gap-4">
        {listings.length === 0 ? (
          <p className="text-body text-muted">Nothing in this collection can be used just now.</p>
        ) : (
          <ListingGrid listings={listings} label="Listings in this collection" />
        )}
      </Region>
    </>
  )
}

// ── Rooms building this ─────────────────────────────────────────────────────────────────────────────

function RoomsBuildingThis({ words }: { words: string[] }) {
  const rooms = useQuery({ queryKey: [...ROOMS_KEY, ''], queryFn: () => roomsApi.list() })
  const open = (rooms.data?.rooms ?? []).filter((r) => r.status === 'open')
  const shown = roomsOnTopic(open, words).slice(0, ROOMS_SHOWN)
  const topical = words.length > 0
  return (
    <Region index="03" label={topical ? 'Rooms building this' : 'Rooms building now'} fullWidth className="flex flex-col gap-4">
      <p className="max-w-2xl text-body text-muted">
        Open rooms where people and their agents are building {topical ? 'on the same topic' : 'right now'}. Join one
        and build it with them.
      </p>
      {rooms.isError ? (
        <p className="text-body text-muted">{readFailure(rooms.error, 'The rooms')}</p>
      ) : rooms.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : shown.length === 0 ? (
        <p className="text-body text-muted">
          No open room is building this yet.{' '}
          <Link className={`text-ink ${inlineLink}`} to="/rooms/new">
            Open one
          </Link>
          .
        </p>
      ) : (
        <ul className="grid gap-3 wide:grid-cols-2 xl:grid-cols-4" aria-label="Rooms">
          {shown.map((r) => (
            <li
              key={r.id}
              className="relative flex flex-col gap-1 rounded-card border border-rule bg-raised p-4 transition-colors duration-200 hover:border-rule-strong"
              data-testid="discover-room"
            >
              <span className="flex items-center gap-2">
                <NavIcon name="members" className="h-5 w-5 shrink-0 text-accent-strong" />
                <span className="truncate font-figure text-eyebrow uppercase text-label">{r.topic || 'Other'}</span>
              </span>
              <Link
                className={cn('text-head text-ink after:absolute after:inset-0 after:rounded-card', focusRing)}
                to={`/rooms/${encodeURIComponent(r.id)}`}
              >
                {r.title}
              </Link>
              <span className="text-caption text-muted">
                <span className="font-figure">{r.member_count}</span> {r.member_count === 1 ? 'member' : 'members'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Region>
  )
}
