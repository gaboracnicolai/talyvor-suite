import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, CardHeader, focusRing, inlineLink } from '@talyvor/ui'
import { ApiError } from '../../lib/api'
import { useAuthMeReader } from '../../lib/authMe'
import { DocumentFacts, DistillChoice } from './Documents'
import { StoredAnswersFacts } from '../../components/StoredAnswersFacts'
import { ProviderKeysCard } from './ProviderKeys'
import { CompanyLine } from '../../components/CompanyLine'

// Sharing.tsx — cross-tenant answer sharing: the explanation, and the control.
//
// ONE FILE ON PURPOSE. The signup prompt and the settings control describe the same thing and
// write to the same endpoint. Kept apart they drift, and the first draft of the signup screen
// already shipped a claim the product could not honour ("you can change this later in settings"
// — there was no settings screen). A claim about CONSENT is the worst kind to let go stale, so
// the words and the control live together and are used by both screens.
//
// THE COPY STATES BOTH SIDES AND SELLS NEITHER. Sharing is what makes the earning half of the
// product work: this workspace's answers earn LENS when another company reuses them, and it is
// served instantly from theirs. It is also a real disclosure: the content of answers leaves the
// workspace. Both facts are load-bearing, so both are stated, in parallel structure and with the
// same weight. No recommendation, no default-highlighted button, no language that makes one
// option feel like the sensible one. A consent screen that sells is worse than one that only
// warns — the person has to be able to read it and decide.
//
// B28.10 — SAVINGS FIRST, EARNINGS LAST. Sharing is a cost saving: a repeated question is served
// from an answer another company already paid for. The royalty a shared answer earns is a side
// effect, so it is the last line on the "on" side and is called a royalty, not the point. The
// disclosure stays exactly where it was, beside the saving, with the same weight.
//
// This matters more since sharing became ON by default: the screen is now the only thing standing
// between a person and disclosure, so it has to be readable by someone who is not looking for it.

/** SharingFacts — the whole description, used verbatim by both screens. */
export function SharingFacts() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body">
        Shared answers save on repeated questions. When another company has already asked a
        near-identical question, this workspace can be served their answer instead of paying a
        model for a new one — and an answer produced here may be served to them the same way.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <p className="text-body text-ink">If sharing is on</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-body text-muted">
            <li>Repeated questions are served instantly from shared answers, without paying a model.</li>
            <li>The content of your answers leaves this workspace.</li>
            <li>
              When another company is served one of your answers, you earn a small royalty, shown on{' '}
              <Link to="/statements/royalties" className={inlineLink}>
                Royalties
              </Link>
              .
            </li>
          </ul>
        </div>
        <div className="flex-1">
          <p className="text-body text-ink">If sharing is off</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-body text-muted">
            <li>You pay full price for repeated questions.</li>
            <li>You are never served another company&rsquo;s answers.</li>
            <li>New answers produced here are not shared, and earn no royalty.</li>
          </ul>
        </div>
      </div>

      <p className="text-body text-muted">
        Your API keys, your balance and your ledger are never shared, in either setting.
      </p>
      <StoredAnswersFacts />
    </div>
  )
}

/**
 * SharingChoice — the control. Reads the RECORDED value from the session probe and writes through
 * POST /api/pooling, which the BFF forwards to Lens as PUT /v1/workspaces/{wsID}/cache-poolable
 * with this session's own token.
 *
 * It renders what is STORED, never what was requested: the BFF returns the consent Lens actually
 * recorded, and this re-probes after every write. If a write is refused or only partly applied,
 * the screen says so instead of showing an optimistic result.
 */
/** Writes the choice; throws when it did not save. Both controls re-probe /auth/me after it. */
async function savePooling(cachePoolable: boolean): Promise<void> {
  // Relative path ⇒ same-origin ⇒ the browser supplies the Origin the BFF requires.
  const res = await fetch('/api/pooling', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ cache_poolable: cachePoolable }),
  })
  if (!res.ok) throw new ApiError(res.status, '/api/pooling')
}

