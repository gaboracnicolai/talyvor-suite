import { forwardRef } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export interface NavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
}

// Selection is shown by a 2px accent tick + ink label, NOT a filled accent row with
// white text. That would put a hue on text; the invariant forbids it. A deliberate
// divergence from macOS's filled selection — see README §Selection.
export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(function NavItem(
  { active = false, icon, children, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 border-l-2 py-1.5 pl-3 pr-2 text-left text-body transition-colors',
        // The accent appears on TOUCH and on SELECTION — as a background tint,
        // never on the label (the invariant). The tick still marks selection.
        active
          ? 'border-l-accent bg-accent-tint text-ink'
          : 'border-l-transparent text-muted hover:bg-accent-tint hover:text-ink',
        focusRing,
        className,
      )}
      {...props}
    >
      {icon ? <span className="shrink-0 text-faint" aria-hidden="true">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </button>
  )
})
