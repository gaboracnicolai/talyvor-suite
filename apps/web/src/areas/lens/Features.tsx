import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Input, Switch, focusRing, inlineLink } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { ApiError, api, getJSON, getJSONArray } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'
import { StoredAnswers } from './StoredAnswers'

// Features.tsx — B8.2, rebuilt at B11.2 from docs/features-inventory.md: every capability, grouped
// by product, each saying what it does, where it works (with a link to that screen), and the
// evidence that it is working — a live figure labelled measured or estimated, or where to look.
//
// ⚠ ENUMERATED FROM LENS, NOT FROM A LIST: the Workspace record's policy fields, the guardrail
// policy, Tare's recorded savings, the distill counts, the cache's serve sources and the earnings
// ledger. A capability with no control this app can reach shows its state WITHOUT a switch — a
// toggle that changes nothing is worse than none.
//
// ⚠ NO BARE "OFF". A setting that is off says how to turn it on; a capability switched off for the
// whole deployment says so and names the operator switch (read live from the earnings reply's
// disabled_gates, never assumed). The retired prompt rewriter (compression_policy) is not shown:
// it saved nothing, altered prompts, and Tare replaces it.

type ReducerPolicy = 'disabled' | 'opt_in' | 'always'

type LoggingPolicy = 'full' | 'metadata' | 'none'
type Enforcement = 'hard_block' | 'alert' | 'off'

/** GET /api/features/budget — the workspace-wide spending limit Lens holds: none, one, or several. */
interface BudgetReading {
  budget: { period: 'monthly' | 'weekly' | 'total'; limit_usd: number; spent_usd: number; enforcement: Enforcement } | null
  several: boolean
}

const BUDGET_KEY = ['budget']

export interface FeaturesState {
  tare_policy: ReducerPolicy | null
  distill_policy: ReducerPolicy | null
  compression_policy: ReducerPolicy | null
  logging_policy: 'full' | 'metadata' | 'none' | null
  cache_poolable: boolean | null
  distill_poolable: boolean | null
  cost_optimize_routing: boolean | null
  guardrails: { injection: boolean; pii: boolean } | null
  /** B18.55 — whether this workspace shares routing patterns, and whether the deployment mines them at all. */
  pattern_mining: { opted_in: boolean; enabled: boolean } | null
}

/** GET /api/features/tare-savings — Lens's per-work-item rows, summed by the BFF. */
interface TareSavings {
  requests: number
  tokens_before: number
  tokens_after: number
  cost_saved_usd: number
}

/** GET /api/distill — the stored policy and, when this deployment can count them, conversions. */
interface DistillReading {
  converted?: number
  days?: number
}

const FEATURES_KEY = ['features']

// B17.35 — the screen opened while Lens restarts reads it again instead of showing a row with no
// switch. The e2e run of 2026-10-03 opened Features inside a redeploy: the read failed, and the BFF's
// best-effort guardrail read can come back null, so "Prompt-injection detection" read "Could not be
// read" with nothing to switch. A reply without the guardrail policy now counts as a failed read,
// and until something has been read a failed read is tried again every READ_EVERY_MS, up to
// READ_TRIES tries — about ten seconds, inside the e2e's thirty-second wait. The rows say
// "Checking…" meanwhile; the last try shows what it read.
const READ_TRIES = 6
const READ_EVERY_MS = 2_000

/** Every body this screen sends — one key each, so each write names exactly the setting it changes. */
type SettingWrite =
  | { tare_policy: ReducerPolicy }
  | { distill_policy: ReducerPolicy }
  | { cost_optimize_routing: boolean }
  | { distill_poolable: boolean }
  | { opted_in: boolean }
  | { cache_poolable: boolean }
  | { injection: boolean }
  | { pii: boolean }
  | { logging_policy: LoggingPolicy }
  | { limit_usd: number; enforcement: Enforcement }

/** What a write's reply says Lens recorded, in this screen's terms; undefined when it cannot be read. */
type Recorded = Partial<FeaturesState> | undefined

