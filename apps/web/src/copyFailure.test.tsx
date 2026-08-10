import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Keys } from './areas/lens/Keys'
import { Setup } from './areas/lens/Setup'

/**
 * copyFailure.test.tsx — EVERY COPY BUTTON IN THE PRODUCT REPORTS SUCCESS AND ONLY SUCCESS.
 * WHEN THE COPY DOES NOT HAPPEN, NOTHING SAYS SO — AND ON THE ONE-TIME KEY CARD THE NEXT
 * CONTROL DESTROYS THE ONLY COPY OF THE CREDENTIAL.
 *
 * ── WHAT WAS MEASURED, IN REAL CHROME, ON THE SHIPPED ARTIFACT ───────────────────────
 *
 * `apps/web/dist` at `91d14d8` (bundle `index-cwxATUTy.js`, read out of the page's own
 * `<script src>`), served over plain HTTP from two origins by the same server, driven with
 * Playwright. The only difference between the two rows is the ORIGIN:
 *
 *     http://127.0.0.1:8791    isSecureContext true    navigator.clipboard  object
 *     http://192.168.100.149:8791  isSecureContext false    navigator.clipboard  undefined
 *
 * `navigator.clipboard` is exposed ONLY in a secure context. The loopback row is the positive
 * control: it proves the instrument can see a clipboard when the browser has one, so the
 * `undefined` in the second row is a fact about the origin and not about headless Chrome.
 *
 * On the NON-SECURE origin, with the real screens driven to their real states:
 *
 *     /keys   mint a key → "Copy key" clicked   label stays "Copy key", live region empty,
 *                                               Uncaught TypeError: Cannot read properties
 *                                               of undefined (reading 'writeText')
 *     /setup  5 copy buttons clicked in turn    every label unchanged, NO error raised at all
 *
 * ⚠ THE TWO CALL SITES FAIL DIFFERENTLY, AND THE ONE THAT LOOKS GUARDED IS NOT SAFER.
 * `Setup.tsx` writes `navigator.clipboard?.writeText(text).then(…)`. Optional chaining
 * short-circuits the WHOLE chain, so when `clipboard` is undefined the `.then` is never
 * evaluated and nothing throws — the button is simply inert, five times, in silence. That `?.`
 * is the only place in the repo where anyone anticipated an absent clipboard, and what it buys
 * is a quieter failure, not a handled one. `RevealOnce.tsx` has no `?.` and throws instead.
 * Neither tells the reader anything.
 *
 * ── AND IT IS NOT CONFINED TO A NON-SECURE ORIGIN ────────────────────────────────────
 *
 * On the SECURE loopback origin, same artifact, `writeText` replaced with one that rejects
 * `NotAllowedError: Document is not focused.` — which is what Chrome itself raises on https
 * when the tab is not focused, and what a denied `clipboard-write` permission raises:
 *
 *     baseline, real clipboard      "Copy the two lines" → "Copied"      (positive control)
 *     writeText rejects             "Copy the two lines" → "Copy the two lines"
 *                                   unhandledrejection: NotAllowedError
 *
 * So the silent path is reachable on the product's own supported https posture. Neither call
 * site has a `.catch`; the failure's whole itinerary is `window.onerror`.
 *
 * ── WHY THIS IS A DEFECT AND NOT A PREFERENCE ────────────────────────────────────────
 *
 * `RevealOnce`'s own doc-comment states its safety property: "The SECRET is the only body-size
 * string on the card and owns the only primary action — Copy — which copies the secret and
 * nothing else", and the card prints "Store it now — it will not be shown again." next to that
 * button. `Keys.tsx` adds: "On dismissal it leaves the DOM and the mutation cache; there is no
 * way back." The card therefore stakes an irreversible act on a control that, when it fails,
 * is indistinguishable from one that worked-and-you-missed-it — and the control immediately
 * below it is "Done — I stored it".
 *
 * ── WHAT THIS FILE ASSERTS, AND WHY IT IS NOT A `.catch` CHECK ───────────────────────
 *
 * ⚠ ASSERTING THAT A `.catch` EXISTS WOULD PASS FOR A `.catch` THAT SWALLOWS. What is asserted
 * is what the READER gets: after a copy that did not happen, the screen must say so, in text a
 * person can read. Each screen is driven in THREE clipboard environments — absent, rejecting,
 * and working — and the WORKING one is a positive control inside the sweep: a component that
 * always claimed failure would pass the first two cases and fail the third.
 *
 * ⚠ AND EVERY COUNT CARRIES A FLOOR. "no copy button lied" is also what a screen that rendered
 * no copy buttons reports. Every case asserts the button count first, so a screen that failed
 * to load reds the premise instead of reporting a clean sweep.
 *
 * ── TWO THINGS THE CONTROLS FOUND THAT READING THIS FILE WOULD NOT ───────────────────
 *
 * `apps/web/scripts/w11-copy-failure-controls.py`, 9/9 caught by the case named before the run,
 * every one with a must-stay-green companion. Two of them rewrote this file:
 *
 *   · C2 — reverting `CopyBlock` to EXACTLY the code that shipped reddened NOTHING. `/setup`
 *     renders `RevealOnce` as well as five `CopyBlock`s, and the first version of these cases
 *     asked "does the page say it": RevealOnce's one notice was answering for all six buttons,
 *     so the entire CopyBlock half was unmeasured while scoring green. Every assertion here is
 *     now a COUNT — N buttons that failed must produce N notices — and C2 catches.
 *   · A case asserting no rejection escapes to `window.onunhandledrejection` PASSED under every
 *     control, including the ones that restore the leak. jsdom does not deliver Node's rejection
 *     tracking to the window, so that listener is never called; measured with a bare
 *     `Promise.reject(…).then(…)`, which produced ZERO events. The case is gone rather than
 *     kept as decoration — see where it stood, below. The escape is real and is recorded from
 *     Chrome in the header above, which is the instrument that can see it.
 */

