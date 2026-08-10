import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App, queryClient } from './App'

/**
 * WHEN `/auth/me` FAILS, THE CONSOLE RENDERED NOTHING — FOR AS LONG AS THE BFF WAS DOWN.
 *
 * `AuthGate` states the intended behaviour in its own comment: "a probe failure falls through to
 * the app, whose routes already render calm per-card failure states (a dead BFF is a fault, not a
 * sign-in prompt)". MEASURED: it did not fall through. It rendered an EMPTY `#root` and re-probed
 * the dead BFF about twice a second, indefinitely.
 *
 * ⚠ MEASURED IN REAL CHROME ON THE BUILT ARTIFACT, `/auth/me` failed three different ways —
 * `net::ERR_CONNECTION_REFUSED`, 502, and 500. All three identical: `#root` innerHTML length 0 at
 * every sample for 30 seconds, 39 probe requests in 20s. A MutationObserver on `#root` (rather
 * than polling, so an oscillation faster than a poll interval could not hide) recorded 9 subtree
 * mutations whose maximum content length was ZERO — the tree churned and never once held content.
 * The SAME harness answering the probe: ONE request, content in 118ms.
 *
 * ⚠ AND IT REPRODUCES HERE, against the real `<App/>` and the real exported `queryClient`:
 * 78 fetches in 4 seconds, `status` sampled `pending` and `fetchStatus` `fetching` every time
 * while the query cache recorded 70 `updated:error` events in the same window — it errored
 * seventy times and was restarted seventy times, so it never reached the error state a consumer
 * can see. `observerAdded` 85 / `observerRemoved` 84 is the shell mounting and unmounting.
 *
 * ⚠ THE CAUSE, ISOLATED TO ONE COMPONENT — same gate, same production client, one child changed:
 *       children = <div>APP CONTENT</div>                 ->  11 chars, status=error,  2 fetches
 *       children = <div>APP CONTENT<SessionChip/></div>   ->   0 chars, status=pending, climbing
 * React Query's `retryOnMount` defaults to TRUE, so an observer mounting onto an ERRORED query
 * starts a fresh fetch. The gate errored, fell through, the shell mounted `SessionChip`, its
 * observer restarted the probe, the gate returned to `isLoading` and rendered `null`, and the
 * shell — with `SessionChip` in it — unmounted. Round again. `lib/authMe.ts` carries the fix and
 * the rule: a reader may not restart a probe it does not own.
 *
 * ⚠ WHY NOTHING CAUGHT IT. `AuthGate.test.tsx` builds its OWN `new QueryClient({ queries: {
 * retry: false } })` rather than importing the app's. The production retry predicate, the
 * `QueryCache.onError` handler and this interaction are exercised by no test in this repo. These
 * cases use the REAL exported client on purpose, and clear it between them — that singleton
 * answering a later case is `#122`'s vacuity trap and it is live in this file.
 */

/** Every request the app makes, so the probe can be counted apart from the surfaces' own calls. */
let calls: string[] = []
const probeCalls = () => calls.filter((u) => u.includes('/auth/me')).length

function failEveryRequest(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      throw new TypeError('Failed to fetch')
    }),
  )
}

function answerProbe(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/auth/me')) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new TypeError('Failed to fetch')
    }),
  )
}

/**
 * Long enough for the loop to be unmistakable. ⚠ THE FIRST VERSION USED 1500ms AND A NUMBER FROM
 * A DIFFERENT INSTRUMENT: the "12 probes by 1200ms" it quoted was the count of ALL fetches the
 * app made, not of `/auth/me`. One turn of the loop costs the ~1000ms retry delay, so at 1500ms
 * the count was still inside the two-request budget and the case stayed green under main's own
 * shape. The number below is the probe alone, measured with the fix reverted.
 */
const SETTLE_MS = 4000

beforeEach(() => {
  calls = []
  queryClient.clear()
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  queryClient.clear()
})