/** Writes one setting and answers Lens's reply, which states what it recorded. */
async function post(path: string, body: SettingWrite): Promise<Recorded> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json().catch(() => undefined)) as Recorded
}

/** The guardrail write answers both flags; on this screen they sit under `guardrails`. */
async function postGuardrail(body: { injection: boolean } | { pii: boolean }): Promise<Recorded> {
  const g = await post('/api/features/guardrails', body)
  return g && { guardrails: g as FeaturesState['guardrails'] }
}

const UNREAD = 'Could not be read'

function reducerState(p: ReducerPolicy | null | undefined, header?: string): string {
  if (p == null) return UNREAD
  if (p === 'always') return 'On'
  if (p === 'disabled') return 'Off — switch it on here'
  return header ? `On only for requests that send ${header}` : 'On only for requests that ask for it'
}

function switchable(v: boolean | null | undefined): string {
  return v == null ? UNREAD : v ? 'On' : 'Off — switch it on here'
}

const LOGGING: Record<LoggingPolicy, string> = {
  full: 'Full — the prompt text is kept',
  metadata: 'Cost, tokens and model only — never the prompt text',
  none: 'Nothing is kept — not even for the cache',
}

const count = (n: number) => <span className="font-figure">{n.toLocaleString('en-US')}</span>
/** Dollars to the cent, or to four places under a cent — so $0.0005 never reads as $0.00. */
const dollars = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`
const usd = (n: number) => <span className="font-figure">{dollars(n)}</span>

/**
 * Writes one setting and shows what Lens's reply says it recorded, then re-reads in the background;
 * says so when the write did not land. B17.28: under load the re-read could take past 15 s or fail,
 * and a switch that waited on it never showed the change. A write whose reply cannot be shown (the
 * spending limit, a failed write) still waits for the re-read.
 */
function useSettingWrite(alsoInvalidate?: string[]) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<unknown>(null)
  const run = async (write: () => Promise<Recorded | void>) => {
    setBusy(true)
    setFailed(null)
    let recorded: Recorded | void
    try {
      recorded = await write()
      if (recorded) qc.setQueryData<FeaturesState>(FEATURES_KEY, (s) => s && { ...s, ...recorded })
    } catch (err) {
      setFailed(err)
    }
    const reread = Promise.all([
      qc.invalidateQueries({ queryKey: FEATURES_KEY }),
      alsoInvalidate ? qc.invalidateQueries({ queryKey: alsoInvalidate }) : undefined,
    ])
    if (!recorded) await reread
    setBusy(false)
  }
  const note = busy ? (
    <span className="text-caption text-muted">Saving…</span>
  ) : failed ? (
    <span role="status" className="text-caption text-muted">
      {isSessionExpired(failed) ? 'Not saved — sign in again.' : 'Not saved. You can try again.'}
    </span>
  ) : null
  return { busy, run, note }
}

const fieldClass = `rounded-control border border-rule bg-surface text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

/** One of several values, written the way a switch is: Lens's recorded value is what shows. */
function SettingChoice<T extends string>({
  name,
  value,
  options,
  write,
}: {
  name: string
  value: T
  options: Record<T, string>
  write: (v: T) => Promise<Recorded>
}) {
  const { busy, run, note } = useSettingWrite()
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <select
        aria-label={name}
        className={`${fieldClass} h-8 w-full px-2`}
        value={value}
        disabled={busy}
        onChange={(e) => void run(() => write(e.target.value as T))}
      >
        {(Object.keys(options) as T[]).map((v) => (
          <option key={v} value={v}>
            {options[v]}
          </option>
        ))}
      </select>
      {note}
    </div>
  )
}

const PERIOD: Record<'monthly' | 'weekly' | 'total', string> = { monthly: 'a month', weekly: 'a week', total: 'in total' }

