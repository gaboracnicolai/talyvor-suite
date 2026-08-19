import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Setup } from './areas/lens/Setup'

/**
 * A TIMER THAT OUTLIVES ITS COMPONENT REDS THE BUILD AT RANDOM, AND ONE ALREADY DID.
 *
 * `Setup.tsx`'s copy button set `copyState` to 'copied' and scheduled `setCopyState('idle')` 1500ms
 * later. Nothing cancelled it. In a browser that is a state update on an unmounted tree; under
 * vitest it is worse, because the file's jsdom environment is torn down as soon as its tests
 * finish and the callback then touches a `window` that no longer exists:
 *
 *     ReferenceError: window is not defined
 *       (in a Timeout callback, from the copy handler in the Setup screen)
 *     This error was caught after test environment was torn down.
 *
 * ⚠ THE LINE COORDINATES ARE DELIBERATELY NOT QUOTED. The real trace named a file and a line;
 * this repo's own pointerAudit reds on a `file.tsx:NN` written into a comment, and it was right
 * to — the fix below moves that line, so the citation would have been stale in the same commit
 * that wrote it.
 *
 * ⚠ IT DOES NOT FAIL A TEST — IT FAILS THE RUN. Vitest reported `1741 passed` and exited non-zero
 * on "Unhandled Errors". Every assertion in the suite was green and CI was red, which is why no
 * test could have caught it and why a per-test guard is the wrong shape.
 *
 * ⚠ AND IT IS A RACE, MEASURED AS ONE RATHER THAN ASSUMED: the SAME commit
 * (`b22e6f86cf34c7502e5018af09c18884935aa310`) ran red and then green on GitHub Actions with no
 * change in between. Whether the timer fires before or after its environment is torn down depends
 * on how long the worker process lives after the file finishes — which depends on the runner's
 * core count. It never reproduced locally across a full run, a sequential run, and a run pinned to
 * two workers. **A flake whose window is set by the machine is not a flake you can wait out.**
 *
 * ⚠ THE POPULATION IS TWO AND THE OTHER ONE IS ALREADY RIGHT, which is what makes this a defect
 * rather than a design question: `BillingReturn.tsx` schedules its timeout inside `useEffect` and
 * returns `() => clearTimeout(t)`. The correct shape was already in the codebase, one directory
 * away, when the wrong one was written.
 */

// The SAME fixture shape Setup.test.tsx drives, deliberately — a fake that is more generous than
// the one the screen's own tests use would put this case on a page the product never renders.
// The first draft invented a looser one, found no copy button at all, and "failed" for a reason
// that had nothing to do with timers: a red for the wrong reason is not a red.
const MINTED = {
  key: 'tlv_ws_TESTKEY_not_a_real_credential_00000000000000000000',
  prefix: 'tlv_ws_TESTKEY',
  name: 'Setup',
  scopes: ['proxy'],
}
const writeText = vi.fn(() => Promise.resolve())

function mockBff() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/api/context') {
      return json({
        workspace_id: 'u7kq2mfa',
        lens_base_url: 'http://127.0.0.1:8080',
        lens_public_base_url: 'https://lens.talyvor.com',
      })
    }
    if (url === '/api/keys' && method === 'POST') return json(MINTED, 201)
    if (url === '/api/keys') return json([])
    return json({})
  })
}

function renderSetup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { qc, ...render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Setup />
      </QueryClientProvider>
    </MemoryRouter>,
  ) }
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText } })
  writeText.mockClear()
  mockBff()
})
afterEach(() => vi.restoreAllMocks())