describe('the console when its one auth probe fails', () => {
  it('⚠ falls through to the app, which is what AuthGate says it does', async () => {
    failEveryRequest()
    render(<App />)
    await waitFor(
      () => {
        expect(
          document.body.textContent ?? '',
          'the console rendered NOTHING on a failing probe. AuthGate promises a probe failure ' +
            '"falls through to the app, whose routes already render calm per-card failure ' +
            'states" — measured in Chrome, #root stayed empty for 30s while the dead BFF was ' +
            're-probed 39 times in 20s.',
        ).toContain('Overview')
      },
      { timeout: 5000 },
    )
  })

  it('⚠ does not re-probe the dead BFF without bound', async () => {
    failEveryRequest()
    render(<App />)
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    expect(
      probeCalls(),
      `/auth/me was requested ${probeCalls()} times in ${SETTLE_MS}ms. The configured retry is ` +
        'one, so two requests is the whole budget; anything above it is the gate and a reader ' +
        'restarting each other.',
    ).toBeLessThanOrEqual(3)
  })

  it('reaches a settled error rather than fetching for ever', async () => {
    failEveryRequest()
    render(<App />)
    await new Promise((r) => setTimeout(r, SETTLE_MS))
    const state = queryClient.getQueryState(['auth-me'])
    expect(
      `${state?.status}/${state?.fetchStatus}`,
      'the probe never settles, so no consumer can ever see that it failed',
    ).toBe('error/idle')
  })

  it('says what is wrong on the surface rather than showing a blank page', async () => {
    failEveryRequest()
    render(<App />)
    await waitFor(() => expect(document.body.textContent ?? '').toMatch(/Couldn’t load|Couldn't load/), {
      timeout: 5000,
    })
  })
})

describe('the seam, enumerated', () => {
  /**
   * ⚠ THE BEHAVIOURAL CASES ABOVE REACH ONE OF THE FOUR READERS — `SessionChip`, which is in the
   * shell on every console route. `Setup`, `Sharing` and `legalParts` hold the same observer on
   * their own routes and would restart the same probe; rendering three more routes to say so
   * would be three more slow cases asserting one fact. This says it once, structurally: apart
   * from the OWNER in AuthGate, no file may declare this query itself.
   *
   * LIMIT, STATED NOT HIDDEN: this reads source, so it cannot see a reader that reaches the probe
   * some other way, and it is not a substitute for the measurement above. It is the enumeration.
   */
  it('has exactly one raw declaration of the probe — the gate that owns it', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join, resolve } = await import('node:path')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p)
      }
    }
    walk(resolve(__dirname))

    // ⚠ COUNTED PER CALL SITE, NOT PER FILE, and that is not a detail. The first version listed
    // the FILES that declare it and expected two names. Restoring main's shape puts a SECOND raw
    // declaration into AuthGate.tsx — a file already on the list — so the list did not move and
    // this case stayed green through the exact mutation it exists for. The dedupe key was the
    // unit of measurement, and the unit was wrong.
    const DECL = /queryKey:\s*\['auth-me'\],\s*queryFn:\s*api\.me/g
    const sites = files.flatMap((f) => {
      const n = (readFileSync(f, 'utf8').match(DECL) ?? []).length
      return Array.from({ length: n }, () => f.slice(resolve(__dirname).length + 1))
    })
    expect(
      sites.sort(),
      'the auth probe is declared somewhere other than its owner. Every such reader mounts an ' +
        'observer that restarts an ERRORED probe (retryOnMount defaults to true), which is what ' +
        'made the console render nothing. Readers go through lib/authMe.ts.',
    ).toEqual(['components/AuthGate.tsx', 'lib/authMe.ts'])
  })
})

describe('and the halves that must not change', () => {
  it('still gates a signed-out oidc session to the sign-in card', async () => {
    answerProbe({ mode: 'oidc', authenticated: false })
    render(<App />)
    expect(await screen.findByText('Sign in to Talyvor')).toBeInTheDocument()
  })

  /**
   * ⚠ THIS CASE EXISTS BECAUSE A CONTROL ESCAPED. `enabled: false` on the readers kills the loop
   * just as well and passed every other case in this file, so nothing chose between the two
   * fixes. They differ HERE: `/privacy` is PUBLIC — it renders OUTSIDE the AuthGate, so on that
   * page no gate has ever fetched the probe, and the reader's own fetch is the only one there
   * will be. `retryOnMount: false` still fetches a query that has never run; `enabled: false`
   * would leave the legal pages permanently unable to tell whether you are signed in.
   */
  it('still probes on a PUBLIC page, where no gate has fetched it first', async () => {
    answerProbe({ mode: 'oidc', authenticated: true, user: { email: 'a@b.c' } })
    window.history.pushState({}, '', '/privacy')
    render(<App />)
    await waitFor(() => expect(document.body.textContent ?? '').toContain('Privacy'), { timeout: 5000 })
    await waitFor(
      () =>
        expect(
          probeCalls(),
          'the legal pages read the probe with no gate above them. A reader that never fetches ' +
            'leaves them unable to answer whether you are signed in.',
        ).toBe(1),
      { timeout: 5000 },
    )
  })

  it('still renders the app for a live session, and probes exactly once', async () => {
    answerProbe({ mode: 'oidc', authenticated: true, user: { email: 'a@b.c' } })
    render(<App />)
    await waitFor(() => expect(document.body.textContent ?? '').toContain('Overview'), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 300))
    expect(
      probeCalls(),
      'a working probe must still be fetched — a fix that stopped fetching would pass every ' +
        'case above and break the product',
    ).toBe(1)
  })
})
