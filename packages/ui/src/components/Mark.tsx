// The Talyvor mark, copied path for path from brand-v4 svg/talyvor-mark-flat-dark.svg and
// svg/talyvor-mark-flat-light.svg. Never redraw it. The two files share every path and differ only
// in their fills, so theme.css carries each file's fills as --mark-* under [data-theme='dark'] and
// [data-theme='light']: one inline SVG draws the dark file in the dark theme and the light file in
// the light one, scoped to the nearest data-theme like every other token.
import { cn } from '../lib/cn'

export interface MarkProps extends React.SVGProps<SVGSVGElement> {
  /** Edge in px. 26 suits the sidebar and the page headers. */
  size?: number
}

export function Mark({ size = 24, className, ...props }: MarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="44.5 48 566 566"
      width={size}
      height={size}
      role="img"
      aria-label="Talyvor"
      data-brand="mark"
      className={cn('shrink-0', className)}
      {...props}
    >
      <path
        style={{ fill: 'var(--mark-upper)' }}
        d="M58 52Q58 48 62 48L89.32 48C283.7 48 276.73 228 397.9 228L464.57 298L398.08 298C211.52 298 246.28 127 90.37 127L62 127Q58 127 58 123Z"
      />
      <path
        style={{ fill: 'var(--mark-upper)' }}
        d="M58 220Q58 216 62 216L138.61 216C199.23 216 200.46 331 402 331L197.86 331C153.13 313.86 149.25 287 118.28 287L62 287Q58 287 58 283Z"
      />
      <path
        style={{ fill: 'var(--mark-lower)' }}
        d="M58 442Q58 446 62 446L138.61 446C199.23 446 200.46 331 402 331L197.86 331C153.13 348.14 149.25 375 118.28 375L62 375Q58 375 58 379Z"
      />
      <path
        style={{ fill: 'var(--mark-base)' }}
        d="M58 610Q58 614 62 614L89.32 614C283.7 614 276.73 434 397.9 434L464.57 364L398.08 364C211.52 364 246.28 535 90.37 535L62 535Q58 535 58 539Z"
      />
      <path
        style={{ fill: 'var(--mark-tip)' }}
        d="M407.9 228L512.77 228Q517.77 228 520.82 231.96L594.56 327.83Q597 331 594.56 334.17L520.82 430.04Q517.77 434 512.77 434L407.9 434L506 331Z"
      />
    </svg>
  )
}
