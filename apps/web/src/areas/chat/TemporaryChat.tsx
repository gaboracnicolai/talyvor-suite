import { cn, focusRing } from '@talyvor/ui'

// B28.131 — temporary chat. Turned on, Chat starts a new conversation that is kept nowhere: not in this browser's
// history (history.ts), so not in its synced copy either, and nothing it is told to remember. Each question goes with
// chatApi.ts CACHE_STORE_HEADER `off` and `X-Talyvor-Cache: bypass`: the model answers it afresh, never from an earlier
// or a shared answer, and Lens keeps nothing of the answer to serve again. Leaving it — New chat, another conversation,
// a reload, or the switch — leaves nothing behind.

/** The switch beside the conversation's name: on, a new temporary chat; off, a new chat that is kept. */
export function TemporaryChatToggle({ on, onChange, disabled }: { on: boolean; onChange: (on: boolean) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title="Temporary chat"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-caption transition-colors duration-200 disabled:opacity-50',
        // On, the accent tint the sidebar's active item sits on; ink on it, since accent text on the tint is under AA in light.
        on ? 'bg-accent-tint text-ink' : 'text-muted hover:text-ink',
        focusRing,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 4v-4h-.5A1.5 1.5 0 0 1 4 14.5z" strokeDasharray="3 2.6" />
      </svg>
      Temporary chat
    </button>
  )
}

/** Over a temporary chat: what is not kept. */
export function TemporaryChatNotice() {
  return (
    <div className="mt-4 rounded-card border border-dashed border-rule-strong px-4 py-3" role="note" data-testid="temporary-chat-notice">
      <p className="text-body font-medium text-ink">Temporary chat</p>
      <p className="mt-1 text-caption text-muted">
        Nothing in it is saved in this browser, and nothing you ask it to remember is kept. Every answer comes from the
        model: never one of your earlier answers or a shared answer, and never kept to be served again. It is gone when
        you leave it.
      </p>
    </div>
  )
}
