import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Row, focusRing, inlineLink } from '@talyvor/ui'
import { isSessionExpired } from '../../lib/productState'
import { fetchModels } from '../chat/chatApi'
import { type Listing, kindLabel, priceText } from './marketApi'

// parts.tsx — B20.3: what the marketplace's screens share.

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

export function ListingRow({ l }: { l: Listing }) {
  return (
    <Row
      label={
        <Link className={`text-ink ${inlineLink}`} to={`/marketplace/listings/${encodeURIComponent(l.id)}`}>
          {l.title}
        </Link>
      }
      hint={l.description ? `${kindLabel(l.kind)} · ${l.description}` : kindLabel(l.kind)}
    >
      <span className="text-body text-ink">
        <Price micros={l.price_per_use_ulxc} />
      </span>
    </Row>
  )
}
