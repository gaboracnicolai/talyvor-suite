import { useEffect, useRef, useState } from 'react'

import { cn, focusRing } from '@talyvor/ui'

// B28.120 — the canvas. An HTML block in an answer opens here, beside the conversation (a drawer on a narrower screen):
// Preview draws it as a page, Code is its HTML to edit. An edit is saved with the conversation shortly after typing
// stops, and when the canvas closes, so it is there after a reload (artifacts.ts).
//
// ⚠ THE PAGE IS DRAWN IN A SANDBOXED FRAME WITH NO ORIGIN. The HTML is a model's, text from outside this product, and
// the person may edit it into anything. `sandbox="allow-scripts"` without allow-same-origin gives it an opaque origin:
// its scripts run, and cannot read this page, its storage or its cookies, open a window, or navigate the console.

/** How long typing stops before an edit is drawn and saved. */
export const CANVAS_SAVE_AFTER_MS = 400

/** In the bar of an HTML block in an answer: opens it in the canvas; "edited" once the canvas has saved an edit to it. */
export function OpenInCanvas({ edited, onOpen }: { edited: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={actionClass} data-testid="open-in-canvas">
      {edited ? 'Open in canvas · edited' : 'Open in canvas'}
    </button>
  )
}

export function Canvas({
  title,
  html,
  original,
  locked,
  onSave,
  onClose,
}: {
  title: string
  /** The artifact as it stands: its last saved edit, or as the answer wrote it. */
  html: string
  /** As the answer wrote it, which Restore puts back. */
  original: string
  /** While an answer is being written its conversation is not edited: the answer's save would put the edit back. */
  locked: boolean
  onSave: (html: string) => void
  onClose: () => void
}) {
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [draft, setDraft] = useState(html)
  // What the frame draws and what is saved: the draft once typing has stopped.
  const [shown, setShown] = useState(html)
  const saved = useRef(html)
  const latest = useRef(draft)
  latest.current = draft
  const save = useRef(onSave)
  save.current = onSave

  useEffect(() => {
    if (draft === shown) return
    const t = window.setTimeout(() => setShown(draft), CANVAS_SAVE_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [draft, shown])
  // Typed just before a question was sent, an edit waits for its answer.
  useEffect(() => {
    if (locked || shown === saved.current) return
    saved.current = shown
    save.current(shown)
  }, [shown, locked])
  const lockedNow = useRef(locked)
  lockedNow.current = locked
  // Closed before typing stopped, the last edit is saved too.
  useEffect(
    () => () => {
      if (!lockedNow.current && latest.current !== saved.current) save.current(latest.current)
    },
    [],
  )

  const restore = () => {
    setDraft(original)
    setShown(original)
  }

  return (
    <div data-testid="canvas" className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex items-center gap-2 border-b border-rule py-2 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <p className="font-figure text-eyebrow uppercase text-label">Canvas</p>
          <h2 className="truncate text-body font-semibold text-ink" data-testid="canvas-title">
            {title}
          </h2>
        </div>
        <div className="flex items-center rounded-control border border-rule p-0.5">
          {(['preview', 'code'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-control px-2 py-1 text-caption transition-colors duration-200',
                view === v ? 'bg-accent-tint text-ink' : 'text-muted hover:text-ink',
                focusRing,
              )}
            >
              {v === 'preview' ? 'Preview' : 'Code'}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Close canvas" title="Close canvas" className={iconClass}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {view === 'preview' ? (
        <iframe
          title={`${title}, drawn as a page`}
          sandbox="allow-scripts"
          srcDoc={shown}
          className="min-h-0 w-full flex-1 border-0 bg-raised"
          data-testid="canvas-preview"
        />
      ) : (
        <textarea
          aria-label="HTML"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          readOnly={locked}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={cn(
            'min-h-0 w-full flex-1 resize-none border-0 bg-raised p-4 font-mono text-caption text-ink',
            'transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
            focusRing,
          )}
          data-testid="canvas-code"
        />
      )}
      <div className="flex min-h-row flex-wrap items-center gap-x-3 border-t border-rule px-4 py-1">
        <p role="status" className="text-caption text-muted" data-testid="canvas-saved">
          {locked
            ? 'Edits wait until the answer being written is finished.'
            : draft !== shown
              ? 'Saving…'
              : shown !== original
                ? 'Edited · saved in this browser with the conversation'
                : 'As the answer wrote it'}
        </p>
        {draft !== original && !locked ? (
          <button type="button" onClick={restore} className={actionClass}>
            Restore the original
          </button>
        ) : null}
      </div>
    </div>
  )
}

const actionClass = cn('rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink', focusRing)

const iconClass = cn(
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-200 hover:text-ink',
  focusRing,
)
