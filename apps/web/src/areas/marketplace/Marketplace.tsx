import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'
import { Button, Card, CardHeader, Input, Row, focusRing, inlineLink } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { formatUSD } from '../lens/format'
import { ListingPage } from './ListingPage'
import { type ListingKind, KINDS, marketApi, parsePrice, refusalText, variablesIn } from './marketApi'
import { CATALOG_KEY, EARNINGS_KEY, ListingRow, MINE_KEY, Note, readFailure, selectClass, useRunnableModels } from './parts'

// Marketplace.tsx — B20.3: the marketplace. Browse and search what other teams published (agents,
// prompts, skills, evaluations and pipelines — Lens B20.1), open a listing and use it (ListingPage;
// B20.2: run through Lens as this workspace, a paid listing's price metered onto its monthly
// marketplace bill, never taken from prepaid credits), publish one, and read what this workspace's
// listings earned.
//
// Lens decides everything: who may publish (the workspace's owner or an admin), whether a listing
// carries a secret, personal data or an injection, what a use costs and who earns. These screens show
// Lens's figures and, on a refusal, Lens's own sentence.

// ── Browse ─────────────────────────────────────────────────────────────────────────────────────────

function Browse() {
  const [kind, setKind] = useState<ListingKind | ''>('')
  const [search, setSearch] = useState('')
  const catalog = useQuery({ queryKey: [...CATALOG_KEY, kind], queryFn: () => marketApi.catalog(kind) })
  const words = search.trim().toLowerCase()
  const shown = (catalog.data ?? []).filter(
    (l) => words === '' || `${l.title} ${l.description}`.toLowerCase().includes(words),
  )
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
      <Region index="01" label="Browse" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Search listings"
            placeholder="Search"
            className="w-56"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button aria-pressed={kind === ''} variant={kind === '' ? 'primary' : undefined} onClick={() => setKind('')}>
            Everything
          </Button>
          {KINDS.map((k) => (
            <Button
              key={k.kind}
              aria-pressed={kind === k.kind}
              variant={kind === k.kind ? 'primary' : undefined}
              onClick={() => setKind(k.kind)}
            >
              {k.plural}
            </Button>
          ))}
        </div>
        {catalog.isError ? (
          <p className="text-body text-muted">{readFailure(catalog.error, 'The marketplace')}</p>
        ) : catalog.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : shown.length === 0 ? (
          <p className="text-body text-muted">
            {words !== '' ? 'Nothing published matches that search.' : 'Nothing is published here yet.'}
          </p>
        ) : (
          <Card>
            <CardHeader>Listings</CardHeader>
            {shown.map((l) => (
              <ListingRow key={l.id} l={l} />
            ))}
          </Card>
        )}
      </Region>
    </>
  )
}

// ── Publish ────────────────────────────────────────────────────────────────────────────────────────

/** What each kind's artifact needs, as the seller writes it (Lens market.requiredField). */
const ARTIFACT: Record<ListingKind, { field: string; label: string; hint: string }> = {
  agent: { field: 'system_prompt', label: 'System prompt', hint: 'How the agent behaves, as you run it.' },
  prompt: { field: 'template', label: 'Template', hint: 'Write {{name}} where the person using it fills in a value.' },
  skill: { field: 'instructions', label: 'Instructions', hint: 'What the model should do with the person’s input.' },
  evaluation: {
    field: 'cases',
    label: 'Cases',
    hint: 'One case per line: what to ask, then =>, then what a good answer must contain.',
  },
  pipeline: { field: 'steps', label: 'Steps', hint: 'One step per line.' },
}

type Visibility = 'public' | 'unlisted' | 'private'

const VISIBILITY: readonly [Visibility, string][] = [
  ['public', 'Public — anyone can find it'],
  ['unlisted', 'Unlisted — only people with the link'],
  ['private', 'Private — only this workspace'],
]

function artifactOf(kind: ListingKind, body: string, model: string): Record<string, unknown> {
  const lines = body
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const value =
    kind === 'evaluation'
      ? lines.map((line) => {
          const [input, ...rest] = line.split('=>')
          return { input: input.trim(), expected: rest.join('=>').trim() }
        })
      : kind === 'pipeline'
        ? lines
        : body
  return model ? { [ARTIFACT[kind].field]: value, model } : { [ARTIFACT[kind].field]: value }
}

