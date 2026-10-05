import { useQuery } from '@tanstack/react-query'
import { Button, Input, Row, focusRing } from '@talyvor/ui'
import { fetchModels, pickerCatalog } from '../chat/chatApi'
import type { AgentRules } from './agentBankApi'
import { Lxc } from './money'

// B28.22 — an agent's rules are chosen, not typed: a model or provider name with a typo was saved as
// written and Lens then refused every request the agent made. The choices are the deployment's own
// catalog (/api/models), the browser's time zones and a clock. A name the rules already hold that the
// catalog does not list is kept, so saving the other rules never drops it.

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

export const MODELS_KEY = ['chat-models']

interface Option {
  value: string
  label: string
}

/** The models and providers the deployment prices, grouped by provider, from the same read Chat uses. */
export function useRuleChoices() {
  const catalog = useQuery({ queryKey: MODELS_KEY, queryFn: fetchModels, retry: false })
  const groups = pickerCatalog(catalog.data ?? []).groups
  return {
    failed: catalog.isError,
    models: groups.map((g) => ({ label: g.label, options: g.models.map((m) => ({ value: m.id, label: m.display_name })) })),
    providers: groups.map((g) => ({ value: g.provider, label: g.label })),
  }
}

/** Chosen values as removable buttons, and a select that adds one more. None chosen means any. */
export function ChoicePicker({
  label,
  agentName,
  chosen,
  onChange,
  groups,
  anyText,
  hint,
}: {
  label: string
  agentName: string
  chosen: string[]
  onChange: (next: string[]) => void
  groups: { label: string; options: Option[] }[]
  anyText: string
  hint?: string
}) {
  const all = groups.flatMap((g) => g.options)
  const name = (v: string) => all.find((o) => o.value === v)?.label ?? v
  return (
    <Row label={label} hint={hint ?? (chosen.length > 0 ? `Only these — Lens refuses any other` : anyText)}>
      <div className="flex max-w-md flex-wrap items-center justify-end gap-2">
        {chosen.map((v) => (
          <Button key={v} type="button" aria-label={`Remove ${name(v)} from ${label.toLowerCase()} for ${agentName}`} onClick={() => onChange(chosen.filter((x) => x !== v))}>
            {name(v)} ×
          </Button>
        ))}
        <select
          aria-label={`${label} for ${agentName}`}
          className={`${selectClass} w-48`}
          value=""
          onChange={(e) => {
            if (e.target.value && !chosen.includes(e.target.value)) onChange([...chosen, e.target.value])
          }}
        >
          <option value="">{chosen.length > 0 ? 'Add another…' : anyText}</option>
          {groups
            .filter((g) => g.options.length > 0)
            .map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value} disabled={chosen.includes(o.value)}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </div>
    </Row>
  )
}

/**
 * B28.25 — the name a per-model daily cap knows a model by, as Lens reads it back (economy.modelCapKey):
 * lower-case, without a dated snapshot's or a -latest alias's suffix.
 */
export const modelCapKey = (model: string) =>
  model.trim().toLowerCase().replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, '')

/** A catalog model's display name for a model the rules name, by its id or by its cap key. */
function modelLabel(groups: { options: Option[] }[], id: string): string {
  const all = groups.flatMap((g) => g.options)
  return (all.find((o) => o.value === id) ?? all.find((o) => modelCapKey(o.value) === modelCapKey(id)))?.label ?? id
}

/**
 * B28.25 — a daily cap per model: each capped model is a row with its amount, and a select adds one more.
 * Lens refuses a request to a capped model once the day's spend on it would pass the cap; other models
 * are held only by the agent's other limits.
 */