function budgetState(r: { isPending: boolean; isError: boolean; data?: BudgetReading }): string {
  if (r.isPending) return 'Checking…'
  if (r.isError || !r.data) return UNREAD
  if (r.data.several) return 'Several limits are set through Lens’s API — change them there'
  const b = r.data.budget
  if (b == null) return 'No limit — set one here'
  const limit = `${dollars(b.limit_usd)} ${PERIOD[b.period]}`
  if (b.enforcement === 'off') return `Off — the limit of ${limit} is kept but not applied`
  if (b.enforcement === 'alert') return `On — ${limit}; past it you are alerted, nothing is refused`
  return `On — ${limit}; requests past it are refused`
}

/** The workspace's spending limit: an amount to save, and a switch that applies it or not. */
function BudgetControl({ budget }: { budget: BudgetReading['budget'] }) {
  const { busy, run, note } = useSettingWrite(BUDGET_KEY)
  const [amount, setAmount] = useState(budget ? String(budget.limit_usd) : '')
  const limit = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(limit) && limit > 0
  const write = (body: { limit_usd: number; enforcement: Enforcement }) =>
    run(async () => {
      await post('/api/features/budget', body)
    })
  return (
    <div className="flex w-full flex-col items-end gap-1">
      {budget ? (
        <Switch
          checked={budget.enforcement !== 'off'}
          disabled={busy}
          onCheckedChange={(on) => void write({ limit_usd: budget.limit_usd, enforcement: on ? 'hard_block' : 'off' })}
          aria-label={`Spending limit: turn ${budget.enforcement !== 'off' ? 'off' : 'on'}`}
        />
      ) : null}
      <form
        className="flex w-full items-center justify-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) void write({ limit_usd: limit, enforcement: budget?.enforcement ?? 'hard_block' })
        }}
      >
        <Input
          aria-label={`Limit in dollars, ${PERIOD[budget?.period ?? 'monthly']}`}
          inputMode="decimal"
          className="w-20 font-figure"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button type="submit" disabled={busy || !valid}>
          {budget ? 'Save' : 'Set'}
        </Button>
      </form>
      {note}
    </div>
  )
}

/** A switch that writes one setting and shows what Lens recorded. */
function SettingSwitch({
  name,
  checked,
  write,
  alsoInvalidate,
}: {
  name: string
  checked: boolean
  write: (on: boolean) => Promise<Recorded>
  alsoInvalidate?: string[]
}) {
  const { busy, run, note } = useSettingWrite(alsoInvalidate)
  return (
    <div className="flex flex-col items-end gap-1">
      <Switch
        checked={checked}
        disabled={busy}
        onCheckedChange={(on) => void run(() => write(on))}
        aria-label={`${name}: turn ${checked ? 'off' : 'on'}`}
      />
      {note}
    </div>
  )
}

