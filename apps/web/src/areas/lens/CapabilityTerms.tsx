import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Pill, cn, focusRing, inlineLink, type PillStatus } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { Markdown } from '../chat/Markdown'
import { formatWhen } from './format'
import { CAPABILITIES_KEY, Note, readFailure } from './WalletMoney'
import { type WorkspaceTerms, agentBankApi, refusalText } from './agentBankApi'

// CapabilityTerms.tsx — B30.103: each money capability's terms (Lens B30.9). Every capability with terms, its latest
// version and whether this workspace has accepted it; its text to read; and the button that accepts the version read.
// Until a capability's latest terms are accepted Lens refuses its money, test or live, so accepting here is what lets
// its first use through. Lens decides who may accept and which version is the latest; a refusal shows its sentence.

export const TERMS_KEY = ['capability-terms']
const termsTextKey = (capability: string) => ['capability-terms', capability]

/** " by <who>" when Lens names the person by an address a reader knows; nothing for an internal id such as jwt:user:…. */
const byWhom = (person: string) => (person.includes('@') && !person.includes(':') ? ` by ${person}` : '')

function state(t: WorkspaceTerms): { text: string; pill: PillStatus } {
  if (t.accepted) return { text: 'Accepted', pill: 'settled' }
  if (t.previously_accepted_version) return { text: `Version ${t.version} is new — accept it again`, pill: 'held' }
  return { text: 'Not accepted yet', pill: 'idle' }
}

export function CapabilityTermsScreen() {
  const terms = useQuery({ queryKey: TERMS_KEY, queryFn: agentBankApi.terms })
  const caps = useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })
  const [open, setOpen] = useState<string | null>(null)
  const list = terms.data?.terms ?? []
  const accepted = list.filter((t) => t.accepted).length
  const preview = !caps.isSuccess || (caps.data.capabilities ?? []).some((c) => c.class !== 'GREEN' && !c.real_money)
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Terms"
        heading="The terms each money capability asks you to accept"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          Each money capability asks you to accept its terms before its first use, with test money or live. When Talyvor
          publishes a new version, the capability asks again before its next use.
        </p>
        <p className="text-body text-muted">
          Which of them may use live money depends on your verification level:{' '}
          <Link className={inlineLink} to="/settings/verification">
            see Verification
          </Link>
          .
        </p>
        {preview ? (
          <p className="flex flex-wrap items-center gap-2 text-caption text-ink" data-testid="terms-preview">
            <Pill status="held">Preview — test money only</Pill>
            <span>Accounts, payments, currencies, trading and credit take test money only for now.</span>
          </p>
        ) : null}
        {terms.isSuccess && list.length > 0 ? (
          <p className="text-body text-ink" data-testid="terms-count">
            <span className="font-figure">{accepted}</span> of <span className="font-figure">{list.length}</span> accepted
          </p>
        ) : null}
      </Region>
      <Region index="01" label="Capabilities" heading="Read each one, then accept it" className="flex max-w-2xl flex-col gap-3">
        {terms.isError ? (
          <p className="text-body text-muted">{readFailure(terms.error, 'The terms')}</p>
        ) : terms.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : list.length === 0 ? (
          <p className="text-body text-muted">No capability asks for terms on this deployment yet.</p>
        ) : (
          <Card>
            <CardHeader>Every capability with terms</CardHeader>
            <ul>
              {list.map((t) => (
                <TermsRow key={t.capability} t={t} open={open === t.capability} onOpen={(o) => setOpen(o ? t.capability : null)} />
              ))}
            </ul>
          </Card>
        )}
      </Region>
    </RegionScreen>
  )
}

function TermsRow({ t, open, onOpen }: { t: WorkspaceTerms; open: boolean; onOpen: (open: boolean) => void }) {
  const s = state(t)
  return (
    <li className="flex flex-col gap-2 border-b border-rule px-gutter py-3 last:border-b-0" data-testid={`terms-${t.capability}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-body text-ink">{t.name}</span>
        <Pill status={s.pill}>{s.text}</Pill>
      </div>
      <p className="text-caption text-muted">
        Version <span className="font-figure">{t.version}</span>
        {t.accepted ? (
          <>
            {' '}
            · accepted{byWhom(t.accepted.person)} · <span className="font-figure">{formatWhen(t.accepted.accepted_at)}</span>
          </>
        ) : t.previously_accepted_version ? (
          <>
            {' '}
            · you accepted version <span className="font-figure">{t.previously_accepted_version}</span>
          </>
        ) : null}
      </p>
      <div>
        <Button aria-expanded={open} onClick={() => onOpen(!open)}>
          {open ? 'Close' : t.accepted ? 'Read the terms' : 'Read and accept'}
        </Button>
      </div>
      {open ? <TermsText t={t} /> : null}
    </li>
  )
}

/** The latest version's text, and the button that accepts it. */
function TermsText({ t }: { t: WorkspaceTerms }) {
  const qc = useQueryClient()
  const text = useQuery({ queryKey: termsTextKey(t.capability), queryFn: () => agentBankApi.termsFor(t.capability) })
  const accept = useMutation({
    mutationFn: (version: number) => agentBankApi.acceptTerms(t.capability, version),
    onSuccess: ({ acceptance }) => {
      qc.setQueryData<{ terms: WorkspaceTerms[] | null }>(TERMS_KEY, (old) =>
        old ? { terms: (old.terms ?? []).map((x) => (x.capability === t.capability ? { ...x, accepted: acceptance } : x)) } : old,
      )
      qc.setQueryData<WorkspaceTerms>(termsTextKey(t.capability), (old) => (old ? { ...old, accepted: acceptance } : old))
    },
    // A newer version was published while this one was being read: read the list and the text again.
    onError: () => void qc.invalidateQueries({ queryKey: TERMS_KEY }),
  })
  if (text.isError) return <p className="text-body text-muted">{readFailure(text.error, 'These terms')}</p>
  if (text.isPending) return <p className="text-body text-muted">Reading…</p>
  const read = text.data
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn('max-h-96 overflow-y-auto rounded-control border border-rule px-gutter py-3 text-body text-ink', focusRing)}
        data-testid="terms-text"
        tabIndex={0}
        aria-label={`${t.name}: terms, version ${read.version}`}
      >
        <Markdown source={read.body ?? ''} />
      </div>
      {read.accepted ? (
        <Note ok>
          Version {read.version} is accepted{byWhom(read.accepted.person)}. {t.name} may be used.
        </Note>
      ) : (
        <div>
          <Button variant="primary" disabled={accept.isPending} onClick={() => accept.mutate(read.version)}>
            {accept.isPending ? 'Accepting…' : `Accept version ${read.version}`}
          </Button>
        </div>
      )}
      {accept.isError ? <Note ok={false}>{refusalText(accept.error)}</Note> : null}
    </div>
  )
}
