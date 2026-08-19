import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Card, CardHeader } from './Card'

// The one-time-credential pattern, promoted from the lens /keys screen so no
// future credential UI (service tokens, key rotation, admin bootstrap)
// reinvents its safety properties:
//
//   · The SECRET is the only body-size string on the card and owns the only
//     primary action — Copy — which copies the secret and nothing else.
//   · The IDENTIFIER never sits beside the secret at equal weight: separated
//     block, caption type, labeled "not a credential" in words — never a hue.
//   · Dismissal is explicit and final: onDone fires once; the CONSUMER
//     unmounts the card and must never re-render the secret (the lens /keys
//     suite proves that end-to-end; this component's contract tests live in
//     packages/ui/src/__tests__/promotions.test.tsx).
export interface RevealOnceProps {
  /** Card title, e.g. "Workspace key — shown once". */
  title: string
  secret: string
  /** Copy-button label, e.g. "Copy key" / "Copy token". Swaps to "Copied". */
  copyLabel?: string
  storeWarning?: string
  identifierLabel?: string
  /** The shareable identifier (prefix) — rendered apart from the secret. */
  identifier: string
  identifierNote?: string
  doneLabel?: string
  /** What the card says when the copy did not happen. See `copy()` below. */
  copyFailedNote?: string
  onDone: () => void
}

export function RevealOnce({
  title,
  secret,
  copyLabel = 'Copy',
  storeWarning = 'Store it now — it will not be shown again.',
  identifierLabel = 'Identifier — not a credential',
  identifier,
  identifierNote = 'Safe to share; this is how it appears in lists.',
  doneLabel = 'Done — I stored it',
  copyFailedNote = 'Couldn’t copy — select the secret above and copy it yourself before you dismiss this card.',
  onDone,
}: RevealOnceProps) {
  // THREE STATES, NOT TWO. `copied` was a boolean for an outcome that has three: not yet,
  // done, and DID NOT HAPPEN — and the third one rendered exactly like the first.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  // ⚠ THIS PROMISE COULD NOT REJECT SAFELY, AND IT HAS TWO WAYS TO FAIL.
  //   · `navigator.clipboard` IS NOT INSTALLED OUTSIDE A SECURE CONTEXT. Measured in Chrome on
  //     the shipped bundle served from `http://192.168.100.149:8791`: `isSecureContext` false,
  //     `typeof navigator.clipboard` "undefined", and this line raised
  //     `TypeError: Cannot read properties of undefined (reading 'writeText')`.
  //   · `writeText` REJECTS where it does exist — `NotAllowedError: Document is not focused.`
  //     on https when the tab is not frontmost, or a denied `clipboard-write`.
  // Neither reached the reader: the label stayed put, the live region stayed empty, and the
  // failure's whole itinerary was `window.onerror`. On THIS card that is the dangerous
  // direction to be wrong in — the secret is shown once and the next control destroys it.
  // ⚠ `writeText` IS CALLED SYNCHRONOUSLY, AND A `try` — NOT AN AWAIT — IS WHY.
  // The absent-clipboard case is a THROW and the refused case is a REJECTION, so the obvious
  // shape is `Promise.resolve().then(() => …writeText(…))`, which funnels both into one
  // handler. It also moves the call out of the click's own turn, and a clipboard write outside
  // the user gesture that provoked it is exactly what Safari refuses. `promotions.test.tsx`
  // caught that: it asserts the write happens on the click, and it went red.
  // ⚠ THE RESET MUST NOT OUTLIVE THE COMPONENT — the same defect Setup.tsx carried, in the file
  // Setup.tsx's own comment cites as its model. Uncancelled, this fires `setCopyState` on an
  // unmounted tree, and under vitest into a torn-down jsdom, which reds the RUN rather than a
  // test. Found by measurement, not by reading: the first census walked apps/web/src only, and
  // this package sat outside the boundary. src/timerCleanup.test.tsx now walks both trees.
  const resetTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const copy = () => {
    try {
      void navigator.clipboard.writeText(secret).then(
        () => {
          setCopyState('copied')
          window.clearTimeout(resetTimer.current)
          resetTimer.current = window.setTimeout(() => setCopyState('idle'), 2000)
        },
        // No auto-clear: a failure the reader has not acted on must not time out into the
        // state that looks like "not yet".
        () => setCopyState('failed'),
      )
    } catch {
      // `navigator.clipboard` is not installed outside a secure context, so the line above
      // raises a TypeError before any promise exists.
      setCopyState('failed')
    }
  }

  return (
    <Card>
      <CardHeader>{title}</CardHeader>

      <div className="flex flex-col gap-3 px-gutter py-3">
        <div className="select-all break-all font-mono text-body font-medium text-ink">{secret}</div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={copy}>
            {copyState === 'copied' ? 'Copied' : copyLabel}
          </Button>
          <span className="text-body text-muted">{storeWarning}</span>
          <span aria-live="polite" className="sr-only">
            {copyState === 'copied' ? 'Copied to clipboard' : copyState === 'failed' ? copyFailedNote : ''}
          </span>
        </div>
        {/* Rendered ONLY in the state that used to render nothing, so the two states this card
            has always had are untouched — and a failure a sighted reader cannot see is not
            reported at all. The secret above is `select-all`, which is what this sentence asks
            the reader to use. */}
        {copyState === 'failed' ? <p className="text-body text-ink">{copyFailedNote}</p> : null}
      </div>

      <div className="border-t border-rule px-gutter py-3">
        <div className="font-figure text-eyebrow font-semibold uppercase text-faint">{identifierLabel}</div>
        <div className="pt-1 text-caption text-muted">
          <span className="font-mono">{identifier}</span>
          <span className="pl-2 text-body font-normal text-faint">{identifierNote}</span>
        </div>
      </div>

      <div className="border-t border-rule px-gutter py-3">
        <Button onClick={onDone}>{doneLabel}</Button>
      </div>
    </Card>
  )
}
