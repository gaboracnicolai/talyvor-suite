import { useEffect, useState } from 'react'

import { cn, focusRing } from '@talyvor/ui'

import type { ChatMessage } from './chatApi'
import type { CostRange } from './estimate'

// B28.361 — a budget per conversation. "Budget", under the composer, caps what one conversation may spend, in LXC.
// It is kept with the conversation (history.ts) and every request the conversation makes carries it to Lens with the
// conversation's id (chatApi.ts CONVERSATION_HEADER), so Lens can refuse a request that would take the conversation
// past it before the model is asked (talyvor-lens B28.100). Chat refuses first, here, when what the conversation has
// spent — the prices under its answers — and the most this question could cost (the high end of the price shown
// before sending, estimate.ts) come to more than the budget: such a question never leaves the browser.

const ULXC = 1_000_000

const pegged = (usdPerLXC: number | undefined): usdPerLXC is number =>
  typeof usdPerLXC === 'number' && Number.isFinite(usdPerLXC) && usdPerLXC > 0

/** µLXC for dollars at the deployment's peg, rounded up as Lens rounds a charge. */
const ulxcOf = (usd: number, usdPerLXC: number) => Math.ceil((usd / usdPerLXC) * ULXC)

/** µLXC as LXC, every digit kept: `50000` is `0.05`. */
function lxcFigure(ulxc: number): string {
  return (ulxc / ULXC).toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: false })
}

/**
 * The budget as typed, in µLXC: `undefined` for an empty box (no budget), `null` for something that is not a positive
 * amount of LXC to at most six decimals.
 */
export function parseBudget(text: string): number | undefined | null {
  const t = text.trim()
  if (t === '') return undefined
  if (!/^(\d+(\.\d{0,6})?|\.\d{1,6})$/.test(t)) return null
  const ulxc = Math.round(Number(t) * ULXC)
  return ulxc > 0 && Number.isSafeInteger(ulxc) ? ulxc : null
}

/**
 * What the conversation's answers cost, in µLXC: the prices under them — a model's answer by its tokens at the list
 * rate, a shared answer what Lens charged for it, an answer from your own cache or on your own key nothing. Undefined
 * when the deployment confirms no peg, because the prices are then dollars.
 */
export function spentULXC(messages: readonly ChatMessage[], usdPerLXC: number | undefined): number | undefined {
  if (!pegged(usdPerLXC)) return undefined
  let total = 0
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    if (m.source?.kind === 'pool') total += m.source.charged_ulxc
    else if (m.source === undefined && m.cost !== undefined) total += ulxcOf(m.cost.usd, usdPerLXC)
  }
  return total
}

/** A question that could take the conversation past its budget, in µLXC. */
export interface OverBudget {
  budget_ulxc: number
  spent_ulxc: number
  /** The high end of what the question could cost. */
  most_ulxc: number
}

/**
 * Whether sending a question could take the conversation past its budget: what the conversation has spent plus the
 * high end of the question's price range is more than the budget. Undefined when it could not, when there is no
 * budget, or when it cannot be told here (no price range, or no peg) — Lens still decides.
 */
export function overBudget(
  budgetULXC: number | undefined,
  messages: readonly ChatMessage[],
  estimate: CostRange | undefined,
  usdPerLXC: number | undefined,
): OverBudget | undefined {
  if (budgetULXC === undefined || estimate === undefined || !pegged(usdPerLXC)) return undefined
  const spent = spentULXC(messages, usdPerLXC) ?? 0
  const most = ulxcOf(estimate.high_usd, usdPerLXC)
  return spent + most > budgetULXC ? { budget_ulxc: budgetULXC, spent_ulxc: spent, most_ulxc: most } : undefined
}

/** The refusal Chat shows for a question it did not send. */
export function budgetRefusal(o: OverBudget): string {
  return (
    `This chat’s budget is ${lxcFigure(o.budget_ulxc)} LXC and ${lxcFigure(o.spent_ulxc)} LXC is spent. ` +
    `Sending this could cost up to ${lxcFigure(o.most_ulxc)} LXC, so it was not sent. Raise the budget, or start a new chat.`
  )
}

export function ConversationBudget({
  value,
  spent,
  onChange,
  disabled,
}: {
  /** The budget in µLXC; undefined, none. */
  value: number | undefined
  /** What the conversation has spent, in µLXC; undefined when it cannot be said in LXC. */
  spent: number | undefined
  onChange: (ulxc: number | undefined) => void
  disabled: boolean
}) {
  const [text, setText] = useState(value === undefined ? '' : lxcFigure(value))
  const [invalid, setInvalid] = useState(false)
  // Another conversation opened, or the budget saved: the box shows the budget it now has.
  useEffect(() => {
    setText(value === undefined ? '' : lxcFigure(value))
    setInvalid(false)
  }, [value])

  const commit = () => {
    const parsed = parseBudget(text)
    if (parsed === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (parsed !== value) onChange(parsed)
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="chat-budget">
      <label htmlFor="chat-budget" className="font-figure text-eyebrow uppercase text-label">
        Budget
      </label>
      <input
        id="chat-budget"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="None"
        value={text}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? 'chat-budget-invalid' : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          commit()
        }}
        className={cn(
          'w-24 rounded-control border border-rule bg-canvas px-2 py-1 font-figure text-caption text-ink placeholder:text-faint',
          'transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
          focusRing,
        )}
      />
      <span className="text-caption text-muted">LXC</span>
      {value !== undefined && spent !== undefined ? (
        <span className="text-caption text-muted" data-testid="chat-budget-spent">
          <span className="font-figure text-ink">{lxcFigure(spent)}</span> spent
        </span>
      ) : null}
      {invalid ? (
        <span id="chat-budget-invalid" className="text-caption text-ink" role="alert">
          A budget is an amount of LXC, like 0.5.
        </span>
      ) : null}
    </div>
  )
}
