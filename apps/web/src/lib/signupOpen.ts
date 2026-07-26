import { useEffect, useState } from 'react'
import type { AuthMe } from './api'

// WHETHER A STRANGER CAN GET IN — asked of the server, never written into the bundle.
//
// The marketing hero and the signup page both have to tell someone who has never heard of us
// whether they can start right now. That fact lives in OIDC_ALLOWED_EMAILS on the BFF: `*`
// admits every identity the issuer authenticates; anything else is a list.
//
// The tempting implementation is a sentence in the page and a note to change it later. That is
// how the landing page came to read "Talyvor is in a closed trial, so accounts are set up by
// hand" — a sentence that was true when written, is a lie the moment the operator sets `*`, and
// that nothing in the build can notice. The inverse is worse: "get started free" printed while
// the gate is still six addresses sends every visitor into a refusal.
//
// So the BFF reports it on /auth/me (public, always 200, no session needed — the audience for
// this answer is by definition not signed in) and the page renders the server's answer. One
// predicate, two readers: `signupIsOpen` in apps/bff/auth.go is the same function the callback
// authorises with, so the page and the door cannot disagree.
//
// THREE STATES, NOT TWO. `unknown` is a real answer and gets its own word:
//   · the probe has not come back yet (first paint),
//   · it failed (BFF down, offline),
//   · or the BFF is older than this field and says nothing.
// Collapsing unknown into either boolean picks a lie: guessing `closed` turns away a stranger
// who could have signed up in twenty seconds and never tells anyone it happened; guessing
// `open` walks them into a refusal we could have predicted. So callers render NEITHER promise
// while unknown, and still offer the action — trying the door is always available.
export type SignupState = 'unknown' | 'open' | 'closed'

export interface SignupProbe {
  signup: SignupState
  /** Whether this browser already has a session, so an entry page can stop selling. */
  authenticated: boolean
}

/** Reads the probe body into the three-state answer. Exported for direct testing: the mapping
 *  of "field absent" → unknown is the part that must not drift. */
export function signupStateOf(me: Pick<AuthMe, 'signup_open'> | null | undefined): SignupState {
  if (!me || me.signup_open === undefined || me.signup_open === null) return 'unknown'
  return me.signup_open ? 'open' : 'closed'
}

/**
 * The probe, deliberately WITHOUT react-query.
 *
 * Landing.tsx is a public page that renders with no providers at all — no query client, no
 * router — and Landing.test.tsx renders it bare to keep it that way. A hook that needed a
 * provider would drag the whole app's context onto the one page that must work without it. A
 * bare fetch in an effect is the entire requirement here: one read, no cache, no retry.
 *
 * A failure is NOT an error state to render. There is no useful screen for "we could not ask
 * the server whether you may sign up" — the person can simply try. So a failure resolves to
 * `unknown`, which is the state that promises nothing.
 */
export function useSignupProbe(): SignupProbe {
  const [probe, setProbe] = useState<SignupProbe>({ signup: 'unknown', authenticated: false })

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch('/auth/me', { headers: { Accept: 'application/json' } })
        if (!res.ok) return
        const me = (await res.json()) as AuthMe
        if (!live) return
        setProbe({ signup: signupStateOf(me), authenticated: Boolean(me.authenticated) })
      } catch {
        // Stays `unknown`. See above: silence is a state, not a screen.
      }
    })()
    return () => {
      live = false
    }
  }, [])

  return probe
}
