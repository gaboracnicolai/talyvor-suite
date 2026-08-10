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
        'flex w-full items-center gap-2 border-l-2 py-1.5 pl-3 pr-2 text-left text-body transition-colors duration-200',
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
      {/* ⚠ `muted`, NOT `faint`, AND THE REASON IS THE PLANE UNDER IT RATHER THAN THE STEP BESIDE
          it. This row's background is `accent-tint` whenever it is selected OR hovered, and
          MEASURED on that plane `faint` is 3.97:1 light / 3.63:1 dark — under the 4.5:1 AA body
          floor contrast.test.ts holds every other pair to. `muted` is 5.51 / 4.74 there and
          6.72 / 6.27 on the canvas and sidebar, so ONE token clears every plane this row can be
          on. It was `faint`, unconditionally, and no surface passes an `icon` — so the pair never
          reached a DOM and five audits stayed green over it (apps/web/src/planeAudit.ts).
          ⚠ ONE TOKEN, NOT ONE PER STATE, DELIBERATELY: `:hover` never applies in jsdom, so a
          `group-hover:` answer would be unverifiable by the only instrument that can see the
          plane at all. The step down from the label survives where it carries meaning — the
          selected row is ink over muted. */}
      {icon ? <span className="shrink-0 text-muted" aria-hidden="true">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </button>
  )
})
