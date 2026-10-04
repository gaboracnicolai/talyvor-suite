import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, Pill, Row, focusRing, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { isSessionExpired } from '../../lib/productState'
import { formatULXC } from '../lens/agentBankApi'
import { formatUSD, formatWhen } from '../lens/format'
import { TRAIL_KEY } from '../lens/OperatorTrail'
import {
  type Listing,
  MarketError,
  type QueueItem,
  REPORT_REASONS,
  type Takedown,
  kindLabel,
  marketApi,
  refusalText,
} from './marketApi'
import { Note, Price, readFailure } from './parts'

// Review.tsx — B20.12: Talyvor's marketplace review queue, for operators. Lens (B20.4) lists every
// listing held at review and every one with an open report, most reported first; the operator keeps
// one up (its reports close as kept) or takes it down with a reason, and Lens refunds every use of it
// still inside the holdback and answers the refunds it wrote. The BFF reaches Lens on its moderator
// key (apps/bff/market_review.go) and names the signed-in operator on every call.

const REVIEW_KEY = ['market-review']

const reasonLabel = (r: string) => REPORT_REASONS.find(([v]) => v === r)?.[1] ?? r

type Decision = { approved: Listing } | { takedown: Takedown }

/** The BFF's own 501 and 502 sentences name what to fix (the moderator key unset, wrong or revoked). */
const configSentence = (err: unknown) =>
  err instanceof MarketError && err.sentence && (err.status === 501 || err.status === 502) ? err.sentence : ''

function queueFailure(err: unknown): string {
  if (isSessionExpired(err)) return readFailure(err, 'The review queue')
  if (err instanceof MarketError && err.status === 403) return 'Only Talyvor’s operators can see the review queue.'
  return configSentence(err) || readFailure(err, 'The review queue')
}

const decisionFailure = (err: unknown) => configSentence(err) || refusalText(err)

export function ReviewQueue() {
  const client = useQueryClient()
  const queue = useQuery({ queryKey: REVIEW_KEY, queryFn: marketApi.reviewQueue })
  const [decided, setDecided] = useState<Decision[]>([])
  const onDecided = (d: Decision) => {
    setDecided((was) => [d, ...was])
    void client.invalidateQueries({ queryKey: REVIEW_KEY })
    void client.invalidateQueries({ queryKey: TRAIL_KEY })
  }
  return (
    <>
      <Region
        index="00"
        label="Review"
        heading="Review queue"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          Listings held at review and listings someone reported, most reported first. Approve keeps a listing up and
          closes its reports. Take down removes it for good and refunds every use of it still inside the holdback.
        </p>
        {queue.isError ? (
          <p className="text-body text-muted">{queueFailure(queue.error)}</p>
        ) : queue.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : queue.data.length === 0 ? (
          <p className="text-body text-muted">
            Nothing is waiting for review. A listing appears here when someone reports it or Lens holds it at publishing.
          </p>
        ) : (
          queue.data.map((q) => <QueueCard key={q.listing.id} item={q} onDecided={onDecided} />)
        )}
      </Region>
      {decided.length > 0 ? (
        <Region index="01" label="Decided" className="flex max-w-2xl flex-col gap-3">
          {decided.map((d) =>
            'approved' in d ? (
              <Note key={`a-${d.approved.id}`} ok>
                Approved “{d.approved.title}”: it stays up and its reports are closed.
              </Note>
            ) : (
              <TakenDown key={`t-${d.takedown.listing.id}`} t={d.takedown} />
            ),
          )}
        </Region>
      ) : null}
    </>
  )
}

