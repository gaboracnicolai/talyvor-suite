import { cn, focusRing } from '@talyvor/ui'

import { type DocRef, useDocsNav } from './docsNav'

/** B10.6 — pin a Docs page to the sidebar, or unpin it. Quiet, and says which it will do. */
export function PinToggle({ doc, className }: { doc: DocRef; className?: string }) {
  const nav = useDocsNav()
  if (!nav.ready) return null
  const pinned = nav.isPinned(doc)
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${doc.title}` : `Pin ${doc.title}`}
      onClick={() => nav.setPinned(doc, !pinned)}
      className={cn(
        'rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink',
        focusRing,
        className,
      )}
    >
      {pinned ? 'Unpin' : 'Pin'}
    </button>
  )
}
