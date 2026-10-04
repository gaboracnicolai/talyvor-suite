import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App, CONSOLE_ROUTES, queryClient } from './App'
import { ScreenBoundary } from './components/ScreenBoundary'

/**
 * B27.12 — with Lens answering `{}` for every read, no screen throws and each says its read failed.
 *
 * Measured before the change, driving these same addresses: `/`, `/keys`, `/agents`, `/spend`,
 * `/members`, `/features`, `/track` and `/docs` threw while drawing ("rows.filter is not a
 * function", "keys.map is not a function", …) and React unmounted the whole app, sidebar and all;
 * `/earnings`, `/chat`, `/plans` and `/operator` read the empty object as "switched off", "empty" or
 * "not on sale"; `/billing` printed NaN.
 */

// Every screen's own failure wording: PanelFailure/InlineFailure ("Couldn’t load …"), and the
// screens that phrase it themselves ("could not be read just now", "We couldn’t read your balance").
const READ_FAILED = /Couldn’t (load|check|reach|read)|couldn’t read|could not be read/

// Asked on every address by the shell itself (the session and the sidebar's pins), so a screen that
// asks for nothing else reads nothing of its own and has no read to fail.
const SHELL_READS = new Set(['/auth/me', '/api/docs/pins'])

const addressOf = (routePath: string) => routePath.replace(/\/\*$/, '') || '/'

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  queryClient.clear()
})

async function underEmptyLens(address: string) {
  const thrown: string[] = []
  const onError = (e: ErrorEvent) => {
    thrown.push(String(e.error?.message ?? e.message))
    e.preventDefault()
  }
  window.addEventListener('error', onError)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const reads = new Set<string>()
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
    const path = String(input).split('?')[0]
    reads.add(path)
    // The BFF's own session answer, not a Lens read: it decides whether there is an app at all.
    const body = path === '/auth/me' ? { mode: 'disabled', authenticated: false, user: null } : {}
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as never)
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
  const own = () => [...reads].filter((r) => !SHELL_READS.has(r))
  const main = () => document.querySelector('main')?.textContent ?? ''
  // A screen that reads something must come to say the read failed; one that reads nothing settles.
  // A timeout is not thrown from here: the caller reports that screen as silent, not as a crash.
  await waitFor(() => expect(own().length === 0 || READ_FAILED.test(main())).toBe(true), { timeout: 2000 }).catch(
    () => {},
  )
  // and the reads still in flight when the first failure appeared get to land, and throw if they do.
  await new Promise((r) => setTimeout(r, 100))
  window.removeEventListener('error', onError)
  return { thrown, own: own(), main: main() }
}

describe('B27.12 — every screen says the read failed instead of crashing', () => {
  it('with Lens answering {} on every read, no screen throws and each shows its read-failed state', async () => {
    const crashed: string[] = []
    const silent: string[] = []
    let reading = 0
    for (const r of CONSOLE_ROUTES) {
      const addr = addressOf(r.path)
      const got = await underEmptyLens(addr)
      if (got.thrown.length || screen.queryByText('This screen couldn’t be read.')) {
        crashed.push(`${addr}: ${got.thrown[0] ?? 'caught by the screen boundary'}`)
      }
      if (got.own.length) {
        reading++
        if (!READ_FAILED.test(got.main)) silent.push(`${addr} (reads ${got.own.join(', ')})`)
      }
      vi.restoreAllMocks()
      cleanup()
      queryClient.clear()
    }
    expect(crashed, `threw while drawing:\n  ${crashed.join('\n  ')}`).toEqual([])
    expect(silent, `read {} and did not say the read failed:\n  ${silent.join('\n  ')}`).toEqual([])
    // FLOOR: the sweep reached the screens that read Lens, not only the ones that read nothing.
    expect(reading).toBeGreaterThanOrEqual(15)
  }, 60_000)

  it('a screen that throws anyway says it could not be read, and Try again draws it again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = (e: ErrorEvent) => e.preventDefault()
    window.addEventListener('error', onError)
    let broken = true
    const Screen = () => {
      if (broken) throw new TypeError('rows.filter is not a function')
      return <p>Drawn.</p>
    }
    const retried = vi.fn(() => {
      broken = false
    })
    render(
      <ScreenBoundary address="/spend" onRetry={retried}>
        <Screen />
      </ScreenBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/This screen couldn’t be read\./)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retried).toHaveBeenCalledOnce()
    expect(screen.getByText('Drawn.')).toBeTruthy()
    window.removeEventListener('error', onError)
  })
})
