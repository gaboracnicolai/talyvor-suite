import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Pill, Row } from '@talyvor/ui'
import { newMoveKey } from '../lens/agentBankApi'
import { formatUSD } from '../lens/format'
import { LICENCES_KEY, day } from './Licences'
import { type Listing, type MarketLicence, type Offer, formatDisplay, marketApi, refusalText } from './marketApi'
import { Card, Note, selectClass } from './parts'

// ListingOffers.tsx — B32.57: a listing's offers as choices. Each is a way to pay — per use, rent, buy or subscribe —
// under a personal, commercial or enterprise licence, with what that licence allows in Lens's words (B32.18). Its
// price is shown in the buyer's currency (B32.51): converted at the ECB rate, with "incl. VAT" for a consumer and
// "+ VAT" for a business, beside the US-dollar price it is billed in. Renting, buying or subscribing licenses the offer
// (Lens B32.19) under an Idempotency-Key, so a retried click never buys twice; the licence pins the version picked, or
// follows the latest, and covers this workspace's uses from then on. A per-use offer's free trial uses (B32.21) are
// said here and run from Use it.

const KIND_NAME: Record<Offer['kind'], string> = {
  per_use: 'Pay per use',
  rent: 'Rent',
  buy: 'Buy',
  subscribe: 'Subscribe',
}
const LICENCE_NAME: Record<Offer['licence'], string> = {
  personal: 'Personal',
  commercial: 'Commercial',
  enterprise: 'Enterprise',
}
const HELD_WORD: Record<MarketLicence['kind'], string> = { buy: 'own', rent: 'rent', subscribe: 'subscribe to' }

/** The currencies a buyer may ask for prices in; "" is their own, from their tax profile. */
export const CURRENCIES = ['', 'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN'] as const

function Figure({ children }: { children: React.ReactNode }) {
  return <span className="font-figure">{children}</span>
}

/** What one payment of the offer buys: a use, a rental's days, a subscription's month or year, or the listing for good. */
function per(o: Offer): React.ReactNode {
  switch (o.kind) {
    case 'per_use':
      return 'a use'
    case 'buy':
      return 'once, to own it'
    case 'rent':
      return (
        <>
          for <Figure>{o.period_days ?? 0}</Figure> days
        </>
      )
    case 'subscribe':
      return o.period_days === 365 ? 'a year' : 'a month'
  }
}

/** What else the offer gives: uses included, seats, free trials. */
function details(o: Offer): React.ReactNode[] {
  const out: React.ReactNode[] = []
  if (o.kind === 'rent' || o.kind === 'subscribe') {
    out.push(
      o.included_uses ? (
        <>
          <Figure>{o.included_uses}</Figure> uses included, then billed per use
        </>
      ) : (
        'unlimited uses'
      ),
    )
  }
  if (o.licence === 'enterprise' && o.seats) {
    out.push(
      <>
        up to <Figure>{o.seats}</Figure> people
      </>,
    )
  }
  if (o.kind === 'per_use' && o.trial_uses) {
    out.push(
      <>
        your first <Figure>{o.trial_uses}</Figure> uses are free trials — Trial — test money, not billed
      </>,
    )
  }
  return out
}

/** The offer's price as the buyer reads it: in their currency with its tax label, and the US dollars it is billed in. */
function OfferPrice({ o }: { o: Offer }) {
  const d = o.display
  const usd = formatUSD(o.price_usd_micros)
  return (
    <span className="flex flex-col items-end gap-0.5 text-right">
      <span className="font-figure text-body text-ink" data-testid="offer-price">
        {d ? formatDisplay(d) : usd}
      </span>
      {d?.tax_label ? (
        <span className="text-caption text-muted" data-testid="offer-tax">
          {d.tax_label}
        </span>
      ) : null}
      <span className="text-caption text-muted" data-testid="offer-usd">
        {d && d.currency !== 'USD' ? (
          <>
            billed in US dollars: <Figure>{usd}</Figure>
          </>
        ) : (
          'billed in US dollars'
        )}
      </span>
    </span>
  )
}

