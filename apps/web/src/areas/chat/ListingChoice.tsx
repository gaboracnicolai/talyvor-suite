import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { cn, focusRing, inlineLink } from '@talyvor/ui'

import { formatULXC } from '../lens/agentBankApi'
import { marketApi } from '../marketplace/marketApi'
import type { AnswerListing, ChatListing } from './chatApi'

// B28.426 — a marketplace listing used in Chat. "Use in Chat" on a skill's listing page opens a new chat the listing is
// attached to. The choice is kept with the conversation (history.ts), every question in it goes to Lens
// naming the listing (chatApi.ts LISTING_HEADER), and Lens asks it through the listing and charges the use as a
// marketplace use (talyvor-lens B28.186). Under each answer the screen says how the use was charged only as Lens said it.

function listingHref(id: string): string {
  return `/marketplace/listings/${encodeURIComponent(id)}`
}

/** Under the composer: the listing this conversation is asked through, what each question costs, and Remove. */
export function ListingChip({ listing, onRemove, disabled }: { listing: ChatListing; onRemove: () => void; disabled: boolean }) {
  // The price Lens charges is the listing's now, read again with the listing page's query; until it is, the one it had when attached.
  const live = useQuery({ queryKey: ['market-listing', listing.id, ''], queryFn: () => marketApi.listing(listing.id), retry: false, staleTime: 60_000 })
  const price = live.data?.price_per_use_ulxc ?? listing.price_per_use_ulxc
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-muted" data-testid="chat-listing">
      <span className="font-figure text-eyebrow uppercase text-label">Listing</span>
      <Link className={`text-ink ${inlineLink}`} to={listingHref(listing.id)}>
        {listing.title}
      </Link>
      <span>
        {price > 0 ? (
          <>
            · <span className="font-figure">{formatULXC(price)}</span> a question, on your marketplace bill
          </>
        ) : (
          '· free to use'
        )}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        className={cn('rounded-control px-1 text-muted transition-colors duration-200 hover:text-ink disabled:opacity-50', focusRing)}
      >
        Remove
      </button>
    </p>
  )
}

const CHARGED: Record<string, string> = {
  billed: 'its use is on your marketplace bill for this month',
  free: 'the listing is free',
  own: 'your own listing, so nothing was charged for it',
  linked: 'your workspace and the seller’s are linked, so nothing was charged for it',
  licensed: 'covered by your licence: nothing new goes on your bill',
  trial: 'a trial use — test money, not billed',
}

/** Under an answer asked through a listing: how Lens said it charged the use, or that Lens did not say it used it. */
export function ListingLine({ listing }: { listing: AnswerListing }) {
  const said = listing.charge !== undefined ? CHARGED[listing.charge] : undefined
  const name = (
    <Link className={`font-figure ${inlineLink}`} to={listingHref(listing.id)}>
      {listing.title}
    </Link>
  )
  return (
    <p className="ml-1 w-full text-caption text-muted" data-testid="turn-listing" data-charge={listing.charge ?? ''}>
      {said !== undefined ? (
        <>
          Asked through {name} · {said}
        </>
      ) : (
        <>Lens did not say this answer used the listing {name}.</>
      )}
    </p>
  )
}
