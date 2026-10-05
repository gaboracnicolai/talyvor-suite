import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Input, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError, readable } from '../../lib/api'
import { selectClass } from '../marketplace/parts'
import { formatWhen } from './format'

// OperatorTrail.tsx — B27.29: on the operator screen, every action an operator took in the app — who,
// what, on which target, and when — newest first, filtered, and downloadable as CSV. The BFF records each
// action in Lens's append-only trail (Lens B27.28) once Lens has done it, and reads the trail back on the
// operator read key (apps/bff/operator_audit.go).

/** One recorded action, as GET /api/admin/operator-audit answers it. */
export interface TrailEntry {
  id: number
  actor: string
  action: string
  target: string
  detail: string
  occurred_at: string
  recorded_at: string
}

export const TRAIL_KEY = ['operator-audit']

/** Every operator action the BFF records, by the name it records it under. */
const ACTIONS: Record<string, string> = {
  'marketplace.listing.approve': 'Approved a listing',
  'marketplace.listing.takedown': 'Took down a listing',
  'marketplace.parked_use.retry': 'Retried a parked use',
}

interface Filters {
  action: string
  actor: string
  target: string
  since: string
  until: string
}

const NO_FILTERS: Filters = { action: '', actor: '', target: '', since: '', until: '' }

function query(f: Filters): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v.trim()) q.set(k, v.trim())
  const s = q.toString()
  return s ? `?${s}` : ''
}

class TrailError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

async function readTrail(f: Filters): Promise<TrailEntry[]> {
  const path = '/api/admin/operator-audit' + query(f)
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new TrailError(res.status, path, sentence)
  }
  return readable<{ entries: TrailEntry[] | null }>(path, await res.json(), { entries: 'list' }).entries ?? []
}

/** The BFF's 400 (a filter Lens cannot read), 501 and 502 name what to fix. */
function failure(err: unknown): string {
  if (err instanceof TrailError && err.sentence && [400, 501, 502].includes(err.status)) return err.sentence
  return 'The operator trail could not be read just now.'
}

export function OperatorTrail() {
  const [f, setF] = useState<Filters>(NO_FILTERS)
  const set = (k: keyof Filters) => (v: string) => setF((was) => ({ ...was, [k]: v }))
  const q = useQuery({ queryKey: [...TRAIL_KEY, f], queryFn: () => readTrail(f) })
  const rows = q.data ?? []
  const filtered = Object.values(f).some((v) => v.trim() !== '')
  return (
    <Region index="02" label="Audit" heading="Operator actions" sectionClassName="pb-10 pt-4 wide:pb-12">
      <p className="max-w-2xl text-body text-muted">
        Every action an operator took here — approving or taking down a listing, retrying a parked use — with who
        took it and when, newest first. Nobody can change or delete a line. Pick an operator or a target in the
        list to see only theirs.
      </p>
      <form
        aria-label="Filter the operator trail"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => e.preventDefault()}
      >
        {/* selectClass carries its own mt-1, so this label has no gap of its own. */}
        <label className="flex flex-col">
          <span className="font-figure text-eyebrow uppercase text-muted">Action</span>
          <select className={selectClass} value={f.action} onChange={(e) => set('action')(e.target.value)}>
            <option value="">Every action</option>
            {Object.entries(ACTIONS).map(([name, label]) => (
              <option key={name} value={name}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-figure text-eyebrow uppercase text-muted">Operator</span>
          <Input value={f.actor} onChange={(e) => set('actor')(e.target.value)} placeholder="Anyone" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-figure text-eyebrow uppercase text-muted">Target</span>
          <Input value={f.target} onChange={(e) => set('target')(e.target.value)} placeholder="Anything" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-figure text-eyebrow uppercase text-muted">From</span>
          <Input type="date" className="font-figure" value={f.since} onChange={(e) => set('since')(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-figure text-eyebrow uppercase text-muted">To</span>
          <Input type="date" className="font-figure" value={f.until} onChange={(e) => set('until')(e.target.value)} />
        </label>
        {filtered ? (
          <Button type="button" onClick={() => setF(NO_FILTERS)}>
            Clear filters
          </Button>
        ) : null}
        <a className={`${inlineLink} pb-1.5 text-body`} href={'/api/admin/operator-audit/export' + query(f)} download>
          Download CSV
        </a>
      </form>
      {q.isError ? (
        <p className="mt-4 text-body text-muted">{failure(q.error)}</p>
      ) : q.isPending ? (
        <p className="mt-4 text-body text-muted">Reading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-body text-muted">
          {filtered ? 'No action matches these filters.' : 'No operator has acted yet. Each action appears here once it is done.'}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-card border border-rule bg-raised">
          <table className="w-full border-collapse">
            <thead>
              <tr className="whitespace-nowrap border-b border-rule text-left font-figure text-eyebrow uppercase text-label">
                <th className="px-gutter py-2 font-semibold">When</th>
                <th className="px-gutter py-2 font-semibold">Operator</th>
                <th className="px-gutter py-2 font-semibold">Action</th>
                <th className="px-gutter py-2 font-semibold">Target</th>
                <th className="px-gutter py-2 font-semibold">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} data-testid="operator-action" className="border-b border-rule align-top last:border-b-0">
                  <td className="whitespace-nowrap px-gutter py-2 font-figure text-body text-muted">{formatWhen(e.occurred_at)}</td>
                  <td className="px-gutter py-2">
                    <button
                      type="button"
                      className={`${inlineLink} text-left text-body`}
                      onClick={() => set('actor')(e.actor)}
                      aria-label={`Only ${e.actor}`}
                    >
                      {e.actor}
                    </button>
                  </td>
                  <td className="px-gutter py-2 text-body text-ink">{ACTIONS[e.action] ?? e.action}</td>
                  <td className="px-gutter py-2">
                    {e.target ? (
                      <button
                        type="button"
                        className={`${inlineLink} text-left font-mono text-caption`}
                        onClick={() => set('target')(e.target)}
                        aria-label={`Only ${e.target}`}
                      >
                        {e.target}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-gutter py-2 text-body text-muted">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Region>
  )
}
