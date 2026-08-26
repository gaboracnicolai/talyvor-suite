import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConvertLens } from './ConvertLens'
import { SessionExpiredBar } from '../../components/SessionExpiredBar'
import { isSessionExpired } from '../../lib/productState'
import { convertApi } from './convertApi'
import { queryClient } from '../../App'

/**
 * THE CONVERT PANEL TOLD A PERSON TO RETRY A REQUEST THAT IS REFUSED FOREVER.
 *
 * `classify()` in convertApi.ts routes 402→insufficient, 400→too_small, 404/503→unavailable and
 * EVERYTHING ELSE — 401 included — into `upstream`, whose sentence ends "Please try again."
 * MEASURED on the rendered panel at `3ba7a63`, workspace token refused upstream: the panel read
 *
 *     "Couldn’t convert — nothing was converted. Please try again."
 *
 * A 401 is a verdict, not a flake. The same request will be refused until the person signs in
 * again, so "Please try again" is not merely unhelpful — it is false, and it is false on the one
 * screen that spends money. IssueList.tsx makes exactly this argument for its own 4xx refusal
 * ("the same request will be refused forever, so 'Try again' is not merely unhelpful, it is
 * false") and the sibling money path already solved it: `CheckoutError` carries a `signed_out`
 * kind reading "Your session has expired. Sign in again, then choose an amount — nothing was
 * charged." Conversion had no such kind.
 *
 * ⚠ AND THE HAND-ROLLED TYPE TURNED THREE SHARED MECHANISMS OFF WITHOUT TOUCHING ONE OF THEM.
 * `ConvertError extends Error`, and every session-expiry mechanism in this app keys on
 * `instanceof ApiError`:
 *
 *   MEASURED at `3ba7a63`, on a ConvertError built from a 401:
 *     isSessionExpired(e)                          false   → the app-wide bar stays hidden
 *     e instanceof ApiError                        false   → QueryCache.onError never re-probes
 *     App.tsx retry(0, e)                          TRUE    → the app RETRIES a 401
 *     ...for the same 401 as an ApiError, retry()  false
 *
 * IssueList.tsx:282 wrote that hazard down in this repo, at its third site: "a hand-rolled error
 * type turns the shared predicate off without one line of the predicate changing — #136 for a
 * read, #140 for the create four lines above, and this was the third site." The convert quote is
 * the fourth, and it is a READ IN THE QUERY CACHE — which is the store `useSessionExpired`
 * subscribes to, so it is the one that could have raised the bar and did not.
 *
 * ⚠ WHY THE QUOTE AND THE CONVERT GET DIFFERENT ANSWERS, from this repo's own rule. The bar
 * "can see that all of them failed for the same reason" and a panel "knows only that its own
 * request failed". The QUOTE is a useQuery — it lands in the cache the bar reads, so the bar
 * speaks and the panel must fall silent rather than add a second, differently-worded diagnosis
 * (TrackArea.tsx states that rule; SessionExpiredBar.tsx records failing it once already). The
 * CONVERT is a useMutation — `cache.getAll()` never sees it, so no bar can ever appear for it
 * and the panel is the only thing in a position to speak. Two different answers, one rule.
 *
 * ⚠ THE 401 BRANCH MUST NOT BECOME A CATCH-ALL. "A change that makes 401 honest by routing 500
 * to the same message has not fixed anything, it has just moved which failures are misdescribed"
 * — SessionExpired.test.tsx's own words. Group D holds the other four kinds still, and asserts
 * that a 500 KEEPS "Please try again", because on a genuine fault retrying is true advice.
 */

const quote = {
  lens_per_lxc: 2,
  usd_per_lxc: 0.1,
  min_lxc_ulxc: 100_000,
  reversible: false,
  reversible_note: 'LENS converts to LXC and not back — there is no LXC→LENS conversion in Lens.',
}

/** `quoteStatus` refuses the READ; `convertStatus` refuses the WRITE. Counted, so a retry shows. */
let quoteFetches = 0
function mockBff(opts: { quoteStatus?: number; convertStatus?: number; errorBody?: string } = {}) {
  const said = opts.errorBody ?? 'workspace token rejected'
  quoteFetches = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/lens/convert-quote') {
      quoteFetches += 1
      const status = opts.quoteStatus ?? 200
      return new Response(JSON.stringify(status === 200 ? quote : { error: said }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/lens/convert') {
      const status = opts.convertStatus ?? 200
      if (status !== 200) {
        return new Response(JSON.stringify({ error: said }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          lxc_minted_ulxc: 1_000_000,
          lens_spent_ulens: 2_000_000,
          rate: 2,
          new_lxc_balance_ulxc: 5_000_000,
          new_lens_balance_ulens: 8_000_000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response('null', { status: 404 })
  })
}

/** A local client for the panel-level cases: no retry, so a case measures ONE answer. */
function local() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

/**
 * Open the panel, enter an amount, press Convert, and wait for THAT CASE'S sentence.
 *
 * ⚠ `settled` is a parameter and not a shared pattern on purpose. It was `/nothing was
 * converted|expired/` for every case, which is a sentence only some branches produce — the 400
 * case renders the BFF's own words and timed out for one second before failing on a wait, not on
 * the property. A helper that waits for the wrong thing turns a real assertion into a timeout.
 */
async function convertOnce(settled: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: /Convert to LXC/i }))
  await screen.findByText(/Rate:/i)
  fireEvent.change(document.body.querySelector('input') as HTMLInputElement, { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: /^Convert$/ }))
  await waitFor(() => expect(document.body.textContent).toMatch(settled))
}

