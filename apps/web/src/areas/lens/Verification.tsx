import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, type PillStatus } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { formatWhen } from './format'
import { CAPABILITIES_KEY, Note, readFailure } from './WalletMoney'
import {
  type VerificationBody,
  type VerificationCheck,
  type WalletCapability,
  type WorkspaceVerification,
  agentBankApi,
  refusalText,
} from './agentBankApi'

// Verification.tsx — B30.116: the owner's verification level (Lens B30.4). The level the checks reach and the live
// level live money is judged by, the next check as a form, every check on the record with its status and evidence
// reference, and beside each capability the level its live money needs. Lens decides the order and what a check
// counts for; the screen shows Lens's record and, on a refusal, Lens's own sentence.

export const VERIFICATION_KEY = ['verification']

const LEVELS = ['L0', 'L1', 'L2', 'L3'] as const
const MEANING: Record<string, string> = {
  L0: 'signed in',
  L1: 'email and phone confirmed',
  L2: 'identity checked',
  L3: 'company checked',
}

/** 0 to 3 for "L0" to "L3"; -1 for anything else. */
function rank(level: string | undefined): number {
  return LEVELS.indexOf(level as (typeof LEVELS)[number])
}

const SUBJECT: Record<string, string> = { contact: 'Email and phone', person: 'Identity', company: 'Company' }

const STATUS: Record<VerificationCheck['status'], { text: string; pill: PillStatus }> = {
  completed: { text: 'Passed', pill: 'settled' },
  pending: { text: 'Pending', pill: 'held' },
  failed: { text: 'Not passed', pill: 'slashed' },
  returned: { text: 'Withdrawn', pill: 'slashed' },
}

const fieldLabel = 'text-caption text-muted'

const useVerification = () => useQuery({ queryKey: VERIFICATION_KEY, queryFn: agentBankApi.verification })
const useCapabilities = () => useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })

export function VerificationScreen() {
  const v = useVerification()
  const caps = useCapabilities()
  const level = rank(v.data?.level)
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Verification"
        heading="What Talyvor has checked about you"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          Each level lets your agents do more with live money. Talyvor checks one level at a time and keeps the level, who
          checked it, when, and the checker’s reference as its evidence — never a copy of a document.
        </p>
        <PreviewNotice caps={caps.isSuccess ? (caps.data.capabilities ?? []) : null} />
        {v.isError ? (
          <p className="text-body text-muted">{readFailure(v.error, 'Your verification')}</p>
        ) : v.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : (
          <LevelCard v={v.data} />
        )}
      </Region>
      {v.isSuccess ? (
        <>
          <Region
            index="01"
            label="Next check"
            heading={level >= 3 ? 'Every level is reached' : `Reach ${LEVELS[level + 1]}: ${MEANING[LEVELS[level + 1]]}`}
            className="flex max-w-2xl flex-col gap-3"
          >
            <NextCheck v={v.data} />
          </Region>
          <Region index="02" label="Checks" heading="Every check on your record" className="flex max-w-2xl flex-col gap-3">
            <CheckList />
          </Region>
        </>
      ) : null}
      <Region
        index={v.isSuccess ? '03' : '01'}
        label="Levels"
        heading="The level each capability needs for live money"
        className="flex max-w-2xl flex-col gap-3"
      >
        <CapabilityLevels />
      </Region>
    </RegionScreen>
  )
}

/** "Preview — test money only" while any capability is AMBER or RED and takes test money; also while they are unread. */
function PreviewNotice({ caps }: { caps: WalletCapability[] | null }) {
  if (caps !== null && !caps.some((c) => c.class !== 'GREEN' && !c.real_money)) return null
  return (
    <p className="flex flex-wrap items-center gap-2 text-caption text-ink" data-testid="verification-preview">
      <Pill status="held">Preview — test money only</Pill>
      <span>Accounts, payments, currencies, trading and credit take test money only for now.</span>
    </p>
  )
}

function LevelCard({ v }: { v: WorkspaceVerification }) {
  const level = rank(v.level)
  const live = rank(v.live_level)
  return (
    <Card>
      <CardHeader>Your level</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <dl className="flex flex-col gap-2">
          <div className="flex items-baseline gap-4">
            <dt className="w-24 shrink-0 text-caption text-muted">Level</dt>
            <dd className="flex flex-wrap items-baseline gap-x-3" data-testid="verification-level">
              <span className="font-figure text-page text-ink">{v.level}</span>
              <span className="text-body text-ink">{v.meaning || MEANING[v.level]}</span>
            </dd>
          </div>
          <div className="flex items-baseline gap-4">
            <dt className="w-24 shrink-0 text-caption text-muted">Live level</dt>
            <dd className="flex flex-wrap items-baseline gap-x-3" data-testid="verification-live-level">
              <span className="font-figure text-page text-ink">{v.live_level}</span>
              <span className="text-body text-ink">{v.live_meaning || MEANING[v.live_level]}</span>
            </dd>
          </div>
        </dl>
        <p className="text-caption text-ink">
          Live money is judged by your live level, which counts only checks a real provider passed. With test money every
          level may try everything.
        </p>
        {level > live ? (
          <p className="text-caption text-ink" data-testid="verification-test-only">
            Your checks above {v.live_level} were passed by the Test provider, so they count for test money only.
          </p>
        ) : null}
      </div>
    </Card>
  )
}

