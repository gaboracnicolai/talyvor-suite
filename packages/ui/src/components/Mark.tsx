// The Talyvor mark: a rounded hairline tile holding a partially-filled 2px
// track — the hold indicator abstracted. The one place the accent lives
// PERMANENTLY (elsewhere it appears on interaction); the label next to it
// stays ink, because text is never a hue. Themed entirely by tokens, so both
// themes come free. Fill is 62.5% — 5/8, deliberately past half: in progress,
// closer to done than to zero.
import { cn } from '../lib/cn'

export interface MarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Tile edge in px. 24 suits the sidebar; the specimen shows 24 and 32. */
  size?: number
}

export function Mark({ size = 24, className, ...props }: MarkProps) {
  return (
    <span
      role="img"
      aria-label="Talyvor"
      style={{ width: size, height: size }}
      className={cn(
        'inline-flex shrink-0 items-center rounded-control border border-rule bg-surface px-1.5',
        className,
      )}
      {...props}
    >
      <span className="relative h-0.5 w-full rounded-pill bg-rule">
        <span data-fill className="absolute inset-y-0 left-0 rounded-pill bg-accent" style={{ width: '62.5%' }} />
      </span>
    </span>
  )
}