function QueueCard({ item, onDecided }: { item: QueueItem; onDecided: (d: Decision) => void }) {
  const l = item.listing
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const approve = useMutation({ mutationFn: () => marketApi.approve(l.id), onSuccess: (x) => onDecided({ approved: x }) })
  const takedown = useMutation({
    mutationFn: () => marketApi.takedown(l.id, reason.trim()),
    onSuccess: (t) => onDecided({ takedown: t }),
  })
  const busy = approve.isPending || takedown.isPending
  const reasons = item.report_reasons ?? []
  const details = item.report_details ?? []
  return (
    <Card data-testid="review-item">
      <CardHeader>
        {/* Only its seller can open a held listing's page, so a held one is not a link. */}
        {l.review_status === 'held' ? (
          l.title
        ) : (
          <Link className={`text-ink ${inlineLink}`} to={`/marketplace/listings/${encodeURIComponent(l.id)}`}>
            {l.title}
          </Link>
        )}
      </CardHeader>
      <Row label={kindLabel(l.kind)} hint={l.description || undefined}>
        {l.review_status === 'held' ? <Pill status="held">Held for review</Pill> : null}
        <span className="text-body text-ink">
          <Price micros={l.price_per_use_ulxc} />
        </span>
      </Row>
      {l.review_status === 'held' && l.review_reason ? <Row label="Why it is held" hint={l.review_reason} /> : null}
      <Row
        label="Open reports"
        hint={reasons.length > 0 ? reasons.map(reasonLabel).join(' · ') : 'Nobody has reported it; Lens held it.'}
      >
        <span className="font-figure text-body text-ink">{item.open_reports}</span>
      </Row>
      {details.length > 0 ? (
        <ul className="flex flex-col gap-1 border-b border-rule px-gutter py-3">
          {details.map((d, i) => (
            <li key={i} className="whitespace-pre-wrap border-l-2 border-l-rule pl-2 text-body text-ink">
              {d}
            </li>
          ))}
        </ul>
      ) : null}
      <Row label="Seller" hint={<span className="font-figure">{l.workspace_id}</span>} />
      <div className="flex flex-col gap-2 px-gutter py-3">
        {confirming ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (reason.trim() !== '' && !busy) takedown.mutate()
            }}
          >
            <label className="flex flex-col gap-1 text-caption text-muted">
              Why it is taken down (its seller reads this)
              <textarea
                className={`min-h-20 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={reason.trim() === '' || busy}>
                {takedown.isPending ? 'Taking down…' : 'Take down and refund'}
              </Button>
              <Button type="button" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => approve.mutate()} disabled={busy}>
              {approve.isPending ? 'Approving…' : 'Approve'}
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={busy}>
              Take down
            </Button>
          </div>
        )}
        {approve.isError ? <Note ok={false}>{decisionFailure(approve.error)}</Note> : null}
        {takedown.isError ? <Note ok={false}>{decisionFailure(takedown.error)}</Note> : null}
      </div>
    </Card>
  )
}

function TakenDown({ t }: { t: Takedown }) {
  const refunds = t.refunds ?? []
  return (
    <Card data-testid="takedown-result">
      <CardHeader>Taken down: {t.listing.title}</CardHeader>
      {t.listing.review_reason ? <Row label="Reason" hint={t.listing.review_reason} /> : null}
      {/* Rendered only from a takedown Lens answered; a refused one is the error under its card. */}
      <Row
        label="Refunds"
        hint={
          refunds.length > 0
            ? 'Every billed use still inside the holdback, one row per use'
            : 'No use of it was inside the holdback, so nobody was refunded.'
        }
      >
        <span className="font-figure text-body text-ink">{refunds.length}</span>
      </Row>
      {refunds.map((r) => (
        <Row
          key={r.use_id}
          label={<span className="font-figure">{r.buyer_workspace_id}</span>}
          hint={
            <>
              refunded <span className="font-figure">{formatWhen(r.refunded_at)}</span> ·{' '}
              {r.credited_at ? 'credited through Stripe' : 'Stripe credit pending'}
            </>
          }
        >
          <span className="font-figure text-body text-ink">
            {formatULXC(r.price_ulxc)} · {formatUSD(r.gross_usd_micros)}
          </span>
        </Row>
      ))}
      {t.credit_error ? (
        <Row label="Not credited yet" hint={`Stripe did not accept a credit: ${t.credit_error}. Lens retries it.`} />
      ) : null}
    </Card>
  )
}