function Feature({
  name,
  does,
  where,
  evidence,
  state,
  control,
}: {
  name: string
  does: React.ReactNode
  /** Where it takes effect, in plain words, ending in a link to that screen where one exists. */
  where: React.ReactNode
  /** What shows it working: a live figure (labelled measured or estimated), or where to look. */
  evidence: React.ReactNode
  state: string
  control?: React.ReactNode
}) {
  return (
    <li className="flex items-start justify-between gap-6 border-b border-rule py-5 last:border-b-0">
      <div className="min-w-0 space-y-1">
        <h3 className="text-head text-ink">{name}</h3>
        <p className="text-body text-ink">{does}</p>
        <p className="text-body text-muted">
          <span className="text-ink">Where it works:</span> {where}
        </p>
        <p className="text-body text-muted" data-testid={`evidence-${name}`}>
          <span className="text-ink">See it working:</span> {evidence}
        </p>
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

/** B10.5 — a model a provider lists that Lens cannot price yet (Lens GET /v1/catalog/discovered). */
interface WaitingModel {
  provider: string
  id: string
  first_seen_at: string
}

function WaitingModels({ read }: { read: { isPending: boolean; isError: boolean; data?: WaitingModel[] } }) {
  if (read.isPending) return <>Reading…</>
  if (read.isError || read.data === undefined) return <>Could not be read just now.</>
  const models = read.data
  const count = models.length.toLocaleString('en-US')
  if (models.length === 0)
    return (
      <>
        No model is waiting for a price: everything the providers list is priced, in <To to="/chat">the chat’s model picker</To>.
      </>
    )
  return (
    <>
      {models.length === 1 ? <>One model is</> : <>{count} models are</>} waiting for a price — not offered, and never
      charged at zero, until one is confirmed.{' '}
      <details className="mt-1">
        <summary className="cursor-pointer text-ink">Show {models.length === 1 ? <>it</> : <>all {count}</>}</summary>
        <ul className="mt-1 max-h-60 overflow-y-auto font-figure text-caption" data-testid="models-waiting">
          {models.map((m) => (
            <li key={`${m.provider}/${m.id}`}>
              {m.provider} · {m.id} · first seen {m.first_seen_at.slice(0, 10)}
            </li>
          ))}
        </ul>
      </details>
    </>
  )
}

function To({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link className={`text-ink ${inlineLink}`} to={to}>
      {children}
    </Link>
  )
}

export function Features() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: FEATURES_KEY,
    queryFn: async () => {
      const st = await getJSON<FeaturesState>('/api/features')
      const tried = qc.getQueryState(FEATURES_KEY)?.fetchFailureCount ?? 0
      if (st.guardrails == null && tried < READ_TRIES - 1) throw new ApiError(502, '/api/features')
      return st
    },
    // Once read, a failed re-read keeps what Lens last reported (B17.28) after the app's one retry.
    retry: (failures, err) =>
      !(err instanceof ApiError && (err.status === 401 || err.status === 403)) &&
      failures < (qc.getQueryData(FEATURES_KEY) === undefined ? READ_TRIES - 1 : 1),
    retryDelay: READ_EVERY_MS,
  })
  const tare = useQuery({
    queryKey: ['tare-savings'],
    queryFn: () =>
      getJSON<TareSavings>('/api/features/tare-savings', {
        requests: 'number',
        tokens_before: 'number',
        tokens_after: 'number',
        cost_saved_usd: 'number',
      }),
  })
  const distill = useQuery({ queryKey: ['distill'], queryFn: () => getJSON<DistillReading>('/api/distill') })
  const usage = useQuery({ queryKey: ['usage', 30], queryFn: () => api.usage(30) })
  const earnings = useQuery({ queryKey: ['earnings'], queryFn: api.earnings })
  const waiting = useQuery({ queryKey: ['models-waiting'], queryFn: () => getJSONArray<WaitingModel>('/api/models/waiting') })
  const budget = useQuery({
    queryKey: BUDGET_KEY,
    queryFn: () => getJSON<BudgetReading>('/api/features/budget', { several: 'boolean' }),
  })
  const f = q.data

  // While loading, or when the workspace could not be read, every state says so rather than
  // defaulting to Off — "we could not read it" and "it is off" are different facts. Once read, a
  // failed re-read keeps the switches on what Lens last reported (B17.28) and says so.
  const stateOf = (s: string) => (q.isPending ? 'Checking…' : s)
  const readable = f !== undefined

  // A figure is shown only from a successful read; a failed read says so, never a zero.
  const reading = (r: { isPending: boolean; isError: boolean }, ok: () => React.ReactNode) =>
    r.isPending ? 'Reading…' : r.isError ? 'Could not be read just now.' : ok()

  /** A deployment-wide switch Lens reports as off, by its variable name — or null when it is on or unread. */
  const gateOff = (name: string) => (earnings.data?.disabled_gates ?? []).includes(name)
  const pooled = usage.data?.cache.by_source?.cache_hit_pooled ?? 0
  const royaltiesULENS = (earnings.data?.by_type ?? [])
    .filter((l) => l.type === 'pool_royalty' && l.class !== 'revoked')
    .reduce((sum, l) => sum + l.amount_ulens, 0)

  return (
    <RegionScreen>
      <Region index="01" label="What Talyvor can do" heading="Every capability, where it works, and how to see it">
        <p className="text-body text-muted">
          Each row says what a capability does, where it takes effect, and what shows it is working for
          this workspace. A switch takes effect on the next request; where there is none, the row says
          how the setting is changed. Figures are marked measured or estimated.
        </p>
        {q.isError ? (
          <p role="status" className="mt-4 text-body text-ink">
            {isSessionExpired(q.error)
              ? 'This workspace’s settings can’t be read until you sign in again.'
              : f === undefined
                ? 'Couldn’t load this workspace’s settings, so no state below is shown.'
                : 'Couldn’t re-read this workspace’s settings just now; each row shows what Lens last reported.'}
          </p>
        ) : null}
      </Region>

      <Region index="02" label="Lens gateway">
        <ul>
          <Feature
            name="Tare"
            does="Shrinks the newest message before it is sent: JSON tool output keeps one row per shape, Go and TypeScript code keep their signatures and types but drop function bodies. Anything it cannot shrink safely is sent unchanged, and earlier messages are never touched, so the provider’s prompt cache still hits."
            where={
              <>
                Requests through the gateway with an API key, streamed or not — large tool output and code.
                A short typed question has nothing to reduce. <To to="/setup">Set up a tool</To> ·{' '}
                <To to="/features/try/tare">Try it on your own content</To>
              </>
            }
            evidence={reading(tare, () =>
              tare.data!.requests > 0 ? (
                <>
                  {count(tare.data!.requests)} requests reduced from {count(tare.data!.tokens_before)} to{' '}
                  {count(tare.data!.tokens_after)} tokens, about {usd(tare.data!.cost_saved_usd)} saved — estimated,
                  from Lens&rsquo;s token estimates at each model&rsquo;s input rate.
                </>
              ) : (
                'No request has been reduced yet (measured).'
              ),
            )}
            state={stateOf(reducerState(f?.tare_policy, 'X-Talyvor-Tare: true'))}
            control={
              readable && f?.tare_policy != null ? (
                <SettingSwitch
                  name="Tare"
                  checked={f.tare_policy === 'always'}
                  write={(on) => post('/api/features/tare', { tare_policy: on ? 'always' : 'disabled' })}
                  alsoInvalidate={['tare-savings']}
                />
              ) : undefined
            }
          />
          <Feature
            name="Document conversion"
            does="Converts an attached PDF, Word, Excel, CSV, HTML, JSON, XML or text file to plain text before the model reads it, so you are charged for the words rather than the file."
            where={
              <>
                Documents attached to a chat question or to an API request. <To to="/chat">Attach one in Chat</To> ·{' '}
                <To to="/features/try/conversion">Try it on a document</To>
              </>
            }
            evidence={reading(distill, () =>
              distill.data!.converted !== undefined && distill.data!.days !== undefined ? (
                <>
                  {count(distill.data!.converted)} documents converted in the last {count(distill.data!.days)} days
                  (measured). Each question in Chat says whether its document was converted.
                </>
              ) : (
                'This deployment does not count conversions; each question in Chat says whether its document was converted.'
              ),
            )}
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
            name="Answer cache"
            does="An identical question, or a nearly identical one, is answered from this workspace’s earlier answer instead of calling the model again — instantly, and without paying for the model twice."
            where="Every chat request in this workspace, unless request logging is set to none."
            evidence={reading(usage, () => (
              <>
                {count(usage.data!.cache.cache_hits)} of {count(usage.data!.cache.total_requests)} requests in the last{' '}
                {count(usage.data!.period_days)} days were answered from cache (measured).{' '}
                <To to="/spend">Spend &amp; routing</To>
              </>
            ))}
            state={stateOf(
              f?.logging_policy === 'none'
                ? 'Paused — request logging is none, so nothing is kept to answer from'
                : 'On',
            )}
          />
          <Feature
            name="Cost-optimised routing"
            does="Lets Lens answer a request that names a model with a cheaper model of the same quality. When off, a named model is always used exactly as named. Requests for the model “auto” are routed either way."
            where="API requests that name a model."
            evidence={
              <>
                The model that actually answered is on every row of <To to="/spend">Spend &amp; routing</To>.
              </>
            }
            state={stateOf(switchable(f?.cost_optimize_routing))}
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
            name="Prompt-injection detection"
            does="Checks each prompt for an attempt to override the model’s instructions, before the model is called."
            where="Every request, before the cache and before the model."
            evidence="A blocked request is refused with the reason; the app has no counter of blocks yet."
            state={stateOf(switchable(f?.guardrails?.injection))}
            control={
              readable && f?.guardrails != null ? (
                <SettingSwitch
                  name="Prompt-injection detection"
                  checked={f.guardrails.injection}
                  write={(on) => postGuardrail({ injection: on })}
                />
              ) : undefined
            }
          />
          <Feature
            name="Personal-data detection"
            does="Finds personal data in a prompt, keeps it out of the cache and out of stored records."
            where="Every request, before the cache and before the model."
            evidence="A request with personal data is never served from or saved to the cache; the app has no counter yet."
            state={stateOf(switchable(f?.guardrails?.pii))}
            control={
              readable && f?.guardrails != null ? (
                <SettingSwitch
                  name="Personal-data detection"
                  checked={f.guardrails.pii}
                  write={(on) => postGuardrail({ pii: on })}
                />
              ) : undefined
            }
          />
          <Feature
            name="Request logging"
            does="How much Lens keeps about each request. Set to none, nothing of a request is kept — not the prompt, not the answer, and not a cached copy — so this workspace’s repeats go to the model again. Security checks run whatever this is set to."
            where="Every request."
            evidence={
              <>
                What is kept is what <To to="/spend">Spend &amp; routing</To> and the <To to="/ledger">Ledger</To> can show.
              </>
            }
            state={stateOf(f?.logging_policy == null ? UNREAD : LOGGING[f.logging_policy])}
            control={
              readable && f?.logging_policy != null ? (
                <SettingChoice
                  name="Request logging"
                  value={f.logging_policy}
                  options={{ full: 'Full', metadata: 'Cost and tokens only', none: 'Nothing' }}
                  write={(v) => post('/api/features/logging', { logging_policy: v })}
                />
              ) : undefined
            }
          />
          <Feature
            name="Spending limit"
            does="A limit on what this workspace’s requests may cost. While it is on, a request that would take the spend past it is refused."
            where="Every request through the gateway and the chat."
            evidence={reading(budget, () =>
              budget.data?.budget ? (
                <>
                  {usd(budget.data.budget.spent_usd)} spent of {usd(budget.data.budget.limit_usd)} {PERIOD[budget.data.budget.period]}{' '}
                  (measured by Lens).
                </>
              ) : (
                'Once a limit is set, what has been spent against it shows here.'
              ),
            )}
            state={budgetState(budget)}
            control={
              budget.isSuccess && !budget.data.several ? (
                <BudgetControl key={JSON.stringify(budget.data.budget)} budget={budget.data.budget} />
              ) : undefined
            }
          />
          <Feature
            name="Attribution"
            does="A request can say which feature, issue, branch or pull request it was for, and its cost is recorded against that work."
            where="Requests that carry X-Talyvor-Feature, X-Talyvor-Issue or the git headers. Always on."
            evidence={
              <>
                Spend by feature is on <To to="/spend">Spend &amp; routing</To>; branch and pull-request views have no screen yet.
              </>
            }
            state="On"
          />
          <Feature
            name="Budgets"
            does="Spending limits for the workspace, a team or a sprint. A request that would go past one is refused rather than charged."
            where="Every request, checked before it is served."
            evidence="Budgets are set through Lens’s API; this app has no budget screen yet."
            state="Set through Lens’s API"
          />
        </ul>
      </Region>

      <Region index="03" label="Chat">
        <ul>
          <Feature
            name="Chat"
            does="Ask any model this deployment serves, with each answer’s price and model under it, conversations kept in this browser, and documents converted before the model reads them."
            where={<To to="/chat">Chat</To>}
            evidence={
              <>
                Every answer ends with its price and model. <To to="/chat/help">How to use Talyvor Chat</To>
              </>
            }
            // ⚠ NOT "On": whether Lens will mint the chat's session credential is a deployment switch
            // this app cannot read (LENS_SESSION_KEYS_ENABLED); a refused send says so in the chat.
            state="In the app; answering needs Lens’s chat credential switched on"
          />
          <Feature
            name="New models"
            does="Every hour Lens asks each provider for its model list. A model a provider adds waits here until its price is confirmed from the provider’s own pricing page, then appears in the chat’s model picker; a model the provider stops listing leaves the picker."
            where={<To to="/chat">Chat’s model picker</To>}
            evidence={<WaitingModels read={waiting} />}
            state="On"
          />
        </ul>
      </Region>

      <Region index="04" label="Track">
        <ul>
          <Feature
            name="Issues, cycles and projects"
            does="Plan work as issues, group them into cycles and projects, and export what a view shows."
            where={
              <>
                <To to="/track">Issues</To>, <To to="/track/cycles">Cycles</To> and <To to="/track/projects">Projects</To>
              </>
            }
            evidence="The lists themselves."
            state="On"
          />
          <Feature
            name="AI on an issue"
            does="Summarises an issue, finds likely duplicates, and suggests its priority and labels."
            where={
              <>
                An issue&rsquo;s own page, from <To to="/track">Issues</To>.
              </>
            }
            evidence="The summary, duplicates and suggestion appear on the issue when asked for."
            state="On"
          />
        </ul>
      </Region>

      <Region index="05" label="Docs">
        <ul>
          <Feature
            name="Pages and AI writing"
            does="Write pages in an editor; write, shorten, lengthen, fix, summarise or translate with AI; ask questions answered from your pages."
            where={
              <>
                <To to="/docs">Docs</To> — any page&rsquo;s editor, and Ask AI.
              </>
            }
            evidence="Each page’s toolbar shows what AI on that page has cost (measured)."
            state="On"
          />
        </ul>
      </Region>

      <Region index="06" label="Code">
        <ul>
          <Feature
            name="Talyvor Code"
            does="AI in your editor and terminal — completions, chat, tests, reviews, agent tasks — with every call’s cost recorded against the issue you are working on."
            where={
              <>
                Your editor or terminal, through a key from <To to="/setup">Setup</To>.
              </>
            }
            evidence={
              <>
                Its requests appear on <To to="/spend">Spend &amp; routing</To> like any other tool&rsquo;s.
              </>
            }
            state="CLI available; the VS Code extension is not on the Marketplace yet"
          />
        </ul>
      </Region>

      <Region index="07" label="Billing and economy">
        <ul>
          <Feature
            name="Answer sharing"
            does="An answer this workspace paid for can be served to another company that asks the same question, and this workspace can be served from theirs. The content of a shared answer leaves the workspace."
            where={
              <>
                Questions that miss this workspace&rsquo;s own cache. The choice is made in <To to="/settings">Settings</To>.
              </>
            }
            evidence={
              gateOff('LENS_CACHE_POOLABLE_ENABLED')
                ? 'Switched off for the whole deployment by its operator (LENS_CACHE_POOLABLE_ENABLED); nothing is shared until it is on.'
                : reading(usage, () =>
                    reading(earnings, () => (
                      <>
                        {count(pooled)} answers served from the shared pool in the last {count(usage.data!.period_days)}{' '}
                        days, and <span className="font-figure">{(royaltiesULENS / 1_000_000).toLocaleString('en-US')}</span>{' '}
                        LENS earned from answers others reused (measured). <To to="/earnings">Earnings</To>
                      </>
                    )),
                  )
            }
            state={stateOf(
              f?.cache_poolable == null
                ? UNREAD
                : !f.cache_poolable
                  ? 'Off — no new answer of yours is shared. Answers shared before stay available, and keep earning, until you delete them below. Switch it on here'
                  : // B15.7 — Lens shares nothing from a workspace whose prompts are not checked for
                    // personal data, whatever this consent says. Unread guardrails keep today's reading.
                    f.guardrails?.pii === false
                    ? 'Paused — personal-data detection is off, so no new answer of yours is shared. Turn it back on (Lens’s guardrail settings) and sharing resumes with your next answer'
                    : 'On — your answers earn when someone else is served one',
            )}
            control={
              readable && f?.cache_poolable != null ? (
                // B13.3 — the same write as the signup consent and Settings (POST /api/pooling); the
                // session's cached choice is re-read too, so Plans' earnings card follows it.
                <SettingSwitch
                  name="Answer sharing"
                  checked={f.cache_poolable}
                  write={(on) => post('/api/pooling', { cache_poolable: on })}
                  alsoInvalidate={['auth-me']}
                />
              ) : (
                <Link className={`text-caption text-ink ${inlineLink}`} to="/settings">
                  Change in Settings
                </Link>
              )
            }
          />
          <Feature
            name="Shared document conversions"
            does="Lets a conversion this workspace produced be reused for another company’s identical document. A separate consent from answer sharing, because a conversion is derived from your document."
            where="Documents converted for this workspace, reused only for a byte-identical document."
            evidence={
              gateOff('LENS_DISTILL_POOLABLE_ENABLED')
                ? 'Switched off for the whole deployment by its operator (LENS_DISTILL_POOLABLE_ENABLED); nothing is shared until it is on.'
                : earnings.isSuccess
                  ? 'On for the deployment (measured). Reuses of your conversions are recorded by Lens but not yet shown to a workspace.'
                  : 'Whether the deployment allows it could not be read just now.'
            }
            state={stateOf(switchable(f?.distill_poolable))}
            control={
              readable && f?.distill_poolable != null && !gateOff('LENS_DISTILL_POOLABLE_ENABLED') ? (
                <SettingSwitch
                  name="Shared document conversions"
                  checked={f.distill_poolable}
                  write={(on) => post('/api/features/distill-poolable', { distill_poolable: on })}
                />
              ) : undefined
            }
          />
          <Feature
            name="Routing pattern sharing"
            does="Shares the shape of this workspace’s requests — which kind of feature, model and provider, token and latency ranges, quality and cache hit rate — so rare patterns earn LENS. Never a prompt or an answer."
            where="Requests routed through Lens after it is switched on. Switching it off stops new patterns being shared; ones already shared stay in the pool."
            evidence={
              f?.pattern_mining == null
                ? 'Whether the deployment mines patterns could not be read just now.'
                : f.pattern_mining.enabled
                  ? 'On for the deployment (measured). Lens records each pattern this workspace shares.'
                  : 'Switched off for the whole deployment by its operator (LENS_PATTERN_MINING_ENABLED); nothing is shared until it is on.'
            }
            state={stateOf(
              f?.pattern_mining == null
                ? UNREAD
                : !f.pattern_mining.enabled
                  ? f.pattern_mining.opted_in
                    ? 'Opted in, but pattern mining is off for this deployment, so nothing is shared'
                    : 'Off for this deployment — its operator has not switched pattern mining on'
                  : f.pattern_mining.opted_in
                    ? 'On — the shape of your requests is shared and earns LENS'
                    : 'Off — switch it on here',
            )}
            control={
              readable && f?.pattern_mining?.enabled ? (
                <SettingSwitch
                  name="Routing pattern sharing"
                  checked={f.pattern_mining.opted_in}
                  write={async (on) => {
                    const p = await post('/api/features/pattern-mining', { opted_in: on })
                    return p && { pattern_mining: p as FeaturesState['pattern_mining'] }
                  }}
                />
              ) : undefined
            }
          />
          <Feature
            name="Credits and top-up"
            does="Prepaid credit (LXC) pays for every request; top up any amount by card."
            where={<To to="/billing">Plan &amp; top up</To>}
            evidence={
              <>
                Every charge and credit is a row on the <To to="/ledger">Ledger</To>.
              </>
            }
            state="On"
          />
        </ul>
      </Region>

      <StoredAnswers />
    </RegionScreen>
  )
}
