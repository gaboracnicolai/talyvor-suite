import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

/**
 * THE ENUMERATION'S OTHER INPUT: WHICH FILES IT READS, AND IT WAS THE UNCONTROLLED ONE.
 *
 * The case below is careful about its unit of measurement — per call site, not per file, because
 * the per-file version stayed green through the exact mutation it exists for. It was not careful
 * about its POPULATION: the walk decides which files the `DECL` regex ever meets, and the case's
 * output for "read nothing" is byte-identical to its output for "read everything and found only
 * the two owners".
 *
 * MEASURED at db85e4d on the real tree, not reasoned about
 * (`~/talyvor-queue/w11-blindwalk-controls-9e73.py` and `w11-blindwalk-armed-9e73.py`, every
 * mutation anchor-count-asserted before the edit, restored in a `finally` and verified back by
 * sha256, verdicts read from vitest's own per-test lines):
 *   A1  a second raw `queryKey: ['auth-me'], queryFn: api.me` reader — the declaration whose
 *       duplication made the console render nothing — added to a real screen at
 *       `areas/lens/Ledger.tsx`: REDS this case, and only this case.
 *   A2  THE HOLE: the same new reader, plus ONE line so the walk does not descend into `areas` —
 *       rc=0, GREEN. 43 of the 70 production files under apps/web/src live there, and `areas/`
 *       is where THREE OF THE FOUR readers named above live (`Setup`, `Sharing`, `legalParts`
 *       are the other holders of this observer). The enumeration existed to speak for exactly
 *       those, and one line took them out of its sight.
 *   C3  the skip ALONE, no new reader: GREEN. Nothing anywhere notices the population shrank.
 *
 * That is #183's C1/C2/C3, in this file. #183 closed it in `lib/awaiting.test.ts` and named the
 * three sweeps it had not been run against; this is one of them.
 *
 * THE REPAIR IS #183's AND IT IS THRESHOLD-FREE — an INDEPENDENT ENUMERATION. `import.meta.glob`
 * is resolved by Vite at transform time and touches `node:fs` not at all, so a skip map, a
 * changed extension filter or a wrong anchor cannot move both instruments the same way. Compared
 * BOTH DIRECTIONS, with a floor for the one failure that CAN move both: an anchor resolving to an
 * empty tree leaves the two enumerations agreeing on nothing.
 *
 * ⚠ THE WALK IS HOISTED SO BOTH CASES READ THE SAME ONE. A traversal written inside the new case
 * to produce the expected set would be a second walk, free to drift from the one under test —
 * which is this defect again, one level up.
 *
 * ⚠ IT PASSED ON ITS FIRST RUN, so every assertion in it has its own control and every verdict is
 * read from the FAILING TEST NAME rather than from the file's exit code
 * (`~/talyvor-queue/w11-blindwalk-guard-controls-9e73.py`, 7/7):
 *   P1 walk skips `areas/` → the SET comparison reds and it is the ONLY newly-failing case, so the
 *      catch is this block's and not the enumeration below noticing.
 *   P2 the glob pattern pointed at a directory that does not exist → the FLOOR *and* the SET red,
 *      so the floor is armed rather than decorative.
 *   P3 the walk widened to keep `.test.*` → the SET reds AS EXPECTED, and it also reds the
 *      enumeration below. ⚠ RECORDED RATHER THAN PREDICTED AWAY: `DECL` matches raw source text,
 *      and the A1 paragraph above QUOTES a declaration verbatim, so widening the walk makes this
 *      file report its own prose as a call site. The enumeration is kept off its own fixtures by
 *      the walk's test-file exclusion and by NOTHING ELSE — the same limit #183 recorded for
 *      `lib/awaiting.test.ts`, which is the sibling of this repair.
 *   P4 the duplicate-reader defect with the walk intact → the ORIGINAL case reds ALONE and the SET
 *      stays green, so the repair was ADDED to the enumeration rather than swapped in for it.
 *   P5 the A2 combination → CAUGHT. The flip is the finding.
 *   P6 BLINDING: this block skipped and the A2 defect restored → rc=0, NOT CAUGHT. Nothing else
 *      in the repo was watching.
 *   G1 a new production file that both instruments can see → STAYS GREEN. It is a set comparison,
 *      not a snapshot of a file list somebody would have to re-baseline.
 */
function sweep(): { root: string; files: string[] } {
  const root = resolve(__dirname)
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p)
    }
  }
  walk(root)
  return { root, files }
}

describe('the enumeration reads the whole tree', () => {
  // Keys only — the glob is lazy, so nothing here imports a module or runs a side effect. This
  // file sits at the walk's own anchor, so one pattern covers it.
  const globbed = Object.keys(import.meta.glob('./**/*.{ts,tsx}'))
    .filter((k) => !/\.test\.tsx?$/.test(k))
    .map((k) => resolve(import.meta.dirname, k))

  it('finds a substantial production tree, so an empty anchor cannot pass', () => {
    // Deliberately far below the 70 counted at db85e4d: this catches an anchor that resolves to
    // nothing, not a refactor that moves files. The set comparison below is what catches a skip.
    expect(globbed.length).toBeGreaterThan(40)
  })

  it('the walk and Vite’s glob agree on the file set, both directions', () => {
    // The REAL walk, the same call the case below makes.
    const { root, files } = sweep()
    const walked = new Set(files)
    const glob = new Set(globbed)
    const rel = (p: string) => p.slice(root.length + 1)
    expect(
      [...glob].filter((f) => !walked.has(f)).map(rel).sort(),
      'Vite sees production files this walk never read. A reader declaring the probe in any of ' +
        'them would restart an errored query with nothing red — which is the defect this file ' +
        'was written for.',
    ).toEqual([])
    expect(
      [...walked].filter((f) => !glob.has(f)).map(rel).sort(),
      'the walk read files Vite does not see. Either it is anchored outside apps/web/src, or the ' +
        'two disagree about what a production source file is.',
    ).toEqual([])
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
  it('has exactly one raw declaration of the probe — the gate that owns it', () => {
    const { root, files } = sweep()

    // ⚠ COUNTED PER CALL SITE, NOT PER FILE, and that is not a detail. The first version listed
    // the FILES that declare it and expected two names. Restoring main's shape puts a SECOND raw
    // declaration into AuthGate.tsx — a file already on the list — so the list did not move and
    // this case stayed green through the exact mutation it exists for. The dedupe key was the
    // unit of measurement, and the unit was wrong.
    const DECL = /queryKey:\s*\['auth-me'\],\s*queryFn:\s*api\.me/g
    const sites = files.flatMap((f) => {
      const n = (readFileSync(f, 'utf8').match(DECL) ?? []).length
      return Array.from({ length: n }, () => f.slice(root.length + 1))
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