describe('no component leaves a timer running after it unmounts', () => {
  it('Setup: copying does not leave the 1500ms reset pending after unmount', async () => {
    const scheduled = new Set<unknown>()
    const realSet = window.setTimeout.bind(window)
    const realClear = window.clearTimeout.bind(window)
    // ⚠ SCOPED BY WHEN, NOT BY HOW LONG. The first draft tracked every timer of 1000ms or more and
    // caught FIVE — react-query's own cache-collection timers, which the QueryClient owns and
    // which unmounting a component is not supposed to clear. Filtering on the delay VALUE would
    // have meant keying the guard on 1500, the very constant under test. So tracking is opened
    // immediately before the click and closed as soon as it settles: what remains is what the
    // copy handler itself scheduled.
    let tracking = false
    vi.spyOn(window, 'setTimeout').mockImplementation(((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      // ⚠ A TIMER THAT HAS ALREADY FIRED IS NOT PENDING, and the first draft counted it as one:
      // React schedules two 0ms timers inside the click, both of which run long before unmount,
      // and both sat in this set forever because only `clearTimeout` removed anything. The
      // callback is wrapped so firing retires the id — otherwise the assertion below is about
      // "timers ever scheduled", which is not the property under test.
      const held: { id?: unknown } = {}
      const wrapped = () => {
        scheduled.delete(held.id)
        ;(fn as () => void)()
      }
      held.id = realSet(wrapped, ms, ...rest)
      if (tracking) scheduled.add(held.id)
      return held.id as ReturnType<typeof window.setTimeout>
    }) as unknown as typeof window.setTimeout)
    // The clear spy stays open through unmount — it is the cleanup itself that must be observed.
    vi.spyOn(window, 'clearTimeout').mockImplementation(((id?: number) => {
      scheduled.delete(id)
      return realClear(id)
    }) as unknown as typeof window.clearTimeout)

    const { unmount, qc } = renderSetup()
    // A key must exist before the page prints the two lines it offers to copy — the same order
    // Setup.test.tsx's own copy case drives.
    fireEvent.click(await screen.findByRole('button', { name: /create a key|mint/i }))
    const copy = await screen.findAllByRole('button', { name: /copy the two lines/i })

    tracking = true
    fireEvent.click(copy[0])
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^copied$/i }).length).toBeGreaterThan(0))
    tracking = false

    // The subject exists: if the copy handler scheduled nothing, the assertion below would pass by
    // having no subject, which is this repo's most-repeated failure.
    expect(
      scheduled.size,
      'the copy handler scheduled no timer at all, so this case has no subject and would pass for ' +
        'the wrong reason — the copy button or its clipboard fake has changed shape',
    ).toBeGreaterThan(0)

    unmount()
    // The QueryClient's own cache timers are NOT this component's to clear, and they are still
    // pending at unmount by design. Retiring them by name (rather than by delay, which would key
    // the guard on the very constant it tests) leaves exactly the timers the page itself owns.
    qc.clear()

    expect(
      Array.from(scheduled),
      'a timer scheduled by the copy button is still pending after unmount. In a browser it is a ' +
        'state update on a dead tree; under vitest it fires into a torn-down environment and reds ' +
        'the whole RUN while every test passes. Clear it in a useEffect cleanup, the way ' +
        'BillingReturn.tsx already does.',
    ).toEqual([])
  })

  it('BillingReturn is the CONTROL: the correct shape already in this codebase', () => {
    const src = readFileSync(join(SRC, 'areas/lens/BillingReturn.tsx'), 'utf8')
    expect(src).toContain('const t = setTimeout(')
    expect(
      src,
      'BillingReturn is cited by the case above as the model. If it stops clearing its timer, the ' +
        'model is gone and the citation is a claim about a file that no longer says it.',
    ).toContain('return () => clearTimeout(t)')
  })

  it('stripComments keeps the scanner from accusing prose — both directions', () => {
    // The real false positive this scanner produced on its first run, verbatim.
    const prose = '// Yielding once per step (`await new Promise(r => setTimeout(r, 0))`) makes it six.'
    expect(stripComments(prose)).not.toContain('setTimeout(')
    expect(stripComments('/* setTimeout(fn, 1) */')).not.toContain('setTimeout(')
    // And it must NOT eat the calls it exists to find, or the sweep goes silently clean.
    expect(stripComments('const t = setTimeout(fn, 1500)')).toContain('setTimeout(')
    expect(stripComments("const u = 'https://x.example/a' // note\nsetInterval(f, 1)")).toContain('setInterval(')
  })

  it('cleanupRE recognises a RETURNED cleanup and refuses an in-handler clear', () => {
    // Both shapes that exist in this codebase must match...
    expect('    return () => clearTimeout(t)').toMatch(cleanupRE)
    expect('  useEffect(() => () => window.clearTimeout(resetTimer.current), [])').toMatch(cleanupRE)
    // ...and the one that is NOT an unmount cleanup must not. This exact line sits in both
    // repaired components; accepting it is how the earlier version of this scan went inert.
    expect('                window.clearTimeout(resetTimer.current)').not.toMatch(cleanupRE)
    expect('const t = setTimeout(fn, 1500)').not.toMatch(cleanupRE)
  })

  it('every timer in the web sources is cleared in the file that schedules it', () => {
    // ⚠ THE BOUNDARY IS THE FINDING. The first version of this walk covered apps/web/src ALONE and
    // reported a clean codebase after Setup.tsx was fixed. `RevealOnce.tsx` — the component
    // Setup.tsx's own comment names as the model for its copy control — carried the IDENTICAL
    // uncancelled timer, in packages/ui, one directory outside the walk. It was found by the
    // behavioural case measuring a timer this scan said did not exist, not by reading. A census
    // whose population boundary excludes half the sources reports "clean" in the same words as a
    // clean codebase.
    const files = [...walk(SRC), ...walk(UI_SRC)].filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    expect(
      files.length,
      'the source walk found (almost) no files — it is not running where it thinks it is, and ' +
        'every finding below would be an absence rather than a clean result',
    ).toBeGreaterThan(50)
    expect(
      files.some((f) => f.includes('packages/ui')),
      'the walk reached no packages/ui file. That is exactly the hole this case was widened to ' +
        'close, and it would close it back silently',
    ).toBe(true)

    const schedulers: string[] = []
    const leaking: string[] = []
    for (const f of files) {
      // COMMENTS ARE NOT CALLS, and the first draft of this scanner did not know that: it
      // reported `caseAudit.ts` as a leaking timer site on the strength of the prose
      // "`await new Promise(r => setTimeout(r, 0))`" inside a `//` comment. A guard that names an
      // innocent file is spent the same way as one that misses a guilty one — the reader stops
      // believing it. `stripComments` is positive-controlled by its own case below.
      const src = stripComments(readFileSync(f, 'utf8'))
      const sets = src.match(/(?<![A-Za-z.])(?:window\.)?set(?:Timeout|Interval)\(/g) ?? []
      if (sets.length === 0) continue
      const rel = f.replace(REPO_ROOT + '/', '')
      // ⚠ "THE FILE CONTAINS A clearTimeout" IS NOT THE PROPERTY, AND THIS GUARD SHIPPED THAT
      // WEAKER TEST FIRST. Both repaired components clear the previous timer INSIDE the click
      // handler before scheduling a new one, so a file-wide `clears.length === 0` test went green
      // the moment the fix landed and could never red again for the thing it exists to catch:
      // C1 and C2 in w1115b-timer-controls.py both passed while the unmount cleanup was deleted.
      // The property is a cleanup RETURNED to React, which is what `cleanupRE` matches.
      const cleanups = src.match(cleanupRE) ?? []
      schedulers.push(`${rel} (${sets.length} scheduled, ${cleanups.length} cleared on unmount)`)
      if (cleanups.length === 0) leaking.push(rel)
    }

    // THE FLOOR. Two files schedule a timer today. Fewer means the matcher stopped matching, and a
    // scanner that reads nothing reports a clean codebase in exactly the same words as a clean one.
    expect(
      schedulers.length,
      'expected at least the THREE known timer sites (Setup.tsx, BillingReturn.tsx and ' +
        `RevealOnce.tsx in packages/ui); found ${schedulers.length}: ${schedulers.join(', ')}`,
    ).toBeGreaterThan(2)

    expect(
      leaking,
      'these files schedule a timer and never clear one. A timer that outlives its component reds ' +
        'the build at random — see this file\'s header for the run that proved it.\n  ' +
        schedulers.join('\n  '),
    ).toEqual([])
  })
})

const SRC = join(process.cwd(), 'src')
// process.cwd() is apps/web when vitest runs; the sibling package is two levels up.
const REPO_ROOT = join(process.cwd(), '..', '..')
const UI_SRC = join(REPO_ROOT, 'packages', 'ui', 'src')

/**
 * Block and line comments removed, so prose about a timer is not counted as one. `//` is only
 * treated as a comment when it is not part of a scheme (`https://`) — a narrow rule, and the case
 * below is what keeps it honest rather than plausible.
 */
/**
 * A cleanup RETURNED to React — `return () => clearTimeout(t)`, or the `useEffect(() => () => …)`
 * double-arrow form. Deliberately NOT "the file mentions clearTimeout": see the case above.
 */
const cleanupRE = /(?:return|=>)\s*\(\s*\)\s*=>[^\n]*clear(?:Timeout|Interval)\(/

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
