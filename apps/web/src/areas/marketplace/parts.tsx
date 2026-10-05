import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { type CardProps, NavIcon, type NavIconName, Pill, Card as UiCard, cn, focusRing } from '@talyvor/ui'
import { api } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { fetchModels } from '../chat/chatApi'
import { formatULXC } from '../lens/agentBankApi'
import { type Listing, type ListingKind, kindLabel, priceText } from './marketApi'

// parts.tsx — B20.3: what the marketplace's screens share.
//
// B29.11 — and the marketplace in the brand: every card on the raised plane, a listing as the board's
// product card (its kind's line icon, its seller, its price in IBM Plex Mono and an arrow), and a seller's
// figures as tiles under an eyebrow.

export const selectClass = `mt-1 block h-8 w-full rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`

export const CATALOG_KEY = ['market-catalog']
export const MINE_KEY = ['market-mine']
export const EARNINGS_KEY = ['market-earnings']

export function Note({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p role={ok ? 'status' : 'alert'} className="text-body text-ink">
      {children}
    </p>
  )
}

export function readFailure(err: unknown, what: string): string {
  return isSessionExpired(err) ? `${what} can’t be read until you sign in again.` : `${what} could not be read just now.`
}

export function Price({ micros }: { micros: number }) {
  return micros > 0 ? <span className="font-figure">{priceText(micros)}</span> : <span>Free</span>
}

/** Models a listing can run on: Lens runs a use through its OpenAI or Anthropic proxy lane by the model's name. */
export function useRunnableModels() {
  const models = useQuery({ queryKey: ['models'], queryFn: fetchModels })
  const runnable = (models.data ?? []).filter((m) => (m.provider === 'openai' || m.provider === 'anthropic') && !m.deprecated)
  return { models, runnable }
}

/** A marketplace card, on the board's raised plane. */
export function Card(props: CardProps) {
  return <UiCard raised {...props} />
}

/** Each kind's line icon: a skill, an evaluation and a pipeline wear the brand's layers, prove and route. */
export const KIND_ICON: Record<ListingKind, NavIconName> = {
  agent: 'agent',
  prompt: 'prompt',
  skill: 'layers',
  evaluation: 'prove',
  pipeline: 'route',
}

/** A toggle's on state (`aria-pressed`): the tint and a teal edge, never the primary fill. */
export const pressed = 'aria-pressed:border-accent aria-pressed:bg-accent-tint'

/** The signed-in workspace, to tell the listings it sells from everyone else's. */
function useWorkspaceID(): string | undefined {
  return useQuery({ queryKey: ['context'], queryFn: api.context, staleTime: 60_000 }).data?.workspace_id
}

/**
 * One listing as the board's product card: its kind's icon and name, its title (the link, stretched over
 * the card), what it does, who sells it and what a use costs. Lens names a seller by its workspace; `own`
 * says the listing is this workspace's, as everything under Your listings is. A `preview` — the card a
 * listing being written will make — links nowhere.
 */
export function ListingCard({ l, own, preview = false }: { l: Listing; own?: boolean; preview?: boolean }) {
  const workspace = useWorkspaceID()
  const mine = own ?? l.workspace_id === workspace
  return (
    <li
      className="relative flex flex-col gap-3 rounded-card border border-rule bg-raised p-4 transition-colors duration-200 hover:border-rule-strong"
      data-testid={preview ? 'listing-preview' : 'listing-card'}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2">
          <NavIcon name={KIND_ICON[l.kind] ?? 'grid'} className="h-6 w-6 text-accent-strong" />
          <span className="font-figure text-eyebrow uppercase text-label">{kindLabel(l.kind)}</span>
        </span>
        <NavIcon name="arrow" className="h-4 w-4 text-muted" />
      </span>
      <span className="flex flex-col gap-1">
        {preview ? (
          <span className="text-head text-ink">{l.title}</span>
        ) : (
          <Link
            className={cn('text-head text-ink after:absolute after:inset-0 after:rounded-card', focusRing)}
            to={`/marketplace/listings/${encodeURIComponent(l.id)}`}
          >
            {l.title}
          </Link>
        )}
        {l.description ? <span className="line-clamp-2 text-body text-muted">{l.description}</span> : null}
      </span>
      {l.review_status === 'held' || l.review_status === 'taken_down' ? (
        <span className="flex">
          {l.review_status === 'held' ? <Pill status="held">Held for review</Pill> : <Pill status="slashed">Taken down</Pill>}
        </span>
      ) : null}
      <span className="mt-auto flex items-end justify-between gap-3 border-t border-rule pt-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-figure text-eyebrow uppercase text-label">Seller</span>
          {mine ? (
            <span className="text-body text-ink">You</span>
          ) : (
            <span className="truncate font-figure text-body text-ink" title={l.workspace_id}>
              {l.workspace_id}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="font-figure text-eyebrow uppercase text-label">A use</span>
          <span className="font-figure text-body text-ink" data-testid="listing-price">
            {l.price_per_use_ulxc > 0 ? formatULXC(l.price_per_use_ulxc) : 'Free'}
          </span>
        </span>
      </span>
    </li>
  )
}

/** Listings as a grid of cards: one column on a phone, two from `wide`, three on a broad screen. */
export function ListingGrid({ listings, own, label }: { listings: Listing[]; own?: boolean; label: string }) {
  return (
    <ul className="grid gap-3 wide:grid-cols-2 xl:grid-cols-3" aria-label={label}>
      {listings.map((l) => (
        <ListingCard key={l.id} l={l} own={own} />
      ))}
    </ul>
  )
}

/** A seller's figure: an eyebrow, the amount in IBM Plex Mono, and what it means. */
export function FigureTile({
  label,
  hint,
  children,
  testid,
  className,
}: {
  label: string
  hint: React.ReactNode
  children: React.ReactNode
  testid?: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 bg-raised px-gutter py-4', className)}>
      <span className="font-figure text-eyebrow uppercase text-label">{label}</span>
      <span className="font-figure text-title text-ink" data-testid={testid}>
        {children}
      </span>
      <span className="text-caption font-normal text-muted">{hint}</span>
    </div>
  )
}
