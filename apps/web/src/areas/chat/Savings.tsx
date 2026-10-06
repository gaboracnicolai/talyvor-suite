import type { ReactNode } from 'react'

import { Lxc } from '../lens/money'
import type { ChatMessage } from './chatApi'

// B28.358 — what the cache, the shared pool, document conversion and Tare saved in the open conversation, beside it.
// Every figure is the sum of what Lens said with the answers themselves — X-Talyvor-Cache-Saved-ULXC,
// X-Talyvor-Pool-Saved-ULXC, X-Talyvor-Distill-Tokens-Saved and X-Talyvor-Tare-Tokens-Saved, kept on each answer by
// chatApi.ts — so the totals equal those headers and nothing here is estimated. An answer Lens replayed, shared or
// trimmed without saying what that saved is counted, and said, but adds nothing.

/** One way an answer comes cheaper: the answers in the conversation it made cheaper, and what Lens said that saved. */
export interface Saving {
  answers: number
  /** Of those, the answers Lens did not say the saving of. */
  unstated: number
  /** µLXC for the cache and the pool; tokens for conversion and Tare. */
  total: number
}

export interface ChatSavingsTotals {
  cache: Saving
  pool: Saving
  conversion: Saving
  tare: Saving
}

const none = (): Saving => ({ answers: 0, unstated: 0, total: 0 })

function count(s: Saving, figure: number | undefined): void {
  s.answers++
  if (figure === undefined) s.unstated++
  else s.total += figure
}

/** The conversation's savings, added up from what Lens said on each answer. */
export function chatSavings(messages: readonly ChatMessage[]): ChatSavingsTotals {
  const t: ChatSavingsTotals = { cache: none(), pool: none(), conversion: none(), tare: none() }
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    if (m.source?.kind === 'cache') count(t.cache, m.source.saved_ulxc)
    if (m.source?.kind === 'pool') count(t.pool, m.source.saved_ulxc)
    if (m.saved !== undefined) count(t.conversion, m.saved.tokens)
    if (m.tare !== undefined) count(t.tare, m.tare.tokens)
  }
  return t
}

const many = (n: number, one: string, more: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : more}`

function Tokens({ n }: { n: number }) {
  return <span className="whitespace-nowrap font-figure">{many(n, 'token', 'tokens')}</span>
}

function Row({ id, name, saving, figure, what }: { id: string; name: string; saving: Saving; figure: ReactNode; what: string }) {
  return (
    <div
      data-testid={`chat-savings-${id}`}
      data-total={saving.total}
      data-answers={saving.answers}
      data-unstated={saving.unstated}
      className="py-1.5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-body text-ink">{name}</dt>
        <dd className="text-body text-ink">{figure}</dd>
      </div>
      <dd className="text-caption text-muted">
        {saving.answers === 0 ? 'None yet' : what}
        {saving.unstated > 0 ? ` · Lens did not say what ${saving.unstated === saving.answers ? (saving.answers === 1 ? 'it' : 'they') : `${saving.unstated} of them`} saved` : ''}
      </dd>
    </div>
  )
}

export function ChatSavings({ messages }: { messages: readonly ChatMessage[] }) {
  const t = chatSavings(messages)
  return (
    <section aria-label="Saved in this chat" data-testid="chat-savings" className="border-b border-rule px-gutter py-3">
      <p className="font-figure text-eyebrow uppercase text-label">Saved in this chat</p>
      <dl className="mt-1 divide-y divide-rule">
        <Row id="cache" name="Cache" saving={t.cache} figure={<Lxc ulxc={t.cache.total} />}
          what={many(t.cache.answers, 'answer from your earlier ones', 'answers from your earlier ones')} />
        <Row id="pool" name="Shared pool" saving={t.pool} figure={<Lxc ulxc={t.pool.total} />}
          what={many(t.pool.answers, 'shared answer, at a discount', 'shared answers, at a discount')} />
        <Row id="conversion" name="Conversion" saving={t.conversion} figure={<Tokens n={t.conversion.total} />}
          what={many(t.conversion.answers, 'question’s documents read as text', 'questions’ documents read as text')} />
        <Row id="tare" name="Tare" saving={t.tare} figure={<Tokens n={t.tare.total} />}
          what={many(t.tare.answers, 'question trimmed before the model read it', 'questions trimmed before the model read it')} />
      </dl>
      <p data-testid="chat-savings-total" className="mt-2 text-caption text-muted">
        In all: <Lxc ulxc={t.cache.total + t.pool.total} /> saved, and <Tokens n={t.conversion.total + t.tare.total} /> fewer sent to the model.
      </p>
    </section>
  )
}
