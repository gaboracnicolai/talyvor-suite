import { forwardRef } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

interface NavItemOwnProps {
  active?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * A row with an `href` is a DESTINATION and renders `<a>`; a row without one is a command and
 * renders `<button>`.
 *
 * ⚠ TEN OF THE TWELVE ROWS IN THE CONSOLE'S SIDEBAR HAD NO href. They were `<button>`s calling
 * `navigate()`, so they could not be cmd/ctrl-clicked into a new tab, could not be middle-clicked
 * at all (middle click raises `auxclick`, never `click`), had no "Open link in new tab" or "Copy
 * link address", showed no destination in the status bar, and were announced as buttons — so a
 * screen reader's LINKS list, on every screen behind the gate, held the two legal documents and
 * no part of the product. `apps/web/src/ConsoleNavLinks.test.tsx` measured it and holds it.
 *
 * ⚠ NO ROUTER DEPENDENCY, DELIBERATELY. The design system emits the `<a href>`; deciding that a
 * plain click is a client-side navigation and a MODIFIED click is the browser's belongs to the
 * router, and the caller supplies that handler. `Button`'s `asChild` (Radix `Slot`) is the other
 * seam in this package and is the wrong one here: `Slot` clones the caller's element and cannot
 * keep the `truncate` span this row wraps its label in, so the label would stop truncating in a
 * 240px sidebar — a pixel change smuggled in by a semantic fix.
 */
export type NavItemProps = NavItemOwnProps &
  (
    | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof NavItemOwnProps>)
    | ({ href?: undefined } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof NavItemOwnProps>)
  )

// Selection is shown by a 2px accent tick + ink label, NOT a filled accent row with
// white text. That would put a hue on text; the invariant forbids it. A deliberate
// divergence from macOS's filled selection — see README §Selection.
export const NavItem = forwardRef<HTMLButtonElement & HTMLAnchorElement, NavItemProps>(
  function NavItem({ active = false, icon, children, className, ...props }, ref) {
    // ONE spelling of the class string and ONE of aria-current, shared by both tags. Two
    // branches that each spell them is how a repair updates one call site and leaves the other.
    const shared = {
      'aria-current': active ? ('page' as const) : undefined,
      className: cn(
        'flex w-full items-center gap-2 border-l-2 py-1.5 pl-3 pr-2 text-left text-body transition-colors duration-200',
        // The accent appears on TOUCH and on SELECTION — as a background tint,
        // never on the label (the invariant). The tick still marks selection.
        active
          ? 'border-l-accent bg-accent-tint text-ink'
          : 'border-l-transparent text-muted hover:bg-accent-tint hover:text-ink',
        focusRing,
        className,
      ),
    }

    const body = (
      <>
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
        {icon ? (
          <span className="shrink-0 text-muted" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="truncate">{children}</span>
      </>
    )

    if (props.href !== undefined) {
      return (
        <a ref={ref} {...shared} {...props}>
          {body}
        </a>
      )
    }
    // `type` defaults to button so a row inside a form cannot submit it.
    const { type, ...rest } = props
    return (
      <button ref={ref} type={type ?? 'button'} {...shared} {...rest}>
        {body}
      </button>
    )
  },
)
