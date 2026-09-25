import { useEffect, useRef, useState } from 'react'

import { cn, focusRing } from '@talyvor/ui'

/**
 * A quiet copy control for chat replies and code blocks.
 *
 * The same three states as Setup's CopyBlock — not yet, done, did not happen — because a copy that
 * silently fails outside a secure context is the defect copyFailure.test.tsx records. The reset
 * timer is cleared on unmount (timerCleanup.test.tsx).
 */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const resetTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(resetTimer.current), [])
  const failedNote = 'Couldn’t copy — select the text and copy it yourself.'
  return (
    <>
      <button
        type="button"
        className={cn(
          'rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink',
          focusRing,
          className,
        )}
        onClick={() => {
          // Synchronous call, `try` for the throw, rejection handler for the refusal — awaiting
          // first would move the write out of the click's turn, which Safari refuses.
          try {
            void navigator.clipboard.writeText(text).then(
              () => {
                setState('copied')
                window.clearTimeout(resetTimer.current)
                resetTimer.current = window.setTimeout(() => setState('idle'), 1500)
              },
              () => setState('failed'),
            )
          } catch {
            setState('failed')
          }
        }}
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : label}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? failedNote : ''}
      </span>
    </>
  )
}