const MINTED = {
  key: 'tlv_ws_TESTKEY_not_a_real_credential_00000000000000000000',
  prefix: 'tlv_ws_7c0ffee0',
  name: 'Laptop',
  scopes: ['proxy'],
}

/** The three states `navigator.clipboard` is actually in, in a browser. */
type Env = 'absent' | 'rejecting' | 'working'

/**
 * ⚠ `absent` DELETES THE PROPERTY rather than setting it to undefined, because that is what a
 * non-secure context is: the API is not installed on `navigator` at all. Measured in Chrome at
 * `http://192.168.100.149:8791` — `typeof navigator.clipboard === 'undefined'`.
 */
function clipboardEnv(env: Env): { writeText: ReturnType<typeof vi.fn> | null } {
  if (env === 'absent') {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard')
    return { writeText: null }
  }
  const writeText = vi.fn(() =>
    env === 'working'
      ? Promise.resolve()
      : Promise.reject(new DOMException('Document is not focused.', 'NotAllowedError')),
  )
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return { writeText }
}

function mockBff({ minted = false }: { minted?: boolean } = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me')
      return json({ mode: 'disabled', authenticated: false, user: null, cache_poolable: true })
    if (url === '/api/context')
      return json({
        workspace_id: 'u7kq2mfa',
        lens_base_url: 'http://127.0.0.1:8080',
        lens_public_base_url: 'https://lens.talyvor.com',
      })
    if (url === '/api/keys' && method === 'POST') return json(MINTED, 201)
    if (url === '/api/keys')
      return json(
        minted
          ? [
              {
                id: 'key_new',
                workspace_id: 'default',
                key_prefix: MINTED.prefix,
                name: MINTED.name,
                scopes: MINTED.scopes,
                created_at: '2026-07-23T00:00:00Z',
              },
            ]
          : [],
      )
    return json({})
  })
}

function renderScreen(which: 'keys' | 'setup') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{which === 'keys' ? <Keys /> : <Setup />}</QueryClientProvider>
    </MemoryRouter>,
  )
}

/** Every control whose whole job is to put something on the clipboard. */
function copyButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button')).filter((b) =>
    /^Cop(y|ied)\b/.test((b.textContent ?? '').trim()),
  )
}

/**
 * The failure said to a SIGHTED reader.
 *
 * ⚠ `sr-only` IS EXCLUDED AND THAT EXCLUSION IS THE POINT. `getByText` finds screen-reader-only
 * text exactly as readily as painted text, so a guard that only counted matches would be
 * satisfied by a fix that announced the failure and showed nothing — half a fix, scoring as a
 * whole one. jsdom has no layout and cannot be asked whether this is on screen, so the class
 * that takes it off screen is what is checked, and `deadClasses`/`proseClasses` keep that class
 * real. The announcement is asserted separately, against the live region.
 */
function visibleFailureNotices(): Element[] {
  return Array.from(document.querySelectorAll('*')).filter(
    (el) =>
      el.children.length === 0 &&
      /couldn’t copy/i.test(el.textContent ?? '') &&
      !el.closest('.sr-only'),
  )
}

/**
 * Live regions actually carrying the failure — a COUNT, not a concatenation.
 *
 * ⚠ A JOINED STRING IS WHY THE FIRST VERSION OF THIS FILE MEASURED NOTHING ON `/setup`. That
 * screen renders `RevealOnce` AND five `CopyBlock`s, so one component's notice satisfied a
 * "does the page say it" assertion while the other five said nothing — measured: reverting
 * `CopyBlock` to the shipped defect (C2) reddened ZERO cases. Every assertion below is now
 * per-button: N copy buttons that failed must produce N notices.
 */
function liveRegionsWithFailure(): Element[] {
  return Array.from(document.querySelectorAll('[aria-live]')).filter((e) =>
    /couldn’t copy/i.test(e.textContent ?? ''),
  )
}

