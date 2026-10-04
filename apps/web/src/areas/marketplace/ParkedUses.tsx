import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { formatULXC } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { MarketError, type ParkedUse, marketApi, refusalText } from './marketApi'
import { readFailure } from './parts'

// ParkedUses.tsx — B27.19: on the operator screen, every billed marketplace use Stripe refused too often to
// keep retrying, with Stripe's reason and how many times it refused. Retry puts one back on Lens's next
// metering run; if Stripe refuses it again it parks again. The BFF reads the list on the operator read key
// and retries on the moderator key, naming the operator (apps/bff/market_parked.go).

const PARKED_KEY = ['market-parked-uses']

/** The BFF's own 501 and 502 sentences name what to fix (a key unset, wrong or revoked). */
const configSentence = (err: unknown) =>
  err instanceof MarketError && err.sentence && (err.status === 501 || err.status === 502) ? err.sentence : ''

export function ParkedUses() {
  const client = useQueryClient()
  const q = useQuery({ queryKey: PARKED_KEY, queryFn: marketApi.parkedUses })
  const [retried, setRetried] = useState<string[]>([])
  const onRetried = (id: string) => {
    setRetried((was) => [id, ...was])
    void client.invalidateQueries({ queryKey: PARKED_KEY })
  }
  const rows = q.data ?? []
  return (
    <Region index="01" label="Marketplace" heading="Parked uses" sectionClassName="pb-10 pt-4 wide:pb-12">
      <p className="max-w-2xl text-body text-muted">
        Marketplace uses Stripe refused too many times to keep trying, so they are not on their buyer’s bill. Fix
        what Stripe’s reason names, then retry: the next metering run bills the use, and if Stripe refuses it again it
        is parked again.
      </p>
      {retried.map((id) => (
        <p key={id} data-testid="parked-retried" className="mt-4 text-body text-ink">
          <span className="font-mono">{id}</span> will be tried again on the next metering run.
        </p>
      ))}
      {q.isError ? (
        <p className="mt-4 text-body text-muted">{configSentence(q.error) || readFailure(q.error, 'The parked uses')}</p>
      ) : q.isPending ? (
        <p className="mt-4 text-body text-muted">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-body text-muted">No use is parked. A use appears here when Stripe refuses to bill it too many times.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="whitespace-nowrap border-b border-rule text-left font-figure text-eyebrow uppercase text-muted">
                <th className="px-gutter py-2 font-semibold">Use</th>
                <th className="px-gutter py-2 font-semibold">Buyer</th>
                <th className="px-gutter py-2 text-right font-semibold">Price</th>
                <th className="px-gutter py-2 text-right font-semibold">Refused</th>
                <th className="px-gutter py-2 font-semibold">Stripe’s reason</th>
                <th className="px-gutter py-2 font-semibold">Parked</th>
                <th className="px-gutter py-2">
                  <span className="sr-only">Retry</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <ParkedRow key={p.id} p={p} onRetried={onRetried} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Region>
  )
}

function ParkedRow({ p, onRetried }: { p: ParkedUse; onRetried: (id: string) => void }) {
  const retry = useMutation({ mutationFn: () => marketApi.retryParkedUse(p.id), onSuccess: () => onRetried(p.id) })
  return (
    <tr data-testid="parked-use" className="border-b border-rule align-top last:border-b-0">
      <td className="px-gutter py-2">
        <div className="font-mono text-caption text-ink">{p.id}</div>
        <div className="font-mono text-caption text-faint">{p.listing_id}</div>
      </td>
      <td className="px-gutter py-2 font-mono text-caption text-muted">{p.buyer_workspace_id}</td>
      <td className="whitespace-nowrap px-gutter py-2 text-right font-figure text-body text-ink">{formatULXC(p.price_ulxc)}</td>
      <td className="whitespace-nowrap px-gutter py-2 text-right font-figure text-body text-muted">
        {p.refusals} {p.refusals === 1 ? 'time' : 'times'}
      </td>
      <td className="px-gutter py-2 text-body text-ink">{p.reason}</td>
      <td className="whitespace-nowrap px-gutter py-2 font-figure text-body text-muted">{formatWhen(p.parked_at)}</td>
      <td className="px-gutter py-2 text-right">
        <Button onClick={() => retry.mutate()} disabled={retry.isPending} aria-label={`Retry ${p.id}`}>
          {retry.isPending ? 'Retrying…' : 'Retry'}
        </Button>
        {retry.isError ? (
          <p role="alert" className="mt-1 text-caption text-muted">
            {configSentence(retry.error) || refusalText(retry.error)}
          </p>
        ) : null}
      </td>
    </tr>
  )
}
