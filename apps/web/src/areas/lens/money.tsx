import { useSyncExternalStore } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { focusRing } from '@talyvor/ui'
import { ApiError, UnreadableError, readable } from '../../lib/api'
import { formatULXC } from './agentBankApi'
import { topupApi } from './topupApi'

// B28.22 — every LXC amount on the wallet screens also reads in the person's own currency: dollars from
// Lens's peg (/api/lxc/topup-options), pounds and euros from that and the ECB's euro rates (/api/fx).
// A rate that cannot be read shows no figure for it, never a guess: no peg ⇒ LXC alone; no ECB rate ⇒
// dollars instead of pounds or euros.

export type Fiat = 'USD' | 'GBP' | 'EUR'

export const FIATS: readonly { code: Fiat; label: string }[] = [
  { code: 'USD', label: 'US dollars ($)' },
  { code: 'GBP', label: 'British pounds (£)' },
  { code: 'EUR', label: 'Euros (€)' },
]

/** The currency this browser shows amounts in. */
export const FIAT_KEY = 'talyvor.wallet.currency'

const listeners = new Set<() => void>()

function readFiat(): Fiat {
  try {
    const v = window.localStorage.getItem(FIAT_KEY)
    return v === 'GBP' || v === 'EUR' ? v : 'USD'
  } catch {
    return 'USD'
  }
}

export function setFiat(next: Fiat): void {
  try {
    window.localStorage.setItem(FIAT_KEY, next)
  } catch {
    // A refused write still changes this tab, below; the next load starts from dollars.
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useFiat(): Fiat {
  return useSyncExternalStore(subscribe, readFiat, () => 'USD' as const)
}

/** The ECB's euro reference rates, as the BFF serves them (apps/bff/fx.go). */
export interface FXRates {
  rate_date: string
  usd_per_eur: number
  gbp_per_eur: number
}

export const FX_KEY = ['fx']

export async function fetchFX(): Promise<FXRates> {
  const res = await fetch('/api/fx', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, '/api/fx')
  return readable<FXRates>('/api/fx', await res.json(), { usd_per_eur: 'number', gbp_per_eur: 'number' })
}

/** An amount of money as a person reads it: 1.25 USD → "$1.25"; a non-zero amount under a cent → "<$0.01". */
export function fiatText(amount: number, fiat: Fiat): string {
  const fmt = new Intl.NumberFormat(fiat === 'USD' ? 'en-US' : 'en-GB', {
    style: 'currency',
    currency: fiat,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const abs = Math.abs(amount)
  if (abs > 0 && abs < 0.005) return `<${fmt.format(0.01)}`
  return fmt.format(abs)
}

/**
 * µLXC → the person's currency, or null when a rate it needs is unknown. Pounds and euros fall back to
 * dollars when the ECB rates cannot be read, so the figure is always labelled by its own symbol.
 */
export function convertULXC(
  ulxc: number,
  usdPerLXC: number | undefined,
  fx: FXRates | undefined,
  fiat: Fiat,
): { amount: number; fiat: Fiat } | null {
  if (usdPerLXC === undefined || !(usdPerLXC > 0)) return null
  const usd = (ulxc / 1_000_000) * usdPerLXC
  if (fiat === 'USD' || fx === undefined) return { amount: usd, fiat: 'USD' }
  const eur = usd / fx.usd_per_eur
  return fiat === 'EUR' ? { amount: eur, fiat } : { amount: eur * fx.gbp_per_eur, fiat }
}

/**
 * B35.6 — Lens's credit peg. It is fixed, so one answer is kept for the session; a read that fails is
 * asked again with react-query's default retries and backoff, so one failed or slow read no longer
 * leaves every amount on the screen without its currency. A 401, a 403 or an unreadable answer is a
 * verdict, not a flake, and is not asked again (as the app's own default, App.tsx). Every reader of the
 * peg shares these options: the observer that starts a read decides whether it is retried.
 */
export const pegQuery = queryOptions({
  queryKey: ['topup-options'],
  queryFn: topupApi.options,
  retry: (failures, error) =>
    failures < 3 &&
    !(error instanceof UnreadableError) &&
    !(error instanceof ApiError && (error.status === 401 || error.status === 403)),
  staleTime: Infinity,
})

/** A formatter for the person's currency: µLXC → "$1.25", or null while no rate backs one. */
export function useMoney(): (ulxc: number) => string | null {
  const fiat = useFiat()
  const peg = useQuery(pegQuery)
  const fx = useQuery({ queryKey: FX_KEY, queryFn: fetchFX, retry: false, staleTime: 60 * 60_000, enabled: fiat !== 'USD' })
  return (ulxc) => {
    const v = convertULXC(ulxc, peg.data?.usd_per_lxc, fiat === 'USD' ? undefined : fx.data, fiat)
    return v === null ? null : fiatText(v.amount, v.fiat)
  }
}

/**
 * `12.5 LXC ($1.25)` — the LXC figure, its unit, and what it is in the person's currency. `sign` is
 * written before both figures; a negative amount carries its own minus into both.
 */
export function Lxc({ ulxc, sign = '' }: { ulxc: number; sign?: '' | '+' | '−' }) {
  const money = useMoney()
  const fiat = money(Math.abs(ulxc))
  const minus = ulxc < 0 ? '-' : sign
  // B29.9 — the whole amount, unit and fiat included, is on the figure face: IBM Plex Mono, tabular figures.
  return (
    <span className="whitespace-nowrap font-figure">
      <span className="font-figure">
        {sign}
        {formatULXC(ulxc).replace(/ LXC$/, '')}
      </span>{' '}
      LXC
      {fiat !== null ? (
        <>
          {' '}
          <span className="font-figure text-muted" data-testid="fiat">
            ({minus}
            {fiat})
          </span>
        </>
      ) : null}
    </span>
  )
}

/** Which currency the wallet screens show beside LXC. */
export function CurrencyPicker() {
  const fiat = useFiat()
  return (
    <label className="flex items-center gap-2 text-body text-muted">
      Show amounts in
      <select
        aria-label="Show amounts in"
        className={`h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`}
        value={fiat}
        onChange={(e) => setFiat(e.target.value as Fiat)}
      >
        {FIATS.map((f) => (
          <option key={f.code} value={f.code}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  )
}
