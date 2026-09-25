import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Switch } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError, getJSON } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'

// Features.tsx — B8.2: every capability Talyvor has, what it does, what it costs or saves, whether
// it is on, and a switch where one does something.
//
// ⚠ ENUMERATED FROM LENS, NOT FROM A LIST: the Workspace record's policy fields (tare, distill,
// compression, logging, cache_poolable, distill_poolable, cost_optimize_routing), the guardrail
// policy, budgets, attribution headers and the ledger. A capability with no control this app can
// reach shows its state WITHOUT a switch — a toggle that changes nothing is worse than none.

type ReducerPolicy = 'disabled' | 'opt_in' | 'always'

export interface FeaturesState {
  tare_policy: ReducerPolicy | null
  distill_policy: ReducerPolicy | null
  compression_policy: ReducerPolicy | null
  logging_policy: 'full' | 'metadata' | 'none' | null
  cache_poolable: boolean | null
  distill_poolable: boolean | null
  cost_optimize_routing: boolean | null
  guardrails: { injection: boolean; pii: boolean } | null
}

const FEATURES_KEY = ['features']

/** Every body this screen sends — one key each, so each write names exactly the setting it changes. */
type SettingWrite =
  | { tare_policy: ReducerPolicy }
  | { distill_policy: ReducerPolicy }
  | { cost_optimize_routing: boolean }

async function post(path: string, body: SettingWrite): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, path)
}

const UNREAD = 'Could not be read'

function onOff(v: boolean | null | undefined): string {
  return v == null ? UNREAD : v ? 'On' : 'Off'
}

function reducerState(p: ReducerPolicy | null | undefined, header?: string): string {
  if (p == null) return UNREAD
  if (p === 'always') return 'On'
  if (p === 'disabled') return 'Off'
  return header ? `On only for requests that send ${header}` : 'On only for requests that ask for it'
}

const LOGGING: Record<'full' | 'metadata' | 'none', string> = {
  full: 'Full — the prompt text is kept',
  metadata: 'Cost, tokens and model only — never the prompt text',
  none: 'Nothing is recorded',
}

