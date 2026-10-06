import type { ChatMessage } from './chatApi'
import { spentULXC } from './ConversationBudget'

// B28.101 — a running total for the conversation, under the box: the prices under its answers added up. It is worked
// out from the answers themselves, which are kept with the conversation in this browser (history.ts), so a reopened
// or reloaded conversation shows the same total. With the deployment's peg it is credits and is the figure beside the
// budget (ConversationBudget.tsx spentULXC); without one a model's answer is priced in dollars and a shared answer in
// the credits Lens charged, so the total is a figure in each.

/** A conversation's answers, their prices added up. */
export interface ChatTotalFigures {
  /** Answers with a price under them, free ones (a replay, an answer on your own key) included. */
  priced: number
  /** Answers whose provider reported no token counts: "Price not known" is under them, and they add nothing. */
  unpriced: number
  /** µLXC: with a peg, every price; without one, the shared answers'. */
  ulxc: number
  /** Without a peg, the model's answers in dollars; with one, 0. */
  usd: number
}

const pegged = (usdPerLXC: number | undefined): usdPerLXC is number =>
  typeof usdPerLXC === 'number' && Number.isFinite(usdPerLXC) && usdPerLXC > 0

/** The conversation's answers, priced as their footers price them, added up. */
export function chatTotal(messages: readonly ChatMessage[], usdPerLXC: number | undefined): ChatTotalFigures {
  const t: ChatTotalFigures = { priced: 0, unpriced: 0, ulxc: 0, usd: 0 }
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    if (m.source !== undefined || m.cost !== undefined) t.priced++
    else if (m.content !== '' && m.incomplete !== 'blank') t.unpriced++
    if (m.source?.kind === 'pool') t.ulxc += m.source.charged_ulxc
    else if (m.source === undefined && m.cost !== undefined && !pegged(usdPerLXC)) t.usd += m.cost.usd
  }
  if (pegged(usdPerLXC)) t.ulxc = spentULXC(messages, usdPerLXC) ?? 0
  return t
}

const sixPlaces = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 })

/** The total as it reads: "≈ 0.004288 LXC", "≈ $0.000429", or "≈ $0.000429 + 0.0003 LXC". */
function formatChatTotal(t: ChatTotalFigures, usdPerLXC: number | undefined): string {
  const lxc = `${sixPlaces(t.ulxc / 1_000_000)} LXC`
  if (pegged(usdPerLXC)) return `≈ ${lxc}`
  return t.ulxc > 0 ? `≈ $${sixPlaces(t.usd)} + ${lxc}` : `≈ $${sixPlaces(t.usd)}`
}

const many = (n: number, one: string, more: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : more}`

/** "This chat so far ≈ 0.004288 LXC · 3 answers", once the conversation has an answer. */
export function ChatTotal({ messages, usdPerLXC }: { messages: readonly ChatMessage[]; usdPerLXC: number | undefined }) {
  const t = chatTotal(messages, usdPerLXC)
  if (t.priced + t.unpriced === 0) return null
  return (
    <p className="text-caption text-muted" data-testid="chat-total">
      This chat so far <span className="whitespace-nowrap font-figure text-ink">{formatChatTotal(t, usdPerLXC)}</span>
      <span className="text-faint">
        {' · '}
        <span className="font-figure">{many(t.priced, 'answer', 'answers')}</span>
        {t.unpriced > 0 ? (
          <>
            {', and '}
            <span className="font-figure">{t.unpriced.toLocaleString('en-US')}</span> not priced
          </>
        ) : null}
      </span>
    </p>
  )
}
