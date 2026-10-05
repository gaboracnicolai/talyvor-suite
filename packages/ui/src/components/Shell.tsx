import { useEffect, useId, useRef, useState } from 'react'

import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export interface ShellProps {
  /** Sidebar content (brand + nav). */
  sidebar: React.ReactNode
  /** Sticky top-bar content (title, actions). */
  nav?: React.ReactNode
  children: React.ReactNode
  className?: string
}

// Sidebar + content, side-by-side at and above the `wide` (840px) breakpoint. Below it the page
// starts at the top: the sidebar is a drawer, opened by the Menu button in the sticky top bar and
// closed by Escape, the backdrop, or following one of its links. It is the same <aside> at every
// width — off-screen and invisible (so nothing in it takes focus) until opened.
export function Shell({ sidebar, nav, children, className }: ShellProps) {
  const [open, setOpen] = useState(false)
  const asideId = useId()
  const asideRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    asideRef.current?.querySelector<HTMLElement>('a, button:not(:disabled)')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      menu?.focus()
    }
  }, [open])

  return (
    <div className={cn('flex min-h-full flex-col wide:flex-row', className)}>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-20 bg-canvas opacity-80 wide:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        id={asideId}
        ref={asideRef}
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-72 max-w-full shrink-0 border-r border-rule bg-sidebar',
          'wide:static wide:visible wide:z-auto wide:w-60',
          open ? 'visible' : 'invisible',
        )}
        aria-label="Primary"
        onClick={(e) => {
          if ((e.target as Element).closest('a')) setOpen(false)
        }}
      >
        <div className="sticky top-0 max-h-screen overflow-y-auto p-3">{sidebar}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'sticky top-0 z-10 flex min-h-row items-center justify-between gap-gutter border-b border-rule bg-canvas px-gutter py-2',
            !nav && 'wide:hidden',
          )}
        >
          <button
            ref={menuRef}
            type="button"
            aria-expanded={open}
            aria-controls={asideId}
            className={cn(
              'inline-flex h-8 shrink-0 items-center rounded-control px-2 text-caption text-muted transition-colors duration-200 hover:text-ink wide:hidden',
              focusRing,
            )}
            onClick={() => setOpen((o) => !o)}
          >
            Menu
          </button>
          {nav}
        </header>
        <main className="flex-1 p-gutter">{children}</main>
      </div>
    </div>
  )
}