function Publish() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { runnable } = useRunnableModels()
  const [kind, setKind] = useState<ListingKind>('prompt')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [body, setBody] = useState('')
  const [model, setModel] = useState('')
  const [changelog, setChangelog] = useState('')
  const micros = parsePrice(price)
  const publish = useMutation({
    mutationFn: () =>
      marketApi.publish({
        kind,
        title: title.trim(),
        description: description.trim(),
        price_per_use_ulxc: micros ?? 0,
        visibility,
        artifact: artifactOf(kind, body, model),
        changelog: changelog.trim(),
      }),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: MINE_KEY })
      void qc.invalidateQueries({ queryKey: CATALOG_KEY })
      navigate(`/marketplace/listings/${encodeURIComponent(l.id)}`)
    },
  })
  const vars = kind === 'prompt' ? variablesIn(body) : []
  const ready = title.trim() !== '' && body.trim() !== '' && micros !== null
  return (
    <Region
      index="00"
      label="Publish"
      heading="Publish a listing"
      sectionClassName="pb-10 pt-4 wide:pb-12"
      className="flex max-w-2xl flex-col gap-3"
    >
      <p className="text-body text-muted">
        Lens checks every listing before it is published and refuses one carrying a secret, personal data or a prompt
        injection. Buyers pay per use on their monthly bill; what they pay reaches you after their payment clears and a
        holdback for refunds.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !publish.isPending) publish.mutate()
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
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
          <label className="text-caption text-muted">
            Visibility
            <select
              className={selectClass}
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
            >
              {VISIBILITY.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-caption text-muted">
            Price per use, in LXC
            <Input
              className="mt-1 block w-32 font-figure"
              inputMode="decimal"
              placeholder="Free"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-caption text-muted">
          Title
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          Description
          <textarea
            className={`min-h-28 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {ARTIFACT[kind].label}
          <textarea
            className={`min-h-40 w-full rounded-control border border-rule bg-surface p-3 font-mono text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            spellCheck={false}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <span>{ARTIFACT[kind].hint}</span>
        </label>
        {vars.length > 0 ? (
          <p className="text-caption text-muted">Whoever uses it fills in: {vars.join(', ')}.</p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-caption text-muted">
            Model
            <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">The buyer chooses</option>
              {runnable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex grow flex-col gap-1 text-caption text-muted">
            What this version is
            <Input value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="First version" />
          </label>
        </div>
        {micros === null ? <Note ok={false}>A price is an amount of LXC, like 0.5 — or empty for free.</Note> : null}
        <div>
          <Button type="submit" variant="primary" disabled={!ready || publish.isPending}>
            {publish.isPending ? 'Publishing…' : 'Publish'}
          </Button>
        </div>
        {publish.isError ? <Note ok={false}>{refusalText(publish.error)}</Note> : null}
      </form>
    </Region>
  )
}

// ── Selling: this workspace's listings and what they earned ────────────────────────────────────────

function EarningsCard() {
  const earnings = useQuery({ queryKey: EARNINGS_KEY, queryFn: marketApi.earnings })
  if (earnings.isError) return <p className="text-body text-muted">{readFailure(earnings.error, 'Your earnings')}</p>
  if (earnings.isPending) return <p className="text-body text-muted">Reading…</p>
  const e = earnings.data
  return (
    <Card>
      <CardHeader>Earnings</CardHeader>
      <Row
        label="Waiting for buyers to pay"
        hint={
          <>
            <span className="font-figure">{e.pending_uses}</span> {e.pending_uses === 1 ? 'use' : 'uses'} on bills not
            yet paid
          </>
        }
      >
        <span className="font-figure text-body text-ink" data-testid="market-pending">
          {formatUSD(e.pending_usd_micros)}
        </span>
      </Row>
      <Row label="Earned" hint="Your share of every use whose bill was paid">
        <span className="font-figure text-body text-ink">{formatUSD(e.payable_usd_micros)}</span>
      </Row>
      <Row label="In the holdback" hint="Held for refunds after the buyer pays">
        <span className="font-figure text-body text-ink">{formatUSD(e.in_holdback_usd_micros)}</span>
      </Row>
      <Row label="Available" hint="Past the holdback">
        <span className="font-figure text-body text-ink">{formatUSD(e.available_usd_micros)}</span>
      </Row>
      <Row label="Lifetime sales" hint="Everything buyers have paid for your listings">
        <span className="font-figure text-body text-ink">{formatUSD(e.lifetime_gross_usd_micros)}</span>
      </Row>
    </Card>
  )
}

function Selling() {
  const mine = useQuery({ queryKey: MINE_KEY, queryFn: marketApi.mine })
  return (
    <>
      <Region
        index="00"
        label="Selling"
        heading="What your listings earned"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          A buyer’s use of your listing earns you its price once their monthly bill is paid. You keep all of your first
          million dollars in sales. Your own uses, and uses by a workspace linked to yours, earn nothing.
        </p>
        <EarningsCard />
      </Region>
      <Region index="01" label="Your listings" className="flex max-w-2xl flex-col gap-3">
        {mine.isError ? (
          <p className="text-body text-muted">{readFailure(mine.error, 'Your listings')}</p>
        ) : mine.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : mine.data.length === 0 ? (
          <p className="text-body text-muted">
            You have not published anything yet.{' '}
            <Link className={`text-ink ${inlineLink}`} to="/marketplace/publish">
              Publish a listing
            </Link>
          </p>
        ) : (
          <Card>
            <CardHeader>Your listings</CardHeader>
            {mine.data.map((l) => (
              <ListingRow key={l.id} l={l} />
            ))}
          </Card>
        )}
      </Region>
    </>
  )
}

export function MarketplaceArea() {
  return (
    <RegionScreen>
      <Routes>
        <Route index element={<Browse />} />
        <Route path="listings/:id" element={<ListingPage />} />
        <Route path="publish" element={<Publish />} />
        <Route path="selling" element={<Selling />} />
        {/* Anything else under /marketplace/* lands on the catalog rather than a dead end. */}
        <Route path="*" element={<Browse />} />
      </Routes>
    </RegionScreen>
  )
}
