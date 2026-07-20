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
      <div className="text-head text-ink">{children}</div>
    </div>
  )
}
