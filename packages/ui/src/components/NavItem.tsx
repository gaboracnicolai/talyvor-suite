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

// Selection is the board's PRODUCT UI tile (brand-v4 BRAND.md §The product UI): the selected row
// sits on `accent-tint` with its label and icon in `accent-strong` — Teal in the dark theme, the
// light theme's deeper teal in light, because light Teal on the tint is 3.95 (planes.ts). The
// economy hues still never colour text; accent is the board's active state, not one of them.
export const NavItem = forwardRef<HTMLButtonElement & HTMLAnchorElement, NavItemProps>(
  function NavItem({ active = false, icon, children, className, ...props }, ref) {
    // ONE spelling of the class string and ONE of aria-current, shared by both tags. Two
    // branches that each spell them is how a repair updates one call site and leaves the other.
    const shared = {
      'aria-current': active ? ('page' as const) : undefined,
      className: cn(
        'flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-body font-medium transition-colors duration-200',
        active ? 'bg-accent-tint text-accent-strong' : 'text-muted hover:bg-accent-tint hover:text-ink',
        focusRing,
        className,
      ),
    }

    const body = (
      <>
        {/* The icon wears the row's state: `accent-strong` when selected, `muted` otherwise —
            both clear AA on the tint (the hover plane) and on the sidebar (planes.ts). */}
        {icon ? (
          <span className={cn('flex shrink-0', active ? 'text-accent-strong' : 'text-muted')} aria-hidden="true">
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