export function ModelLimitsPicker({
  agentName,
  limits,
  onChange,
  groups,
}: {
  agentName: string
  limits: [string, string][]
  onChange: (next: [string, string][]) => void
  groups: { label: string; options: Option[] }[]
}) {
  const capped = (v: string) => limits.some(([m]) => modelCapKey(m) === modelCapKey(v))
  return (
    <>
      <Row
        label="Daily limit per model"
        hint={limits.length > 0 ? 'Lens refuses a request to a model once its day’s spend would pass its cap' : 'No model has its own cap'}
      >
        <select
          aria-label={`Cap a model a day for ${agentName}`}
          className={`${selectClass} w-48`}
          value=""
          onChange={(e) => {
            if (e.target.value && !capped(e.target.value)) onChange([...limits, [e.target.value, '']])
          }}
        >
          <option value="">{limits.length > 0 ? 'Cap another model…' : 'Cap a model…'}</option>
          {groups
            .filter((g) => g.options.length > 0)
            .map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value} disabled={capped(o.value)}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </Row>
      {limits.map(([model, text]) => {
        const name = modelLabel(groups, model)
        return (
          <Row key={model} label={name} hint="LXC a day; empty for no cap" className="pl-8">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Daily limit on ${name} for ${agentName}, in LXC`}
                inputMode="decimal"
                placeholder="No limit"
                className="w-28 font-figure"
                value={text}
                onChange={(e) => onChange(limits.map(([m, t]) => (m === model ? [m, e.target.value] : [m, t])))}
              />
              <Button type="button" aria-label={`Remove the daily limit on ${name} for ${agentName}`} onClick={() => onChange(limits.filter(([m]) => m !== model))}>
                ×
              </Button>
            </div>
          </Row>
        )
      })}
    </>
  )
}

/** Every IANA time zone the browser knows, UTC first, plus the one already saved if it is not among them. */
function timeZones(current: string): string[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const list = ['UTC', ...known.filter((z) => z !== 'UTC')]
  return current && !list.includes(current) ? [current, ...list] : list
}

export function TimeZonePicker({ agentName, value, onChange }: { agentName: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label="Time zone" hint="The hours above are read in this zone">
      <select aria-label={`Time zone for ${agentName}`} className={`${selectClass} w-56`} value={value || 'UTC'} onChange={(e) => onChange(e.target.value)}>
        {timeZones(value).map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </Row>
  )
}

/** A clock time, HH:MM. Empty means any time. */
export function TimePicker({ label, agentName, value, onChange }: { label: string; agentName: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label} hint="Empty for any time">
      <Input
        type="time"
        aria-label={`${label} for ${agentName}`}
        className="w-32 font-figure"
        value={/^\d:\d\d$/.test(value) ? `0${value}` : value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Row>
  )
}

const or = (items: string[]) => new Intl.ListFormat('en', { type: 'disjunction' }).format(items)

/** The agent's saved rules, one plain sentence each. */
export function RulesInWords({ agentName, rules }: { agentName: string; rules: AgentRules }) {
  const choices = useRuleChoices()
  const modelName = (id: string) => modelLabel(choices.models, id)
  const providerName = (id: string) => choices.providers.find((p) => p.value === id)?.label ?? id
  const limits: [number, string][] = (
    [
      [rules.max_per_request_ulxc, 'on one request'],
      [rules.hourly_limit_ulxc ?? 0, 'an hour'],
      [rules.daily_limit_ulxc, 'a day'],
      [rules.weekly_limit_ulxc ?? 0, 'a week'],
      [rules.monthly_limit_ulxc, 'a month'],
    ] as [number, string][]
  ).filter(([v]) => v > 0)
  const models = rules.allowed_models ?? []
  const providers = rules.allowed_providers ?? []
  const listings = rules.allowed_listings ?? []
  const modelCaps = Object.entries(rules.model_daily_limits_ulxc ?? {}).filter(([, v]) => v > 0)
  return (
    <ul className="flex list-disc flex-col gap-1 py-3 pl-8 pr-gutter text-body text-ink" data-testid="rules-in-words">
      <li>
        {limits.length > 0 ? (
          <>
            {agentName} may spend at most{' '}
            {limits.map(([v, when], i) => (
              <span key={when}>
                {i > 0 ? (i === limits.length - 1 ? ' and ' : ', ') : null}
                <Lxc ulxc={v} /> {when}
              </span>
            ))}
            .
          </>
        ) : (
          <>{agentName} may spend everything its wallet holds — no limit is set.</>
        )}
      </li>
      {rules.approval_above_ulxc > 0 ? (
        <li>
          A person must approve any request or payment above <Lxc ulxc={rules.approval_above_ulxc} />.
        </li>
      ) : null}
      <li>
        {models.length > 0 ? `It may use only ${or(models.map(modelName))}` : 'It may use any model'}
        {providers.length > 0 ? `, from ${or(providers.map(providerName))}` : models.length > 0 ? '' : ' from any provider'}.
      </li>
      {modelCaps.length > 0 ? (
        <li>
          On one model it may spend at most{' '}
          {modelCaps.map(([model, v], i) => (
            <span key={model}>
              {i > 0 ? (i === modelCaps.length - 1 ? ' and ' : ', ') : null}
              <Lxc ulxc={v} /> a day on {modelName(model)}
            </span>
          ))}
          .
        </li>
      ) : null}
      {listings.length > 0 ? (
        <li>
          It may use only the {listings.length === 1 ? 'one marketplace listing' : `${listings.length} marketplace listings`} marked
          Allowed.
        </li>
      ) : null}
      <li>
        {rules.active_from || rules.active_until
          ? `It works only ${rules.active_from ? `from ${rules.active_from}` : ''}${rules.active_from && rules.active_until ? ' ' : ''}${rules.active_until ? `until ${rules.active_until}` : ''}, ${(rules.timezone || 'UTC').replace(/_/g, ' ')} time.`
          : 'It works at any time of day.'}
      </li>
      {rules.pause_on_unusual_spend ? <li>An unusual-spend alert pauses it until you resume it.</li> : null}
    </ul>
  )
}
