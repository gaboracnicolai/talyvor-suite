import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App, CONSOLE_ROUTES, queryClient } from './App'
import { answeredUrls, bodyFor, populatedBff, type PopulatedResult } from './populatedBff'

/**
 * populatedBffCoverage — THE POSITIVE CONTROL W1.1.17b REQUIRES, and the thing that stops the
 * fixture going stale one screen at a time.
 *
 * A shared populated fixture is only worth having if something fails when it stops being populated.
 * Two ways it can rot, and both are checked here:
 *
 *   1. A NEW ENDPOINT. A screen starts fetching something the fixture does not answer, that request
 *      404s, and the screen quietly renders its failure state again — putting the sweeps that
 *      import this fixture back to measuring failure screens, with nothing saying so.
 *   2. A CHANGED SHAPE. The fixture still answers, with a body the screen can no longer read.
 *
 * (1) is caught by comparing what was ASKED against what is ANSWERED. (2) is caught by reading the
 * rendered result: no address may show a failure state under this fixture.
 *
 * ⚠ THE FAILURE-STATE STRINGS ARE THE PRODUCT'S OWN, not invented here — `PanelFailure` renders
 * "Couldn’t load …" or "Unavailable.", `InlineFailure` renders "Couldn’t load"/"Couldn’t check".
 * They carry a CURLY apostrophe, which is the kind of detail that makes a string matcher silently
 * match nothing, so FAULT_CONTROL below proves the matcher can actually find one.
 */

const FAULT = /Couldn’t (load|check|reach)|^Unavailable\.$/

const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '') || '/'

async function at(address: string): Promise<PopulatedResult> {
  const rec = populatedBff((impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
  })
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
  // let the mounted queries settle — a screen that has not answered yet is still "Loading…", and a
  // census taken there is a census of a spinner.
  await new Promise((r) => setTimeout(r, 80))
  return rec
}

// ⚠ THE SHARED QUERY CACHE IS THE TRAP IN A MULTI-ADDRESS SWEEP, AND IT COST ME BOTH CONTROLS
// BEFORE I SAW IT. App.tsx exports ONE `queryClient`, so a second render in the same file serves
// the FIRST render's data: my FAULT control suppressed /api/track/issues and saw no failure at all
// because the successful response from an earlier test was still cached, and the FLOOR control
// measured the populated and 404 fixtures as identical for the same reason. A per-address sweep
// that forgets this is not measuring twelve screens, it is measuring the first one twelve times.
afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  queryClient.clear()
})

describe('the populated fixture answers what the console actually asks for', () => {
  it('every request every address makes has a body — nothing falls through to 404', async () => {
    const missing = new Map<string, string[]>()
    for (const r of CONSOLE_ROUTES) {
      const addr = addressOf(r.path)
      const rec = await at(addr)
      if (rec.unanswered.length) missing.set(addr, [...new Set(rec.unanswered)])
      vi.restoreAllMocks()
      cleanup()
      queryClient.clear()
    }
    const lines = [...missing].map(([a, u]) => `  ${a}: ${u.join(', ')}`)
    expect(
      lines,
      'these requests fell through to 404, so those screens rendered their failure state and any ' +
        'census taken under this fixture is measuring that:\n' + lines.join('\n'),
    ).toEqual([])
  })

  it('no address renders a failure state under it', async () => {
    const faulted: string[] = []
    for (const r of CONSOLE_ROUTES) {
      const addr = addressOf(r.path)
      await at(addr)
      const main = document.querySelector('main')
      if (main && within(main as HTMLElement).queryAllByText(FAULT).length > 0) {
        faulted.push(`${addr}: ${within(main as HTMLElement).queryAllByText(FAULT).map((e) => e.textContent).join(' / ')}`)
      }
      vi.restoreAllMocks()
      cleanup()
      queryClient.clear()
    }
    expect(
      faulted,
      'address(es) still showing a failure state under the populated fixture:\n  ' + faulted.join('\n  '),
    ).toEqual([])
  })

  // ⚠ THE CONTROL ON THE CONTROL, AND ITS FIRST VERSION WAS WRONG IN A WAY WORTH KEEPING.
  //
  // It drove the OLD 404-everything fixture and expected the FAULT matcher to find failure states,
  // on the reasoning that a sweep over 404s is "measuring twelve failure screens". MEASURED: it
  // finds NONE. Under 404 the screens render their EMPTY and NOT-CONFIGURED states, not their
  // failure states — `isUnconfigured` and the empty branches absorb it — so the old fixture was
  // measuring twelve EMPTY screens, which is a different thing with the same consequence for a
  // census. W1.1.17b's wording ("twelve failure screens") is slightly stronger than what the code
  // does, and the distinction matters here because it decides what a control can assert.
  //
  // So the matcher is proven against a configuration that genuinely faults: the populated fixture
  // with ONE endpoint suppressed.
  it('FAULT-CONTROL: the matcher finds a failure state when one endpoint is suppressed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
      const url = String(input)
      if (url.startsWith('/api/track/issues')) return new Response('null', { status: 500 })
      const body = bodyFor(url)
      if (body === undefined) return new Response('null', { status: 404 })
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as never)
    window.history.pushState({}, '', '/track')
    render(<App />)
    await screen.findByRole('navigation', { name: /sections/i })
    await new Promise((r) => setTimeout(r, 80))
    const main = document.querySelector('main') as HTMLElement
    expect(
      within(main).queryAllByText(FAULT).length,
      'suppressing /api/track/issues produced no failure state the matcher can see — the matcher ' +
        'cannot fail, so "no address renders a failure state" above proves nothing',
    ).toBeGreaterThan(0)
  })

  // ⚠ AND THE ONE THAT SHOWS THE FIXTURE IS DOING ITS JOB AT ALL. A fixture that answered 200 with
  // bodies no screen could read would satisfy both assertions above — nothing 404s, nothing faults
  // — while every screen still rendered its empty state. This compares what is actually on the
  // page: the populated run must put MORE text in <main> than the 404 run.
  it('FLOOR-CONTROL: the populated fixture renders more than the 404 fixture did', async () => {
    const textAt = async (addr: string, populated: boolean) => {
      if (populated) {
        populatedBff((impl) => {
          vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
        })
      } else {
        vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
          if (String(input) === '/auth/me') {
            return new Response(JSON.stringify({ mode: 'disabled', authenticated: false, user: null }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          return new Response('null', { status: 404 })
        }) as never)
      }
      window.history.pushState({}, '', addr)
      render(<App />)
      await screen.findByRole('navigation', { name: /sections/i })
      await new Promise((r) => setTimeout(r, 80))
      const n = (document.querySelector('main')?.textContent ?? '').length
      vi.restoreAllMocks()
      cleanup()
      queryClient.clear()
      return n
    }

    let richer = 0
    const sampled = ['/', '/ledger', '/keys', '/members', '/docs']
    for (const addr of sampled) {
      const populated = await textAt(addr, true)
      const empty = await textAt(addr, false)
      if (populated > empty) richer++
    }
    expect(
      richer,
      `the populated fixture rendered more than the 404 fixture on only ${richer} of ${sampled.length} ` +
        'sampled addresses — if it is not putting content on the page, every census that imports it ' +
        'is still reading a floor',
    ).toBeGreaterThanOrEqual(4)
  })

  it('the fixture answers something at all', () => {
    // FLOOR: an empty fixture would pass the coverage test only if nothing was ever asked, and
    // would pass the fault test by rendering nothing at all.
    expect(answeredUrls().length).toBeGreaterThan(5)
  })
})
