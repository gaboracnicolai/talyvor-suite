import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, CardHeader, Pill, Row, inlineLink } from '@talyvor/ui'
import { day } from './Licences'
import type { Ancestor, Listing, ListingTrust } from './marketApi'
import { Card } from './parts'

// ListingTrust.tsx — B32.57: what a buyer reads before paying, from Lens's one trust read (B32.49). The trust panel:
// whether the publisher is verified (payouts enabled and no IP claim upheld against its listings in a year — and if
// not, why not), the reviews of buyers who paid and are not linked to the seller, the eval score of the version a buyer
// would run, and the IP claims against it. The family tree: the originals it builds on with the share of each sale
// each one is given, how many remixes build on it, and — when its seller allows it — Remix this, with the terms a
// remix is made under.

function Figure({ children }: { children: React.ReactNode }) {
  return <span className="font-figure">{children}</span>
}

/** 1000 basis points → `10%`; 1250 → `12.5%`. */
export function percent(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`
}

export function TrustPanel({ trust }: { trust: ListingTrust }) {
  const { publisher: p, reviews: r, eval: ev, claims: c } = trust
  const recent = (r.recent ?? []).slice(0, 3)
  return (
    <Card data-testid="listing-trust">
      <CardHeader>Before you pay</CardHeader>
      <Row
        stack
        label="Publisher"
        hint={
          p.verified
            ? 'Payouts are enabled and no IP claim against its listings was upheld in the last 12 months.'
            : `Not verified: ${(p.not_verified_because ?? []).join('; ')}.`
        }
      >
        {p.verified ? <Pill status="settled">Verified publisher</Pill> : <Pill status="held">Not verified</Pill>}
      </Row>
      <Row
        stack
        label="Reviews"
        hint={r.count > 0 ? 'Only from buyers who paid for it and are not linked to its seller.' : 'No paying buyer has reviewed it yet.'}
      >
        {r.count > 0 ? (
          <span className="text-body text-ink" data-testid="trust-reviews">
            <Figure>{r.average.toFixed(2)}</Figure> of <Figure>5</Figure> from <Figure>{r.count}</Figure>{' '}
            {r.count === 1 ? 'review' : 'reviews'}
          </span>
        ) : null}
      </Row>
      <Row stack label="Evaluation" hint={ev ? `Its latest stored eval run, on ${day(ev.ran_at)}.` : 'No evaluation has been run on it yet.'}>
        {ev ? (
          <span className="text-body text-ink" data-testid="trust-eval">
            <Figure>{ev.passed}</Figure> of <Figure>{ev.cases}</Figure> cases passed on version <Figure>{ev.version}</Figure>
          </span>
        ) : null}
      </Row>
      <Row stack label="IP claims" hint="Claims that it copies someone else’s work, and how Talyvor decided them.">
        <span className="text-body text-ink" data-testid="trust-claims">
          {c.open + c.upheld + c.attributed + c.rejected === 0 ? (
            'None'
          ) : (
            <>
              <Figure>{c.open}</Figure> open · <Figure>{c.upheld}</Figure> upheld · <Figure>{c.rejected}</Figure> rejected
            </>
          )}
        </span>
      </Row>
      {recent.length > 0 ? (
        <ul aria-label="Newest reviews" className="flex flex-col">
          {recent.map((v) => (
            <li key={v.id} className="flex flex-col gap-1 border-t border-rule px-gutter py-3">
              <span className="text-caption text-muted">
                <Figure>{v.rating}</Figure> of <Figure>5</Figure> · {day(v.created_at)}
              </span>
              {v.text ? <p className="whitespace-pre-wrap text-body text-ink">{v.text}</p> : null}
              {v.reply ? <p className="text-caption text-muted">The seller replied: {v.reply}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

function Original({ a }: { a: Ancestor }) {
  return (
    <Row
      stack
      label={
        a.hidden || !a.title ? (
          'A listing you cannot see'
        ) : (
          <Link className={`text-ink ${inlineLink}`} to={`/marketplace/listings/${encodeURIComponent(a.listing_id)}`}>
            {a.title}
          </Link>
        )
      }
      hint={
        <>
          Version <Figure>{a.version}</Figure>
          {a.depth > 1 ? (
            <>
              {' '}
              · <Figure>{a.depth}</Figure> generations up
            </>
          ) : null}
        </>
      }
    >
      <span className="text-body text-ink" data-testid="original-share">
        <Figure>{percent(a.share_bps)}</Figure> of each sale
      </span>
    </Row>
  )
}

export function FamilyTree({ listing, trust, own }: { listing: Listing; trust: ListingTrust; own: boolean }) {
  const [terms, setTerms] = useState(false)
  const originals = trust.originals ?? []
  const policy = listing.remix_policy ?? 'none'
  const remixable = !own && (policy === 'free' || policy === 'royalty')
  return (
    <div className="flex flex-col gap-3">
      <Card data-testid="listing-family">
        <CardHeader>Family tree</CardHeader>
        {originals.length > 0 ? (
          <ul aria-label="Originals">
            {originals.map((a) => (
              <li key={`${a.listing_id}:${a.version}:${a.child_listing_id}`}>
                <Original a={a} />
              </li>
            ))}
          </ul>
        ) : (
          <Row label="An original" hint="It builds on no other listing." />
        )}
        <Row
          label="Remixes"
          hint={
            policy === 'royalty' ? (
              <>
                Others may remix it for <Figure>{percent(listing.remix_share_bps ?? 0)}</Figure> of each remix’s sales.
              </>
            ) : policy === 'free' ? (
              'Others may remix it freely.'
            ) : (
              'Its seller does not allow remixes.'
            )
          }
        >
          <span className="text-body text-ink" data-testid="family-remixes">
            <Figure>{trust.remixes}</Figure> {trust.remixes === 1 ? 'remix builds' : 'remixes build'} on it
          </span>
        </Row>
      </Card>
      {remixable ? (
        <div className="flex flex-col gap-2">
          <span>
            <Button aria-expanded={terms} onClick={() => setTerms((t) => !t)}>
              Remix this
            </Button>
          </span>
          {terms ? (
            <p className="text-body text-ink" data-testid="remix-terms">
              {policy === 'royalty' ? (
                <>
                  Its remix licence gives it <Figure>{percent(listing.remix_share_bps ?? 0)}</Figure> of each sale of your
                  remix, locked at that share when you remix it; you keep the rest.
                </>
              ) : (
                'Its remix licence is free: your remix owes it nothing, and its seller is credited as the original.'
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
