import { Button } from '@talyvor/ui'
import { isSessionExpired, sessionExpiredCopy } from '../lib/productState'
import { useSessionExpired } from '../lib/useSessionExpired'

// ONE dead session is ONE message.
//
// During the incident the app drew eight independent failures — a card each for the LXC
// balance, the mint ledger, month spend, the cache rate, two "Couldn't check" pills — with one
// cause between them. Eight failures read as eight broken things: a reader counts them, assumes
// a widespread outage, and goes looking for eight explanations. The truth was one expired
// credential and one click.
//
// So the explanation lives HERE, once, above the content on every route, and the panels below
// fall silent rather than each repeating a diagnosis they cannot make. A panel knows only that
// its own request failed; only this bar can see that all of them failed for the same reason.
export function SessionExpiredBar() {
  const expired = useSessionExpired()
  if (!expired) return null

  // Come back to the page they were on. The BFF re-sanitises this server-side (sanitizeReturnTo),
  // so a hostile value cannot make this an open redirect.
  const returnTo = window.location.pathname + window.location.search

  return (
    <div
      // `alert` rather than `status`: this is not progress, it is a stop condition — the screen
      // below it is showing nothing and will keep showing nothing until it is acted on.
      role="alert"
      className="mb-gutter flex flex-wrap items-center justify-between gap-3 rounded-control border border-rule-strong bg-sidebar px-gutter py-3"
    >
      <p className="text-body text-ink">{sessionExpiredCopy}</p>
      {/* THE FIX AS A CLICK, not as advice. /auth/login rotates the session and re-provisions,
          which mints a fresh workspace token — so this one link is the whole remedy. The manual
          workaround during the incident was "sign out and back in", which is two steps for the
          same effect and which nobody could have guessed from "Couldn't load". */}
      <Button asChild variant="primary">
        <a href={`/auth/login?return_to=${encodeURIComponent(returnTo)}`}>Sign in again</a>
      </Button>
    </div>
  )
}

// ── what a panel says when it cannot speak ──────────────────────────────────
//
// Every failing panel used to render "Couldn't load <thing>." — correct for a genuine fault and
// a misdiagnosis for an expired credential. These two components put that decision in ONE place
// so a panel cannot hold an opinion about a cause it cannot see.
//
// On an expired session they render a neutral placeholder and nothing else: the bar above has
// already said what happened and what to do, and a card repeating it is the eighth voice this
// change exists to remove. Deliberately a WORD and not a dash — "—" in a slot that usually holds
// a number reads as zero, and a balance that says zero when it is merely unknown is the worst
// available answer.
//
// AND DELIBERATELY NOT "Unavailable while signed out." This first said exactly that, which is a
// second (quieter, differently-worded) diagnosis of the one cause — seven of them, under a bar
// that had already given the first. The "say it once" test failed on my own implementation of
// the thing it exists to prevent, which is the clearest evidence that the rule is easy to break
// while believing you are keeping it. The placeholder states availability, never a reason.

/** Block form: a card body that has nothing to show. */
export function PanelFailure({ error, what }: { error: unknown; what: string }) {
  return (
    <div className="px-gutter py-3 text-body text-muted">
      {isSessionExpired(error) ? 'Unavailable.' : `Couldn’t load ${what}.`}
    </div>
  )
}

/**
 * Inline form: a value slot inside a Row, where the label already says what it is.
 *
 * `failed` is the GENUINE-FAULT wording only — the expired-session wording is not a parameter,
 * because letting each call site phrase that would recreate the eight-different-voices problem
 * one prop at a time. The probe rows pass "Couldn’t check" because "load" is wrong for a
 * liveness probe; that distinction matters when something really is broken and matters not at
 * all when the credential is dead.
 */
export function InlineFailure({
  error,
  className = 'text-body text-muted',
  failed = 'Couldn’t load',
}: {
  error: unknown
  className?: string
  failed?: string
}) {
  return <span className={className}>{isSessionExpired(error) ? 'Unavailable' : failed}</span>
}
