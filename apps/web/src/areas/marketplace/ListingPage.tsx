import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { Card, CardHeader, Row, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { formatWhen } from '../lens/format'
import { kindLabel, marketApi } from './marketApi'
import { Price, readFailure } from './parts'
import { ReportListing } from './Report'
import { UseListing } from './UseListing'

// ListingPage.tsx — B20.3: one listing — what it is, what a use costs, using it, and its versions.
// Lens shows a version's artifact to the listing's owner and nobody else, which is how this page
// knows the listing is this workspace's own.

export function ListingPage() {
  const { id = '' } = useParams()
  const listing = useQuery({ queryKey: ['market-listing', id], queryFn: () => marketApi.listing(id) })
  if (listing.isError || listing.isPending) {
    const missing = listing.error instanceof ApiError && listing.error.status === 404
    return (
      <Region index="00" label="Listing" heading="Marketplace" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="text-body text-muted">
          {listing.isPending
            ? 'Reading…'
            : missing
              ? 'This listing does not exist, or its seller made it private.'
              : readFailure(listing.error, 'This listing')}{' '}
          <Link className={`text-ink ${inlineLink}`} to="/marketplace">
            Back to the marketplace
          </Link>
        </p>
      </Region>
    )
  }
  const l = listing.data
  const versions = l.versions ?? []
  const own = versions.some((v) => v.artifact !== undefined)
  return (
    <>
      <Region
        index="00"
        label={kindLabel(l.kind)}
        heading={l.title}
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-caption text-muted">
          <Link className={`text-ink ${inlineLink}`} to="/marketplace">
            Marketplace
          </Link>{' '}
          · <Price micros={l.price_per_use_ulxc} /> · version <span className="font-figure">{l.latest_version}</span> ·
          published <span className="font-figure">{formatWhen(l.created_at)}</span>
          {own ? ` · yours, ${l.visibility}` : null}
        </p>
        {l.description ? <p className="whitespace-pre-wrap text-body text-ink">{l.description}</p> : null}
        {/* B20.11 — only the seller sees a listing that is not approved, so only the seller reads why. */}
        {l.review_status === 'held' ? (
          <p role="status" className="border-l-2 border-l-held pl-2 text-body text-ink" data-testid="listing-review">
            Held for review{l.review_reason ? `: ${l.review_reason}` : ''}. Only you can see it until Talyvor approves it.
          </p>
        ) : l.review_status === 'taken_down' ? (
          <p role="status" className="border-l-2 border-l-slashed pl-2 text-body text-ink" data-testid="listing-review">
            Taken down by Talyvor{l.review_reason ? `: ${l.review_reason}` : ''}. Nobody can find or use it.
          </p>
        ) : null}
        {own ? null : <ReportListing key={l.id} listing={l} />}
      </Region>
      <Region index="01" label="Use it">
        <UseListing key={l.id} listing={l} own={own} />
      </Region>
      {versions.length > 0 ? (
        <Region index="02" label="Versions">
          <Card>
            <CardHeader>Versions</CardHeader>
            {[...versions].reverse().map((v) => (
              <Row
                key={v.version}
                label={
                  <>
                    Version <span className="font-figure">{v.version}</span>
                  </>
                }
                hint={v.changelog || undefined}
              >
                <span className="font-figure text-caption text-muted">{formatWhen(v.created_at)}</span>
              </Row>
            ))}
          </Card>
        </Region>
      ) : null}
    </>
  )
}