export function SharingChoice({ onDone }: { onDone?: () => void }) {
  const q = useAuthMeReader()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'on' | 'off' | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const recorded = q.data?.cache_poolable

  async function choose(cachePoolable: boolean) {
    setBusy(cachePoolable ? 'on' : 'off')
    setFailed(null)
    try {
      await savePooling(cachePoolable)
      await qc.invalidateQueries({ queryKey: ['auth-me'] })
      onDone?.()
    } catch {
      setFailed('That did not save, so nothing changed. You can try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The stored state, stated before the buttons — so the person is choosing against what is
          actually true, not against what they last clicked. */}
      {q.isLoading ? (
        <p className="text-body text-muted">Checking this workspace&rsquo;s setting…</p>
      ) : recorded === undefined ? (
        <p className="text-body text-muted">
          This workspace&rsquo;s sharing setting could not be read, so it is not shown. The buttons
          below still work, and the result is re-read afterwards.
        </p>
      ) : (
        <p className="text-body">
          Sharing is currently <strong>{recorded ? 'on' : 'off'}</strong> for this workspace.
        </p>
      )}

      {failed && <p className="border-l-2 border-l-slashed pl-2 text-body text-ink">{failed}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled={busy !== null} onClick={() => void choose(false)}>
          {busy === 'off' ? 'Saving…' : 'Do not share my answers'}
        </Button>
        <Button disabled={busy !== null} onClick={() => void choose(true)}>
          {busy === 'on' ? 'Saving…' : 'Share my answers'}
        </Button>
      </div>
    </div>
  )
}

/**
 * SharingLine — B28.8: the signup notice as one line to tick, on the onboarding that replaced the
 * full-screen consent page. The box is the RECORDED setting (a new workspace starts with sharing on,
 * Lens's default), so the line tells a person what is already true and one click stops it; the whole
 * account stays one link away in Settings. Like SharingChoice it re-reads what Lens stored after a write.
 */
export function SharingLine() {
  const q = useAuthMeReader()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const recorded = q.data?.cache_poolable

  async function toggle(cachePoolable: boolean) {
    setBusy(true)
    setFailed(false)
    try {
      await savePooling(cachePoolable)
      await qc.invalidateQueries({ queryKey: ['auth-me'] })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-2 text-caption text-muted">
        <input
          type="checkbox"
          className={`mt-0.5 h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          checked={recorded === true}
          disabled={busy || recorded === undefined}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          Share answers with other companies, so repeated questions cost less: an answer made here may be
          served to another company, and you earn a small royalty when it is.{' '}
          {recorded === undefined ? 'This workspace’s setting could not be read.' : recorded ? 'On now; untick to stop.' : 'Off now.'}{' '}
          <Link to="/settings" className={inlineLink}>
            What sharing means
          </Link>
        </span>
      </label>
      {failed ? <p className="text-caption text-ink">That did not save, so nothing changed. You can try again.</p> : null}
    </div>
  )
}

/** Settings — the standing control, reachable any time from the nav. */
export function Settings() {
  return (
    <div className="flex flex-col gap-gutter">
      <Card>
        <CardHeader>Shared answers (saves on repeated questions)</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          <SharingFacts />
          <SharingChoice />
        </div>
      </Card>

      {/* Document conversion is ON for every workspace by default and had no control anywhere in
          the product. Kept as its OWN card, not folded into sharing: they are different consents
          and a person may reasonably want one without the other. */}
      <Card>
        <CardHeader>Documents you attach</CardHeader>
        <div className="flex flex-col gap-4 px-gutter py-4">
          <DocumentFacts />
          <DistillChoice />
        </div>
      </Card>

      {/* B27.27 — BYOK's keys: added, replaced and removed here, only their last four ever shown. */}
      <ProviderKeysCard />

      <CompanyLine />
    </div>
  )
}