/**
 * Drive the screen to the state that has copy buttons on it. Both screens need a key minted:
 * `/keys` to reveal the credential card, `/setup` to fill the snippets AND to raise its own
 * reveal card.
 */
async function withCopyButtons(which: 'keys' | 'setup'): Promise<HTMLButtonElement[]> {
  renderScreen(which)
  const mintLabel = which === 'keys' ? 'Create key' : 'Create a key for setup'
  if (which === 'keys') {
    const name = await screen.findByLabelText(/new key name/i)
    fireEvent.change(name, { target: { value: 'Laptop' } })
  }
  const mint = await screen.findByRole('button', { name: mintLabel })
  await waitFor(() => expect(mint).not.toBeDisabled())
  fireEvent.click(mint)
  await screen.findByText(MINTED.key)
  await waitFor(() => expect(copyButtons().length).toBeGreaterThan(0))
  return copyButtons()
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('the instrument, before it is pointed at the product', () => {
  it('deleting the clipboard leaves navigator with no such property, as a non-secure context does', () => {
    clipboardEnv('absent')
    expect(
      'clipboard' in navigator,
      'the absent environment still has a clipboard — every case below would then be run ' +
        'against an API the browser it models does not have',
    ).toBe(false)
  })

  it('the working environment installs one that resolves, and the rejecting one rejects', async () => {
    const { writeText: ok } = clipboardEnv('working')
    await expect(ok!('x')).resolves.toBeUndefined()
    const { writeText: bad } = clipboardEnv('rejecting')
    await expect(bad!('x')).rejects.toThrow(/not focused/i)
  })
})

for (const which of ['keys', 'setup'] as const) {
  describe(`${which === 'keys' ? '/keys' : '/setup'} — a copy that did not happen must say so`, () => {
    for (const env of ['absent', 'rejecting'] as const) {
      it(`tells the reader the copy failed when the clipboard is ${env}`, async () => {
        clipboardEnv(env)
        mockBff()
        const buttons = await withCopyButtons(which)
        expect(
          buttons.length,
          'the screen offered no copy button at all — a screen that drew nothing also never ' +
            'lies about a copy, so the assertion below would be a fact about an empty page',
        ).toBeGreaterThan(0)

        for (const b of buttons) fireEvent.click(b)

        await waitFor(() => {
          expect(
            visibleFailureNotices().length,
            `${buttons.length} copy buttons on this screen were clicked with the clipboard ` +
              `${env} and only ${visibleFailureNotices().length} said so where a sighted ` +
              'reader can see it — a button whose neighbour reports for it is still a button ' +
              'that did nothing and said nothing, and on the key card the next control ' +
              'destroys the secret',
          ).toBe(buttons.length)
        })
      })

      it(`announces the failure to assistive technology when the clipboard is ${env}`, async () => {
        clipboardEnv(env)
        mockBff()
        const buttons = await withCopyButtons(which)
        expect(buttons.length).toBeGreaterThan(0)
        for (const b of buttons) fireEvent.click(b)
        await waitFor(() => {
          expect(
            liveRegionsWithFailure().length,
            `${buttons.length} copy buttons failed with the clipboard ${env} and only ` +
              `${liveRegionsWithFailure().length} live regions carry it — a screen-reader ` +
              'user gets a button that does nothing and no reason why',
          ).toBe(buttons.length)
        })
      })
    }

    it('says nothing about a failure when the copy actually works, and confirms it instead', async () => {
      clipboardEnv('working')
      mockBff()
      const buttons = await withCopyButtons(which)
      expect(buttons.length).toBeGreaterThan(0)

      for (const b of buttons) fireEvent.click(b)

      await waitFor(() => {
        expect(
          copyButtons().filter((b) => /^Copied/.test((b.textContent ?? '').trim())).length,
          'a working clipboard did not produce the confirmation on every copy button — this ' +
            'case is the positive control for the ones above, which a component that always ' +
            'claimed failure would pass',
        ).toBe(buttons.length)
      })
      expect(
        visibleFailureNotices().length,
        'the screen reported a copy failure on a copy that succeeded',
      ).toBe(0)
    })

    /* ⚠ THE CASE THAT USED TO BE HERE COULD NOT FAIL, AND ONLY A CONTROL SAID SO.
       It asserted that no clipboard rejection escapes to `window.onunhandledrejection`. It
       passed on its first run and on every control run — including C2, which restores exactly
       the code that DID leak one. MEASURED with a throwaway probe: a bare
       `Promise.reject(new Error('deliberate')).then(() => {})` in this jsdom delivers ZERO
       events to `window.addEventListener('unhandledrejection')`. Node's rejection tracking is
       not wired into jsdom's window, so the listener that case was built on is never called and
       the assertion is `expect([]).toEqual([])` forever.
       The escape IS measured, in the instrument that can see it: real Chrome on the shipped
       bundle logged `unhandledrejection: NotAllowedError: Document is not focused.` — the run
       recorded in this file's header. That is where that claim lives; it is not re-asserted here
       by something structurally unable to check it. */
  })
}
