import { cn } from '../lib/cn'

export interface ShellProps {
  /** Sidebar content (brand + nav). */
  sidebar: React.ReactNode
  /** Sticky top-bar content (title, actions). */
  nav?: React.ReactNode
  children: React.ReactNode
  className?: string
}

// Sidebar + content. Stacked (sidebar on top) below the `wide` (840px) breakpoint,
// side-by-side at and above it. The top nav is sticky within the content column.
export function Shell({ sidebar, nav, children, className }: ShellProps) {
  return (
    <div className={cn('flex min-h-full flex-col wide:flex-row', className)}>
      <aside
        className="w-full shrink-0 border-b border-rule bg-sidebar wide:w-60 wide:border-b-0 wide:border-r"
        aria-label="Primary"
      >
        <div className="sticky top-0 max-h-screen overflow-y-auto p-2">{sidebar}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {nav ? (
          <header className="sticky top-0 z-10 flex min-h-row items-center justify-between gap-gutter border-b border-rule bg-canvas px-gutter py-2">
            {nav}
          </header>
        ) : null}
        <main className="flex-1 p-gutter">{children}</main>
      </div>
    </div>
  )
}
