import { cn } from '../lib/cn'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The proof-rule variant: a 2px accent rule down the left edge marks a card whose
   *  contents are backed by a proof/verification. Colour in a tick, never on text. */
  proof?: boolean
  children: React.ReactNode
}

export function Card({ proof = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-card border border-rule bg-surface',
        proof && 'border-l-2 border-l-accent',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function CardHeader({ className, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-gutter border-b border-rule px-gutter py-2.5', className)} {...props}>
      {/* `h2`, NOT `div` — the element and its classes are unchanged; only the tag moved.
          A card header is a SECTION TITLE, and this component is the one seam all 39 of them
          behind the gate go through. As a div they were anonymous boxes: measured in Chrome on
          the built artifact, /setup renders nine of them and the whole page held ONE heading
          element, so a screen-reader user pressing H got "Setup" and then nothing. `a19c18f`
          (#126) promoted the PAGE NAME to `<h1>` and stopped one level short.
          The product had already decided this on the pages a stranger sees — legalParts.tsx
          writes `<h2 className="text-head text-ink">`, which is why /privacy and /terms measured
          1>2>2>2… while every console screen measured 1.
          Zero-pixel by construction: preflight sets `h1,…,h6{font-size:inherit;font-weight:
          inherit}` and `…,h1,…{margin:0}`, so `.text-head` supplies the type either way — the
          same reason #126's promotion was byte-identical.
          apps/web/src/CardHeaderHeading.test.tsx holds the element, the level, the sweep across
          every gated address, and the over-correction it refuses. */}
      <h2 className="text-head text-ink">{children}</h2>
    </div>
  )
}
