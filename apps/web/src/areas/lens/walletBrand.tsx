import { Card as UiCard, type CardProps } from '@talyvor/ui'

// B29.9 — the wallet screens in the brand: Agent Wallets, Approvals, Statements, Royalties, Ledger and Spend.
// Their cards sit on `raised`, as the board's PRODUCT UI tile draws them, and a choice that is on shows on the
// accent tint rather than in the teal fill — the fill is each screen's one primary action.

/** A wallet screen's card, on the board's raised plane. */
export function Card(props: CardProps) {
  return <UiCard raised {...props} />
}

/** A toggle's on state (`aria-pressed`): the tint and a teal edge, never the primary fill. */
export const pressed = 'aria-pressed:border-accent aria-pressed:bg-accent-tint'