beforeEach(() => {
  queryClient.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('A. a refused conversion never advises a retry that cannot work', () => {
  it('does not say "try again" when the workspace token is dead', async () => {
    mockBff({ convertStatus: 401 })
    render(
      <QueryClientProvider client={local()}>
        <ConvertLens lensBalanceMicros={10_000_000} />
      </QueryClientProvider>,
    )
    await convertOnce(/nothing was converted|expired/i)
    expect(
      document.body.textContent,
      'a 401 is refused until the person signs in again; "try again" is false advice on a money screen',
    ).not.toMatch(/try again/i)
  })

  it('names the cause and the fix, and still says nothing was converted', async () => {
    mockBff({ convertStatus: 401 })
    render(
      <QueryClientProvider client={local()}>
        <ConvertLens lensBalanceMicros={10_000_000} />
      </QueryClientProvider>,
    )
    await convertOnce(/nothing was converted|expired/i)
    const text = document.body.textContent ?? ''
    expect(text, 'the panel is the ONLY thing that can speak for a mutation — no bar can see it').toMatch(
      /session has expired/i,
    )
    expect(text, 'the remedy, in the same words the top-up path already uses').toMatch(/sign in again/i)
    expect(text, 'an irreversible spend must always state that it did not happen').toMatch(
      /nothing was converted/i,
    )
  })
})

describe('B. a refused READ reaches the one bar that speaks for all of them', () => {
  it('raises the app-wide session bar when the convert quote is refused', async () => {
    mockBff({ quoteStatus: 401 })
    const qc = local()
    render(
      <QueryClientProvider client={qc}>
        <SessionExpiredBar />
        <ConvertLens lensBalanceMicros={10_000_000} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Convert to LXC/i }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    expect(
      screen.getByRole('alert').textContent,
      'useSessionExpired scans the query cache for isSessionExpired — a hand-rolled error type is invisible to it',
    ).toMatch(/session has expired/i)
  })

  it('and the panel does not repeat the diagnosis the bar just gave', async () => {
    mockBff({ quoteStatus: 401 })
    render(
      <QueryClientProvider client={local()}>
        <SessionExpiredBar />
        <ConvertLens lensBalanceMicros={10_000_000} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Convert to LXC/i }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    const panel = document.body.textContent?.replace(screen.getByRole('alert').textContent ?? '', '') ?? ''
    expect(panel, 'one dead session is one message — the panel below the bar must not be the second').not.toMatch(
      /session has expired/i,
    )
  })
})

/**
 * ⚠ THE FIRST VERSION OF THIS GROUP PASSED BEFORE THE FIX AND WAS MEASURING NOTHING. It waited
 * 250ms and asserted `quoteFetches === 1`. React Query's first retry delay is ~1000ms, so the
 * retry had simply not happened yet — a guard that would have read green against a product that
 * retries a 401 forever. The 502 case is the companion that makes the budget honest: both wait
 * past the same delay, one must still be 1 and the other must have reached 2. A retry budget
 * asserted with a stopwatch shorter than the retry is not an assertion.
 */
const PAST_FIRST_RETRY_MS = 1600

async function quoteFetchesAfterFirstRetryWindow(status: number) {
  mockBff({ quoteStatus: status })
  render(
    <QueryClientProvider client={queryClient}>
      <ConvertLens lensBalanceMicros={10_000_000} />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Convert to LXC/i }))
  await waitFor(() => expect(quoteFetches).toBeGreaterThan(0))
  await new Promise((r) => setTimeout(r, PAST_FIRST_RETRY_MS))
  return quoteFetches
}

describe('C. a 401 is a verdict, so the app stops asking', () => {
  it('does not retry the refused quote under the real app query client', async () => {
    expect(
      await quoteFetchesAfterFirstRetryWindow(401),
      'App.tsx retries once unless `error instanceof ApiError && status === 401`; a hand-rolled type spends a second refused request',
    ).toBe(1)
  })

  it('but a 502 IS a flake, and the app still retries that — the same clock, the other answer', async () => {
    expect(
      await quoteFetchesAfterFirstRetryWindow(502),
      'if this is 1 the window is too short and the 401 case above is measuring the stopwatch, not the product',
    ).toBe(2)
  })
})

describe('D. three states stay three — the 401 branch is not a catch-all', () => {
  const cases: { status: number; body?: string; expect: RegExp; why: string }[] = [
    { status: 402, expect: /Not enough LENS/i, why: 'insufficient balance is its own answer' },
    {
      status: 400,
      body: 'That amount is below the minimum conversion.',
      expect: /below the minimum conversion/i,
      why: 'a refused amount is not a dead session, and the BFF’s own words survive',
    },
    { status: 503, expect: /isn’t available on this deployment/i, why: 'off is the calm state, not a fault' },
    { status: 500, expect: /try again/i, why: 'on a GENUINE fault, retrying is true advice and must survive' },
  ]
  for (const c of cases) {
    it(`${c.status} keeps its own words — ${c.why}`, async () => {
      mockBff({ convertStatus: c.status, errorBody: c.body })
      render(
        <QueryClientProvider client={local()}>
          <ConvertLens lensBalanceMicros={10_000_000} />
        </QueryClientProvider>,
      )
      await convertOnce(c.expect)
      expect(document.body.textContent).toMatch(c.expect)
      expect(
        document.body.textContent,
        'the 401 wording must not spread to the other four kinds',
      ).not.toMatch(/session has expired/i)
    })
  }

  it('and only the 401 read is classified as an expired session', async () => {
    for (const [status, want] of [
      [401, true],
      [402, false],
      [503, false],
      [500, false],
    ] as const) {
      let err: unknown = null
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response(JSON.stringify({ error: 'x' }), { status }),
      )
      await convertApi.quote().catch((e: unknown) => {
        err = e
      })
      expect(isSessionExpired(err), `status ${status}`).toBe(want)
      vi.restoreAllMocks()
    }
  })
})