/** A switch that writes one setting and then re-reads what Lens recorded. */
function SettingSwitch({
  name,
  checked,
  write,
  alsoInvalidate,
}: {
  name: string
  checked: boolean
  write: (on: boolean) => Promise<void>
  alsoInvalidate?: string[]
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<unknown>(null)
  const flip = async (on: boolean) => {
    setBusy(true)
    setFailed(null)
    try {
      await write(on)
    } catch (err) {
      setFailed(err)
    } finally {
      await qc.invalidateQueries({ queryKey: FEATURES_KEY })
      if (alsoInvalidate) await qc.invalidateQueries({ queryKey: alsoInvalidate })
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={checked}
        disabled={busy}
        onCheckedChange={(on) => void flip(on)}
        aria-label={`${name}: turn ${checked ? 'off' : 'on'}`}
      />
      {busy ? <span className="text-caption text-muted">Saving…</span> : null}
      {failed ? (
        <span role="status" className="text-caption text-muted">
          {isSessionExpired(failed) ? 'Not saved — sign in again.' : 'Not saved. You can try again.'}
        </span>
      ) : null}
    </div>
  )
}

function Feature({
  name,
  does,
  money,
  state,
  control,
}: {
  name: string
  does: React.ReactNode
  money: React.ReactNode
  state: string
  control?: React.ReactNode
}) {
  return (
    <li className="flex items-start justify-between gap-6 border-b border-rule py-5 last:border-b-0">
      <div className="min-w-0">
        <h3 className="text-head text-ink">{name}</h3>
        <p className="mt-1 text-body text-ink">{does}</p>
        <p className="mt-1 text-body text-muted">{money}</p>
      </div>
      <div className="flex w-44 shrink-0 flex-col items-end gap-2 text-right">
        <span className="text-caption text-muted" data-testid={`state-${name}`}>
          {state}
        </span>
        {control}
      </div>
    </li>
  )
}

export function Features() {
  const q = useQuery({ queryKey: FEATURES_KEY, queryFn: () => getJSON<FeaturesState>('/api/features') })
  const f = q.data

  // While loading, or when the workspace could not be read, every state says so rather than
  // defaulting to Off — "we could not read it" and "it is off" are different facts.
  const stateOf = (s: string) => (q.isPending ? 'Checking…' : s)
  const readable = q.isSuccess

  return (
    <RegionScreen>
      <Region index="01" label="What Talyvor can do" heading="Every capability, and whether it is on">
        <p className="text-body text-muted">
          Each row says what a capability does, what it costs or saves, and whether it is on for this
          workspace. A switch takes effect on the next request. Where there is no switch, the setting
          cannot be changed from this app yet.
        </p>
        {q.isError ? (
          <p role="status" className="mt-4 text-body text-ink">
            {isSessionExpired(q.error)
              ? 'This workspace’s settings can’t be read until you sign in again.'
              : 'Couldn’t load this workspace’s settings, so no state below is shown.'}
          </p>
        ) : null}
      </Region>

      <Region index="02" label="Saving on each request">
        <ul>
          <Feature
            name="Tare"
            does="Shrinks the newest message before it is sent: JSON tool output with repeated rows keeps one row per shape (errors, outliers, first and last are kept), and Go or TypeScript code keeps its imports, signatures and types but drops function bodies. Lossless only — anything it cannot shrink safely is sent unchanged, and earlier messages are never touched, so the provider’s prompt cache still hits."
            money="No charge. You pay for the smaller request."
            state={stateOf(reducerState(f?.tare_policy, 'X-Talyvor-Tare: true'))}
            control={
              readable && f?.tare_policy != null ? (
                <SettingSwitch
                  name="Tare"
                  checked={f.tare_policy === 'always'}
                  write={(on) => post('/api/features/tare', { tare_policy: on ? 'always' : 'disabled' })}
                />
              ) : undefined
            }
          />
          <Feature
            name="Document conversion"
            does="Converts an attached PDF, spreadsheet or slide deck to Markdown before the model reads it."
            money="No charge, and it lowers what you pay: the converted text is smaller than the file. A scanned document with no text is read by a vision model instead, which costs tokens."
            state={stateOf(reducerState(f?.distill_policy))}
            control={
              readable && f?.distill_policy != null ? (
                <SettingSwitch
                  name="Document conversion"
                  checked={f.distill_policy === 'always'}
                  write={(on) => post('/api/distill', { distill_policy: on ? 'always' : 'disabled' })}
                  alsoInvalidate={['distill']}
                />
              ) : undefined
            }
          />
          <Feature
            name="Cost-optimised routing"
            does="Lets Lens answer a request that names a model with a cheaper model of the same quality. When off, a named model is always used exactly as named. Requests for the model “auto” are routed either way."
            money="No charge. It can lower what a request costs."
            state={stateOf(onOff(f?.cost_optimize_routing))}
            control={
              readable && f?.cost_optimize_routing != null ? (
                <SettingSwitch
                  name="Cost-optimised routing"
                  checked={f.cost_optimize_routing}
                  write={(on) => post('/api/features/cost-optimize-routing', { cost_optimize_routing: on })}
                />
              ) : undefined
            }
          />
          <Feature
            name="Prompt rewriter"
            does="Rewrites the prompt itself to be shorter before it is sent."
            money={
              <>
                Off unless a workspace turns it on: over <span className="font-figure">308</span> test
                prompts it saved <span className="font-figure">0%</span>, and it changed the indentation
                of unfenced code in <span className="font-figure">8</span> of{' '}
                <span className="font-figure">8</span> agent prompts.
              </>
            }
            state={stateOf(reducerState(f?.compression_policy))}
          />
        </ul>
      </Region>

      <Region index="03" label="Sharing across companies">
        <ul>
          <Feature
            name="Answer sharing"
            does="An answer this workspace paid for can be served to another company that asks the same question, and this workspace can be served from theirs. The content of a shared answer leaves the workspace."
            money="This workspace earns LENS when another company reuses its answer; a reused answer is served instantly."
            state={stateOf(onOff(f?.cache_poolable))}
            control={
              <Link className="text-caption text-ink underline underline-offset-2" to="/settings">
                Change in Settings
              </Link>
            }
          />
          <Feature
            name="Shared document conversions"
            does="Lets a conversion this workspace produced be reused for another company’s identical document. A separate consent from answer sharing, because a conversion is derived from your document."
            money="No charge to this workspace."
            state={stateOf(onOff(f?.distill_poolable))}
          />
        </ul>
      </Region>

      <Region index="04" label="Safety and records">
        <ul>
          <Feature
            name="Prompt-injection detection"
            does="Checks each prompt for an attempt to override the model’s instructions, before the model is called."
            money="No charge — it runs inside Lens and calls no model."
            state={stateOf(f?.guardrails == null ? UNREAD : onOff(f.guardrails.injection))}
          />
          <Feature
            name="Personal-data detection"
            does="Finds personal data in a prompt and redacts or blocks it before the model sees it."
            money="No charge — it runs inside Lens and calls no model."
            state={stateOf(f?.guardrails == null ? UNREAD : onOff(f.guardrails.pii))}
          />
          <Feature
            name="Request logging"
            does="How much Lens keeps about each request. Security checks run whatever this is set to."
            money="No charge."
            state={stateOf(f?.logging_policy == null ? UNREAD : LOGGING[f.logging_policy])}
          />
          <Feature
            name="Budgets"
            does="Spending limits for the workspace, a team or a sprint, and for an agent’s own sub-budget. A request that would go past one is refused rather than charged."
            money="No charge. It caps what you can be charged."
            state="Set in Lens — not shown here yet"
          />
          <Feature
            name="Attribution"
            does="A request can say which issue it was for (X-Talyvor-Issue) and which branch or pull request it came from, and its cost is recorded against that work."
            money="No charge."
            state="Always on — applies whenever a request carries it"
          />
          <Feature
            name="Audit trail"
            does="Every charge, credit and earning is a row on the ledger, and every row can be read."
            money="No charge."
            state="Always on"
            control={
              <Link className="text-caption text-ink underline underline-offset-2" to="/ledger">
                Open the ledger
              </Link>
            }
          />
        </ul>
      </Region>
    </RegionScreen>
  )
}