/** The form for the check that reaches the next level. */
function NextCheck({ v }: { v: WorkspaceVerification }) {
  const qc = useQueryClient()
  const level = rank(v.level)
  const [f, setF] = useState({ email: '', phone: '', name: '', country: '', dob: '', number: '', directors: '', psc: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const check = useMutation({
    mutationFn: (body: VerificationBody) => agentBankApi.verify(body),
    onSuccess: (ans) => qc.setQueryData(VERIFICATION_KEY, ans.verification),
  })
  if (level >= 3) {
    return <p className="text-body text-muted">Your company is checked: there is no further level to reach.</p>
  }
  const names = (s: string) => s.split(',').map((n) => n.trim()).filter((n) => n !== '')
  const country = f.country.trim().toUpperCase()
  const body: VerificationBody | null =
    level === 0
      ? f.email.trim() && f.phone.trim()
        ? { kind: 'contact', email: f.email.trim(), phone: f.phone.trim() }
        : null
      : level === 1
        ? f.name.trim() && country && f.dob
          ? { kind: 'identity', name: f.name.trim(), country, date_of_birth: f.dob }
          : null
        : f.name.trim() && country && f.number.trim() && names(f.directors).length > 0
          ? {
              kind: 'company',
              name: f.name.trim(),
              country,
              company_number: f.number.trim(),
              directors: names(f.directors),
              people_with_significant_control: names(f.psc),
            }
          : null
  const pending = (v.checks ?? []).find((c) => rank(c.level) === level + 1 && c.status === 'pending')
  const field = (label: string, k: keyof typeof f, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-1">
      <span className={fieldLabel}>{label}</span>
      <Input value={f[k]} onChange={set(k)} {...props} />
    </label>
  )
  return (
    <Card>
      <CardHeader>{level === 0 ? 'Email and phone' : level === 1 ? 'Identity' : 'Company'}</CardHeader>
      <form
        aria-label="Next check"
        className="flex flex-col gap-3 px-gutter py-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (body && !check.isPending) check.mutate(body)
        }}
      >
        <p className="text-caption text-ink">
          {level === 0
            ? 'Talyvor confirms your email address and phone number with the checking provider and keeps neither.'
            : level === 1
              ? 'Your name, country and date of birth go to the checking provider; Talyvor keeps your verified name, country and the provider’s reference, not your date of birth.'
              : 'Your company’s name, country, number, directors and the people with significant control go to the checking provider. Separate several names with commas.'}
        </p>
        {pending ? (
          <Note ok>
            Your {SUBJECT[pending.subject]?.toLowerCase() ?? pending.subject} check is pending with the provider; this page
            asks again each time you open it.
          </Note>
        ) : null}
        <div className="grid grid-cols-1 gap-3 wide:grid-cols-2">
          {level === 0 ? (
            <>
              {field('Email', 'email', { type: 'email', autoComplete: 'email' })}
              {field('Phone, in international form', 'phone', {
                type: 'tel',
                autoComplete: 'tel',
                placeholder: '+447700900123',
                className: 'font-figure',
              })}
            </>
          ) : level === 1 ? (
            <>
              {field('Full name', 'name', { autoComplete: 'name' })}
              {field('Country', 'country', { placeholder: 'GB', maxLength: 2, className: 'w-24 font-figure' })}
              {field('Date of birth', 'dob', { type: 'date', className: 'font-figure' })}
            </>
          ) : (
            <>
              {field('Company name', 'name', { autoComplete: 'organization' })}
              {field('Country', 'country', { placeholder: 'GB', maxLength: 2, className: 'w-24 font-figure' })}
              {field('Company number', 'number', { className: 'font-figure' })}
              {field('Directors', 'directors')}
              {field('People with significant control', 'psc')}
            </>
          )}
        </div>
        <div>
          <Button type="submit" variant="primary" disabled={!body || check.isPending}>
            {check.isPending
              ? 'Checking…'
              : level === 0
                ? 'Check email and phone'
                : level === 1
                  ? 'Check identity'
                  : 'Check company'}
          </Button>
        </div>
        {check.isSuccess ? <CheckOutcome c={check.data.check} /> : null}
        {check.isError ? <Note ok={false}>{refusalText(check.error)}</Note> : null}
      </form>
    </Card>
  )
}

