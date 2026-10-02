import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, CardHeader, Input, Pill, Row, focusRing, inlineLink } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { formatULXC } from '../lens/agentBankApi'
import { formatUSD, formatWhen } from '../lens/format'
import { ListingPage } from './ListingPage'
import { ReviewQueue } from './Review'
import {
  type ListingKind,
  KINDS,
  marketApi,
  monthName,
  parsePrice,
  recentMonths,
  refusalText,
  variablesIn,
} from './marketApi'
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

const PAYOUTS_KEY = ['market-payouts']

/** Where a seller is paid, asked before Stripe asks the rest: Stripe fixes an account's country when it is made. */
const COUNTRIES: readonly [string, string][] = [
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
  ['IE', 'Ireland'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['NL', 'Netherlands'],
  ['ES', 'Spain'],
  ['IT', 'Italy'],
  ['SE', 'Sweden'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
]

/** Stripe's requirement names, e.g. `individual.verification.document`, in words. */
const requirement = (field: string) => field.replace(/[._]/g, ' ')

/**
 * B20.6 — the seller is paid (Lens B20.5): connect a Stripe account and see whether Stripe can pay it, the
 * balance and what the next payout comes to after Stripe's fees at cost, every payout, and the choice to
 * take the available balance as Talyvor credits instead. Stripe's onboarding comes back here with ?payouts=.
 */
export function PayoutsCard({
  redirect = (url: string) => window.location.assign(url),
}: {
  /** Leaves for Stripe's onboarding; a prop so a test can see where it would go. */
  redirect?: (url: string) => void
}) {
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [country, setCountry] = useState('GB')
  const payouts = useQuery({ queryKey: PAYOUTS_KEY, queryFn: marketApi.payouts })
  const connect = useMutation({
    mutationFn: (c: string) => marketApi.connectPayouts(c),
    onSuccess: (r) => redirect(r.url),
  })
  const credits = useMutation({
    mutationFn: marketApi.takeAsCredits,
    onSettled: () =>
      Promise.all([qc.invalidateQueries({ queryKey: PAYOUTS_KEY }), qc.invalidateQueries({ queryKey: EARNINGS_KEY })]),
  })
  if (payouts.isError) return <p className="text-body text-muted">{readFailure(payouts.error, 'Your payouts')}</p>
  if (payouts.isPending) return <p className="text-body text-muted">Reading…</p>
  const p = payouts.data
  const acct = p.account
  const due = acct?.currently_due ?? []
  const history = p.payouts ?? []
  const fees = p.quote.account_fee_usd_micros + p.quote.payout_fee_usd_micros
  return (
    <Card>
      <CardHeader>Payouts</CardHeader>
      {params.get('payouts') === 'connected' || params.get('payouts') === 'expired' ? (
        <div className="px-gutter pt-3">
          {params.get('payouts') === 'connected' ? (
            <Note ok>Back from Stripe. Below is what Stripe has told Talyvor about your account.</Note>
          ) : (
            <Note ok={false}>That Stripe link expired. Continue with Stripe for a new one.</Note>
          )}
        </div>
      ) : null}
      {acct === null ? (
        <div className="flex flex-col gap-2 px-gutter py-3" data-testid="payouts-connect">
          <p className="text-body text-ink">
            Connect a Stripe account to be paid your earnings in money. Stripe asks who you are and where to send the
            money; Talyvor never sees your bank details.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-56 text-caption text-muted">
              Where you are paid
              <select className={selectClass} value={country} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" disabled={connect.isPending} onClick={() => connect.mutate(country)}>
              {connect.isPending ? 'Opening Stripe…' : 'Connect with Stripe'}
            </Button>
          </div>
        </div>
      ) : (
        <Row
          label="Stripe account"
          hint={
            acct.payouts_enabled
              ? `Stripe can pay this account (${acct.country}).`
              : due.length > 0
                ? `Stripe still needs: ${due.map(requirement).join(', ')}.`
                : acct.details_submitted
                  ? 'Stripe is checking the details you gave it.'
                  : 'Stripe still needs your details.'
          }
        >
          <div className="flex items-center gap-3" data-testid="payouts-account">
            {acct.payouts_enabled ? (
              <Pill status="settled">Verified</Pill>
            ) : (
              <>
                <Pill status="held">Not verified yet</Pill>
                <Button disabled={connect.isPending} onClick={() => connect.mutate(acct.country)}>
                  Continue with Stripe
                </Button>
              </>
            )}
          </div>
        </Row>
      )}
      {connect.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{refusalText(connect.error)}</Note>
        </div>
      ) : null}
      <Row label="In the holdback" hint="Held for refunds for 14 days after the buyer pays">
        <span className="font-figure text-body text-ink">{formatUSD(p.in_holdback_usd_micros)}</span>
      </Row>
      <Row label="Available to pay out" hint="Past the holdback and not yet paid">
        <span className="font-figure text-body text-ink" data-testid="payouts-available">
          {formatUSD(p.available_usd_micros)}
        </span>
      </Row>
      <Row
        label="Next payout"
        hint={
          p.paid_this_month
            ? 'You were paid this month; the next payout is next month.'
            : p.available_usd_micros >= p.minimum_usd_micros
              ? `${formatUSD(p.quote.gross_usd_micros)} less Stripe’s fees of ${formatUSD(fees)}, at cost. ${acct?.payouts_enabled ? 'Paid once a month to your Stripe account.' : 'Paid once Stripe can pay your account.'}`
              : `Paid once a month, once your available balance reaches ${formatUSD(p.minimum_usd_micros)}.`
        }
      >
        <span className="font-figure text-body text-ink">
          {!p.paid_this_month && p.available_usd_micros >= p.minimum_usd_micros ? formatUSD(p.quote.net_usd_micros) : '—'}
        </span>
      </Row>
      <Row label="Paid out" hint="In money and as credits, since you started selling">
        <span className="font-figure text-body text-ink">{formatUSD(p.paid_out_usd_micros)}</span>
      </Row>
      {p.owed_usd_micros > 0 ? (
        <Row label="Owed" hint="Refunds after you were paid, recovered from your next earnings">
          <span className="font-figure text-body text-ink">{formatUSD(p.owed_usd_micros)}</span>
        </Row>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-rule px-gutter py-3">
        <p className="text-caption text-muted">
          Or take what is available now as Talyvor credits, with no Stripe fees and no minimum.
        </p>
        <div>
          <Button disabled={p.available_usd_micros <= 0 || credits.isPending} onClick={() => credits.mutate()}>
            Take <span className="font-figure">{formatUSD(p.available_usd_micros)}</span> as credits
          </Button>
        </div>
        {credits.isSuccess ? (
          <Note ok>
            <span className="font-figure">{formatUSD(credits.data.gross_usd_micros)}</span> is now{' '}
            <span className="font-figure">{formatULXC(credits.data.credits_ulxc ?? 0)}</span> in your workspace’s credits.
          </Note>
        ) : null}
        {credits.isError ? <Note ok={false}>{refusalText(credits.error)}</Note> : null}
      </div>
      {history.length > 0 ? (
        <table className="w-full border-t border-rule text-body" data-testid="payouts-history">
          <thead>
            <tr className="text-left text-caption text-muted">
              <th className="px-gutter py-2 font-normal">Paid</th>
              <th className="py-2 font-normal">How</th>
              <th className="py-2 text-right font-normal">Earnings</th>
              <th className="px-gutter py-2 text-right font-normal">You got</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t border-rule text-ink">
                <td className="px-gutter py-2 font-figure text-caption text-muted">
                  {h.paid_at ? formatWhen(h.paid_at) : h.last_error ? 'Stripe refused — retrying' : 'Sending'}
                </td>
                <td className="py-2">{h.method === 'credits' ? 'As credits' : 'To your Stripe account'}</td>
                <td className="py-2 text-right font-figure">{formatUSD(h.gross_usd_micros)}</td>
                <td className="px-gutter py-2 text-right font-figure">
                  {h.method === 'credits' ? formatULXC(h.credits_ulxc ?? 0) : formatUSD(h.net_usd_micros)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="border-t border-rule px-gutter py-3 text-body text-muted">No payouts yet.</p>
      )}
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
        <PayoutsCard />
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

// ── The buyer's bill: the paid listings this workspace used, month by month ───────────────────────

function Bill() {
  const months = recentMonths(new Date())
  const [month, setMonth] = useState(months[0])
  const bill = useQuery({ queryKey: ['market-bill', month], queryFn: () => marketApi.bill(month) })
  const lines = bill.data?.lines ?? []
  return (
    <Region
      index="00"
      label="Your bill"
      heading="What your workspace used in the marketplace"
      sectionClassName="pb-10 pt-4 wide:pb-12"
      className="flex max-w-2xl flex-col gap-3"
    >
      <p className="text-body text-muted">
        Every paid listing your workspace or its agents used, billed on your card each month — never taken from your
        credits. The models a listing calls are on your usual bill, not here.
      </p>
      <label className="text-caption text-muted">
        Month
        <select className={`${selectClass} w-56`} value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
      </label>
      {bill.isError ? (
        <p className="text-body text-muted">{readFailure(bill.error, 'Your bill')}</p>
      ) : bill.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : (
        <Card>
          <CardHeader>{monthName(bill.data.month || month)}</CardHeader>
          {lines.map((l) => (
            <Row
              key={l.use_id}
              label={
                // A payment to another company's agent (B19.15) has no listing, so there is no page to link to.
                l.listing_id ? (
                  <Link className={`text-ink ${inlineLink}`} to={`/marketplace/listings/${encodeURIComponent(l.listing_id)}`}>
                    {l.title || l.listing_id}
                  </Link>
                ) : (
                  l.title || 'Payment to an agent'
                )
              }
              hint={
                <>
                  <span className="font-figure">{formatWhen(l.used_at)}</span>
                  {l.agent_id ? ' · by an agent' : ''} · {l.cleared_at ? 'paid' : 'not yet paid'}
                </>
              }
            >
              <span className="font-figure text-body text-ink">{formatULXC(l.price_ulxc)}</span>
            </Row>
          ))}
          <Row
            label="Total"
            hint={lines.length > 0 ? 'Billed on your card for this month' : 'No paid listing was used this month'}
          >
            <span className="font-figure text-body text-ink" data-testid="market-bill-total">
              {formatULXC(bill.data.total_ulxc)} · {formatUSD(bill.data.total_usd_micros)}
            </span>
          </Row>
        </Card>
      )}
    </Region>
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
        <Route path="bill" element={<Bill />} />
        <Route path="review" element={<ReviewQueue />} />
        {/* Anything else under /marketplace/* lands on the catalog rather than a dead end. */}
        <Route path="*" element={<Browse />} />
      </Routes>
    </RegionScreen>
  )
}
