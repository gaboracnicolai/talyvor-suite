import { useMutation } from '@tanstack/react-query'
import { Button, CardHeader, Pill, Row, cn, focusRing } from '@talyvor/ui'
import { Card } from './walletBrand'
import { CopyButton } from '../chat/CopyButton'
import { formatWhen } from './format'
import { Lxc } from './money'
import { Note } from './WalletMoney'
import { type Agent, type KYACredential, agentBankApi, refusalText } from './agentBankApi'

// AgentCredential.tsx — B30.103: an agent's Know Your Agent credential (Lens B30.5, docs/kya.md). What it says — the
// agent, its owner's verified name and level, what it may do with live money, its limits — the credential itself to
// copy and hand to another platform, and Talyvor's own check of it, the same check that platform makes. Lens signs and
// revokes; a frozen or archived agent has none, and Lens's sentence says why.

/** The limits a credential may state, in the order a person reads them; an absent one is not set. */
const LIMITS: [string, string][] = [
  ['max_per_request_ulxc', 'Per request'],
  ['hourly_limit_ulxc', 'Each hour'],
  ['daily_limit_ulxc', 'Each day'],
  ['weekly_limit_ulxc', 'Each week'],
  ['monthly_limit_ulxc', 'Each month'],
  ['approval_above_ulxc', 'A person approves above'],
  ['max_commitment_ulxc', 'Most it may commit'],
]

export function AgentCredentialCard({ agent }: { agent: Agent }) {
  const read = useMutation({ mutationFn: () => agentBankApi.credential(agent.id) })
  const check = useMutation({ mutationFn: (token: string) => agentBankApi.verifyCredential(token) })
  const c = read.data
  return (
    <Card data-testid="agent-credential">
      <CardHeader>Know Your Agent credential</CardHeader>
      <Row
        label="Its credential"
        hint="Signed by Talyvor: who owns this agent, how far they are verified, what it may do with live money and its limits. Any platform can check it."
      >
        <Button
          disabled={read.isPending}
          onClick={() => {
            check.reset()
            read.mutate()
          }}
        >
          {read.isPending ? 'Reading…' : c ? 'Read it again' : 'Show its credential'}
        </Button>
      </Row>
      {read.isError ? (
        <div className="px-gutter py-2">
          <Note ok={false}>{refusalText(read.error)}</Note>
        </div>
      ) : null}
      {c ? <CredentialBody c={c} /> : null}
      {c ? (
        <div className="flex flex-col gap-2 px-gutter pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={c.credential} label="Copy credential" className="border border-rule" />
            <Button disabled={check.isPending} onClick={() => check.mutate(c.credential)}>
              {check.isPending ? 'Checking…' : 'Check it with Talyvor'}
            </Button>
          </div>
          {check.isSuccess ? (
            check.data.valid ? (
              <p className="flex flex-wrap items-center gap-2 text-caption text-ink" role="status" data-testid="credential-verdict">
                <Pill status="settled">Valid</Pill>
                <span>Talyvor issued it, has not revoked it, and it says what is true of {agent.name} now.</span>
              </p>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-caption text-ink" role="alert" data-testid="credential-verdict">
                <Pill status="slashed">Not valid</Pill>
                <span>{check.data.reason}</span>
              </p>
            )
          ) : null}
          {check.isError ? <Note ok={false}>{refusalText(check.error)}</Note> : null}
        </div>
      ) : null}
    </Card>
  )
}

function CredentialBody({ c }: { c: KYACredential }) {
  const { owner, capabilities, limits } = c.claims
  const live = (capabilities ?? []).filter((x) => x.money === 'live').length
  const all = (capabilities ?? []).length
  const set = LIMITS.filter(([k]) => typeof limits?.[k] === 'number' && (limits[k] as number) > 0)
  const term = 'w-28 shrink-0 text-caption text-muted'
  return (
    <div className="flex flex-col gap-3 border-t border-rule px-gutter py-3">
      <dl className="flex flex-col gap-2">
        <div className="flex items-baseline gap-4">
          <dt className={term}>Owner</dt>
          <dd className="min-w-0 text-body text-ink" data-testid="credential-owner">
            {owner.name || 'Not verified by name yet'} · level <span className="font-figure">{owner.level}</span>, live level{' '}
            <span className="font-figure">{owner.live_level}</span>
          </dd>
        </div>
        <div className="flex items-baseline gap-4">
          <dt className={term}>Live money</dt>
          <dd className="text-body text-ink" data-testid="credential-capabilities">
            <span className="font-figure">{live}</span> of <span className="font-figure">{all}</span> capabilities; the rest take test
            money only
          </dd>
        </div>
        <div className="flex items-baseline gap-4">
          <dt className={term}>Limits</dt>
          <dd className="flex min-w-0 flex-col gap-1 text-body text-ink" data-testid="credential-limits">
            {set.length > 0
              ? set.map(([k, label]) => (
                  <span key={k}>
                    {label} <Lxc ulxc={limits[k] as number} />
                  </span>
                ))
              : 'No spending limit is set'}
          </dd>
        </div>
        <div className="flex items-baseline gap-4">
          <dt className={term}>Valid</dt>
          <dd className="text-body text-ink">
            <span className="font-figure">{formatWhen(c.issued_at)}</span> to <span className="font-figure">{formatWhen(c.expires_at)}</span>
          </dd>
        </div>
      </dl>
      <pre
        className={cn(
          'max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-control border border-rule px-3 py-2 font-figure text-caption text-ink',
          focusRing,
        )}
        data-testid="credential-token"
        tabIndex={0}
        aria-label="The credential"
      >
        {c.credential}
      </pre>
      <p className="text-caption text-muted">
        A platform checks it against Talyvor’s published keys
        {c.jwks_url ? (
          <>
            {' '}
            at <span className="break-all font-figure text-ink">{c.jwks_url}</span>
          </>
        ) : null}
        , or asks Talyvor as the button below does. Freezing the agent, archiving it or changing its rules revokes it.
      </p>
    </div>
  )
}