function CheckOutcome({ c }: { c: VerificationCheck }) {
  const what = `${c.level} — ${MEANING[c.level] ?? c.level}`
  if (c.status === 'completed') {
    return <Note ok>{c.test ? `Passed by the Test provider: ${what}. It counts for test money only.` : `Passed: ${what}.`}</Note>
  }
  if (c.status === 'pending') return <Note ok>The check for {what} is pending with the provider.</Note>
  return <Note ok={false}>The check for {what} did not pass{c.detail ? `: ${c.detail}` : '.'}</Note>
}

function CheckList() {
  const v = useVerification()
  if (v.isError) return <p className="text-body text-muted">{readFailure(v.error, 'Your checks')}</p>
  if (v.isPending) return <p className="text-body text-muted">Reading…</p>
  const checks = v.data.checks ?? []
  if (checks.length === 0) {
    return <p className="text-body text-muted">No check yet: you are signed in, which is L0. Each check appears here when you start it above.</p>
  }
  return (
    <Card>
      <CardHeader>Checks, newest first</CardHeader>
      <ul>
        {checks.map((c) => {
          const s = STATUS[c.status] ?? { text: c.status, pill: 'idle' as const }
          return (
            <li
              key={`${c.evidence_ref}-${c.started_at}`}
              className="flex flex-col gap-1 border-b border-rule px-gutter py-3 last:border-b-0"
              data-testid="verification-check"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-body text-ink">
                  <span className="font-figure">{c.level}</span> · {SUBJECT[c.subject] ?? c.subject}
                  {c.verified_name ? ` · ${c.verified_name}` : ''}
                </span>
                <Pill status={s.pill}>{s.text}</Pill>
              </div>
              <p className="text-caption text-muted">
                Checked by {c.method === 'test' ? 'the Test provider' : c.method} ·{' '}
                <span className="font-figure">{formatWhen(c.checked_at)}</span>
                {c.country ? ` · ${c.country}` : ''}
              </p>
              {c.test ? (
                <p className="flex items-center gap-1.5 text-caption text-ink">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-pill bg-held" aria-hidden="true" />
                  Test — counts for test money only
                </p>
              ) : null}
              <p className="text-caption text-muted">
                Evidence reference <span className="break-all font-figure text-ink">{c.evidence_ref}</span>
              </p>
              {c.detail ? <p className="text-caption text-ink">{c.detail}</p> : null}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Each level, what it means, whether this workspace reaches it, and beside each capability the level it needs. */
function CapabilityLevels() {
  const caps = useCapabilities()
  const v = useVerification().data
  if (caps.isError) return <p className="text-body text-muted">{readFailure(caps.error, 'The capabilities')}</p>
  if (caps.isPending) return <p className="text-body text-muted">Reading…</p>
  const leveled = (caps.data.capabilities ?? []).filter((c) => rank(c.level_needed) >= 0)
  if (leveled.length === 0) {
    return <p className="text-body text-muted">This deployment does not say yet which level each capability needs.</p>
  }
  const level = rank(v?.level)
  const live = rank(v?.live_level)
  const groups = LEVELS.map((l, n) => ({ l, n, here: leveled.filter((c) => c.level_needed === l) })).filter((g) => g.here.length > 0)
  return (
    <>
      {groups.map(({ l, n, here }) => {
        const state: { text: string; pill: PillStatus } | null = !v
          ? null
          : live >= n
            ? { text: 'Reached for live money', pill: 'settled' }
            : level >= n
              ? { text: 'Reached for test money only', pill: 'held' }
              : { text: 'Not reached yet', pill: 'idle' }
        return (
          <Card key={l} data-testid={`verification-needs-${l}`}>
            <CardHeader>
              <span className="font-figure">{l}</span> · {MEANING[l]}
            </CardHeader>
            {state ? (
              <p className="px-gutter pt-3">
                <Pill status={state.pill}>{state.text}</Pill>
              </p>
            ) : null}
            <ul className="px-gutter py-2">
              {here.map((c) => (
                <li
                  key={c.capability}
                  className="flex items-baseline justify-between gap-3 border-b border-rule py-2 last:border-b-0"
                  data-testid={`capability-level-${c.capability}`}
                >
                  <span className="min-w-0 text-body text-ink">{c.name}</span>
                  <span className="shrink-0 font-figure text-caption text-muted">{c.level_needed}</span>
                </li>
              ))}
            </ul>
          </Card>
        )
      })}
    </>
  )
}