function OfferChoice({
  listing,
  o,
  own,
  version,
}: {
  listing: Listing
  o: Offer
  own: boolean
  version: number
}) {
  const qc = useQueryClient()
  const [key, setKey] = useState<string | null>(null)
  const license = useMutation({
    mutationFn: (k: string) => marketApi.license(listing.id, o.id ?? '', version, k),
    onSuccess: () => setKey(null),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: LICENCES_KEY }),
        qc.invalidateQueries({ queryKey: ['market-bill'] }),
      ]),
  })
  const more = details(o)
  const usd = formatUSD(o.price_usd_micros)
  const sellable = !own && o.kind !== 'per_use' && o.id !== undefined
  return (
    <li className="border-b border-rule last:border-b-0" data-testid="listing-offer">
      <Row
        className="border-b-0"
        stack
        label={
          <>
            {KIND_NAME[o.kind]} · {LICENCE_NAME[o.licence]} licence
          </>
        }
        hint={
          <>
            {o.terms ? <span className="block">{o.terms}</span> : null}
            <span className="block">
              {per(o)}
              {more.map((m, i) => (
                <span key={i}>; {m}</span>
              ))}
            </span>
          </>
        }
      >
        <OfferPrice o={o} />
        {sellable && key === null ? <Button onClick={() => setKey(newMoveKey())}>{KIND_NAME[o.kind]}</Button> : null}
      </Row>
      {sellable && key !== null ? (
        <div className="flex flex-col gap-2 px-gutter pb-3">
          <p className="text-caption text-muted">
            {o.kind === 'buy' ? 'You own it from today' : o.kind === 'rent' ? 'A rental starts today' : 'A subscription starts today'}, under
            the {o.licence} licence,{' '}
            {version === 0 ? (
              'following its latest version'
            ) : (
              <>
                pinned to version <Figure>{version}</Figure>
              </>
            )}
            . <Figure>{usd}</Figure> goes on this month’s marketplace bill; uses it covers add nothing to it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={license.isPending} onClick={() => license.mutate(key)}>
              {license.isPending ? (
                'Paying…'
              ) : (
                <>
                  {KIND_NAME[o.kind]} for <Figure>{usd}</Figure>
                </>
              )}
            </Button>
            <Button onClick={() => setKey(null)}>Not now</Button>
          </div>
        </div>
      ) : null}
      {license.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{refusalText(license.error)}</Note>
        </div>
      ) : null}
    </li>
  )
}

/** The licence this workspace holds for the listing, in one line. */
export function HeldLine({ held }: { held: MarketLicence }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-2 text-body text-ink" data-testid="listing-held">
      <Pill status="settled">Licensed</Pill>
      <span>
        You {HELD_WORD[held.kind]} it under the {held.licence} licence
        {held.ends_at ? (
          <>
            {' '}
            until <span className="font-figure">{day(held.ends_at)}</span>
          </>
        ) : null}
        ,{' '}
        {held.pinned_version === null ? (
          'following its latest version'
        ) : (
          <>
            pinned to version <Figure>{held.pinned_version}</Figure>
          </>
        )}
        . Your uses of it add nothing to your bill
        {held.included_uses ? (
          <>
            {' '}
            for its first <Figure>{held.included_uses}</Figure>
          </>
        ) : null}
        .
      </span>
    </p>
  )
}

export function ListingOffers({
  listing,
  own,
  held,
  currency,
  onCurrency,
}: {
  listing: Listing
  own: boolean
  held?: MarketLicence
  currency: string
  onCurrency: (c: string) => void
}) {
  const [version, setVersion] = useState(0)
  const offers = listing.offers ?? []
  const versions = [...(listing.versions ?? [])].reverse()
  const licensable = !own && offers.some((o) => o.kind !== 'per_use')
  return (
    <div className="flex flex-col gap-3">
      {held ? <HeldLine held={held} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-caption text-muted">
          Prices in
          <select className={selectClass} value={currency} onChange={(e) => onCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c === '' ? 'Your currency' : c}
              </option>
            ))}
          </select>
        </label>
        {licensable ? (
          <label className="text-caption text-muted">
            Version
            <select className={selectClass} value={version} onChange={(e) => setVersion(Number(e.target.value))}>
              <option value={0}>Follow the latest</option>
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  Pin version {v.version}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <Card>
        <CardHeader>Offers and licences</CardHeader>
        <ul aria-label="Offers">
          {offers.map((o, i) => (
            <OfferChoice key={o.id ?? i} listing={listing} o={o} own={own} version={version} />
          ))}
        </ul>
      </Card>
      {listing.price_note ? <p className="text-caption text-muted">{listing.price_note}</p> : null}
    </div>
  )
}
