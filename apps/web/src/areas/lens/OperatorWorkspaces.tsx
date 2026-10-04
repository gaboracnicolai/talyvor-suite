import { useQuery } from '@tanstack/react-query'
import { MuNumeral } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError, readable } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { ParkedUses } from '../marketplace/ParkedUses'
import { formatWhen } from './format'

// OperatorWorkspaces.tsx — B18.25: the operator screen. Every workspace on this deployment, with what it
// spent this month and in all, how many requests it made, the LENS it holds unsettled and when it last
// made a request. The BFF joins Lens's roster and B18.17's three cross-tenant reads on the operator read
// key (apps/bff/operator_workspaces.go), and only someone on OPERATOR_SUBS gets an answer.

/** One row, as GET /api/admin/workspaces answers it. */
export interface OperatorWorkspace {
  id: string
  name: string
  created_at: string | null
  current_month_usd: number
  all_time_usd: number
  requests: number
  held_ulens: number
  last_request_at: string | null
}

class OperatorError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

const PATH = '/api/admin/workspaces'

async function readWorkspaces(): Promise<OperatorWorkspace[]> {
  const res = await fetch(PATH, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new OperatorError(res.status, PATH, sentence)
  }
  return readable<{ workspaces: OperatorWorkspace[] | null }>(PATH, await res.json(), { workspaces: 'list' }).workspaces ?? []
}

function failure(err: unknown): string {
  if (isSessionExpired(err)) return 'The workspaces can’t be read until you sign in again.'
  if (err instanceof OperatorError && err.status === 403) return 'Only Talyvor’s operators can see this screen.'
  // The BFF's 501 and 502 name what to fix: the operator read key unset, or not the one Lens holds.
  if (err instanceof OperatorError && err.sentence && (err.status === 501 || err.status === 502)) return err.sentence
  return 'The workspaces could not be read just now.'
}

/** Lens's spend is dollars as a float; a fraction of a cent is still spend, so it is not shown as $0.00. */
function usdText(usd: number): string {
  if (usd > 0 && usd < 0.01) return '< $0.01'
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function OperatorWorkspaces() {
  const q = useQuery({ queryKey: ['operator-workspaces'], queryFn: readWorkspaces })
  const rows = q.data ?? []
  const month = rows.reduce((s, w) => s + w.current_month_usd, 0)
  const held = rows.reduce((s, w) => s + w.held_ulens, 0)
  return (
    <RegionScreen>
      <Region index="00" label="Operator" heading="Every workspace" sectionClassName="pb-10 pt-4 wide:pb-12">
        <p className="max-w-2xl text-body text-muted">
          What each workspace spent, the LENS it holds that has not settled yet, and when it last made a request.
          Most recently active first. Synthetic test workspaces are not listed.
        </p>
        {q.isError ? (
          <p className="mt-4 text-body text-muted">{failure(q.error)}</p>
        ) : q.isPending ? (
          <p className="mt-4 text-body text-muted">Reading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-body text-muted">There are no workspaces on this deployment yet.</p>
        ) : (
          <>
            <p data-testid="operator-totals" className="mt-4 font-figure text-body text-ink">
              {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'workspace' : 'workspaces'} ·{' '}
              {usdText(month)} spent this month · <MuNumeral micros={held} unit="lens" /> held
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="whitespace-nowrap border-b border-rule text-left font-figure text-eyebrow uppercase text-muted">
                    <th className="px-gutter py-2 font-semibold">Workspace</th>
                    <th className="px-gutter py-2 text-right font-semibold">This month</th>
                    <th className="px-gutter py-2 text-right font-semibold">All time</th>
                    <th className="px-gutter py-2 text-right font-semibold">Requests</th>
                    <th className="px-gutter py-2 text-right font-semibold">LENS held</th>
                    <th className="px-gutter py-2 font-semibold">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <WorkspaceRow key={w.id} w={w} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Region>
      {/* B27.19 — read once the operator boundary has let this screen through, so a refusal shows once. */}
      {q.isSuccess ? <ParkedUses /> : null}
    </RegionScreen>
  )
}

function WorkspaceRow({ w }: { w: OperatorWorkspace }) {
  return (
    <tr data-testid="operator-workspace" className="border-b border-rule last:border-b-0">
      <td className="px-gutter py-2">
        <div className="whitespace-nowrap text-body text-ink">{w.name || w.id}</div>
        {w.name ? <div className="font-mono text-caption text-faint">{w.id}</div> : null}
      </td>
      <td className="px-gutter py-2 text-right font-figure text-body text-ink">{usdText(w.current_month_usd)}</td>
      <td className="px-gutter py-2 text-right font-figure text-body text-muted">{usdText(w.all_time_usd)}</td>
      <td className="px-gutter py-2 text-right font-figure text-body text-muted">{w.requests.toLocaleString('en-US')}</td>
      <td className="px-gutter py-2 text-right">
        <div className="flex justify-end">
          <MuNumeral micros={w.held_ulens} unit="lens" />
        </div>
      </td>
      <td className="px-gutter py-2 font-figure text-body text-muted">{w.last_request_at ? formatWhen(w.last_request_at) : 'Never'}</td>
    </tr>
  )
}
