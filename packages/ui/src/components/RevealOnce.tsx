import { useState } from 'react'
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
  onDone,
}: RevealOnceProps) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Card>
      <CardHeader>{title}</CardHeader>

      <div className="flex flex-col gap-3 px-gutter py-3">
        <div className="select-all break-all font-mono text-body font-medium text-ink">{secret}</div>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={copy}>
            {copied ? 'Copied' : copyLabel}
          </Button>
          <span className="text-caption text-muted">{storeWarning}</span>
          <span aria-live="polite" className="sr-only">
            {copied ? 'Copied to clipboard' : ''}
          </span>
        </div>
      </div>

      <div className="border-t border-rule px-gutter py-3">
        <div className="text-caption font-semibold uppercase tracking-wide text-faint">{identifierLabel}</div>
        <div className="pt-1 text-caption text-muted">
          <span className="font-mono tabular-nums">{identifier}</span>
          <span className="pl-2 text-faint">{identifierNote}</span>
        </div>
      </div>

      <div className="border-t border-rule px-gutter py-3">
        <Button onClick={onDone}>{doneLabel}</Button>
      </div>
    </Card>
  )
}
