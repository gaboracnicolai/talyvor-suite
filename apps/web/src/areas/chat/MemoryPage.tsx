import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Switch, focusRing, formatDay, inlineLink } from '@talyvor/ui'

import { useAuthMeReader } from '../../lib/authMe'
import { Card } from '../lens/walletBrand'
import { type Memory, NO_MEMORY, forget, loadMemory, remember, saveMemory } from './memory'

// B28.371 — memory: what Chat remembers about the person, written by them ("Remember that …" in any chat, or here) and
// sent with every question once they turn it on. This page, linked from Chat's rail, lists every fact and deletes it.

/** What Chat remembers for whoever is signed in, and a change to it written to this browser. */
export function useChatMemory(scope: string | null) {
  const [memory, setMemory] = useState<Memory>(NO_MEMORY)
  useEffect(() => {
    if (scope !== null) setMemory(loadMemory(scope))
  }, [scope])
  // Changed from what storage holds now, not from state: another tab may have changed it since. False when the browser
  // refused the write, so the screen says nothing changed.
  const update = useCallback(
    (change: (m: Memory) => Memory): boolean => {
      if (scope === null) return false
      const next = { ...change(loadMemory(scope)), error: null }
      if (!saveMemory(scope, next)) return false
      setMemory(next)
      return true
    },
    [scope],
  )
  return { memory, update }
}

const REFUSED = 'This browser refused to save it, so nothing changed.'

export function MemoryPage() {
  // Scoped to who is signed in, exactly as Chat.tsx scopes the conversations.
  const me = useAuthMeReader()
  const scope = me.data?.user?.sub ?? me.data?.workspace_id ?? (me.data?.mode === 'disabled' ? 'local' : null)
  const { memory, update } = useChatMemory(scope)
  const [draft, setDraft] = useState('')
  const [said, setSaid] = useState<string | null>(null)

  const write = (change: (m: Memory) => Memory, done: string) => setSaid(update(change) ? done : REFUSED)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      {/* The page's name is the console banner's <h1> (CONSOLE_ROUTES' title), so no second one here. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body text-muted">
          Chat can remember what you tell it about yourself — your name, your work, how you like answers — and send it
          with every question, in every chat. It is off until you turn it on, and remembers only what you ask it to.
        </p>
        <Link className={`text-body text-ink ${inlineLink}`} to="/chat">
          Back to Chat
        </Link>
      </div>

      {me.isPending ? (
        <p className="text-body text-muted">Reading who is signed in…</p>
      ) : scope === null ? (
        <p className="text-body text-ink" role="alert">
          Who is signed in could not be read, so there is nowhere to keep what Chat remembers.
        </p>
      ) : (
        <>
          <section aria-label="Memory" className="flex flex-col gap-3 rounded-card border border-rule bg-raised p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-body text-ink">Remember what I ask Chat to remember</p>
                <p className="text-caption text-muted" data-testid="memory-state">
                  {memory.on
                    ? 'On. Every question you ask is sent with everything listed below. Say “Remember that …” in any chat to add to it.'
                    : 'Off. Nothing new is remembered, and no question is sent with what is listed below.'}
                </p>
              </div>
              <Switch
                checked={memory.on}
                onCheckedChange={(on) =>
                  write((m) => ({ ...m, on }), on ? 'Memory is on.' : 'Memory is off. What it holds is kept until you delete it.')
                }
                aria-label={`Memory: turn ${memory.on ? 'off' : 'on'}`}
              />
            </div>
            {memory.on ? (
              <form
                className="flex flex-col gap-2 wide:flex-row wide:items-end"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (draft.trim() === '') return
                  const fact = draft.trim()
                  write((m) => remember(m, fact, Date.now()), `Remembered. Every question is sent with it.`)
                  setDraft('')
                }}
              >
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-caption text-muted">Something to remember</span>
                  <input
                    className={`h-10 w-full rounded-control border border-rule bg-surface px-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                    placeholder="For example: I run a small design studio in Leeds."
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value)
                      setSaid(null)
                    }}
                  />
                </label>
                <Button type="submit" variant="primary" className="h-10" disabled={draft.trim() === ''}>
                  Remember
                </Button>
              </form>
            ) : null}
            {said !== null ? (
              <p className="text-caption text-muted" role="status">
                {said}
              </p>
            ) : null}
          </section>

          <section aria-label="What Chat remembers" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-body font-medium text-ink">What Chat remembers</h2>
              {memory.facts.length > 1 ? (
                <Button onClick={() => write((m) => ({ ...m, facts: [] }), 'Deleted everything. No question is sent with any of it.')}>
                  Delete everything
                </Button>
              ) : null}
            </div>
            {/* Unreadable is not the same as nothing remembered. */}
            {memory.error !== null ? (
              <p className="text-body text-ink" role="alert">
                {memory.error} Changing anything here replaces it.
              </p>
            ) : memory.facts.length === 0 ? (
              <p className="text-body text-muted" data-testid="memory-empty">
                Nothing yet.{memory.on ? ' Say “Remember that …” in any chat, or add it above.' : ''}
              </p>
            ) : (
              <ul className="flex flex-col" data-testid="memory-facts">
                {memory.facts.map((f) => (
                  <li key={f.id} className="flex items-start justify-between gap-4 border-t border-rule py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="break-words text-body text-ink">{f.text}</p>
                      <p className="text-caption text-muted">
                        Remembered <span className="font-figure">{formatDay(new Date(f.saved_at).toISOString())}</span>
                      </p>
                    </div>
                    <Button aria-label={`Delete “${f.text}”`} onClick={() => write((m) => forget(m, f.id), 'Deleted. No question is sent with it again.')}>
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-caption text-muted">Kept in this browser only, with your conversations.</p>
        </>
      )}
    </div>
  )
}

/**
 * B28.371 — "Remember that I run a design studio" typed in Chat: not sent to the model. With memory on, Chat has kept it
 * already (Chat.tsx send()) and this card says so, with a way to take it back; with memory off it was not kept, and the
 * card asks before keeping anything.
 */
export function RememberCard({
  fact,
  memory,
  onRemember,
  onForget,
  onClose,
}: {
  fact: string
  memory: Memory
  onRemember: (fact: string) => boolean
  onForget: (fact: string) => boolean
  onClose: () => void
}) {
  const kept = memory.on && memory.facts.some((f) => f.text.toLowerCase() === fact.toLowerCase())
  const [refused, setRefused] = useState(false)
  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-card-remember">
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-body text-ink" role="status" data-testid="chat-card-remember-state">
            {kept
              ? `Remembered: “${fact}”. Every question you ask is sent with it, in this chat and every new one.`
              : memory.on
                ? `Not remembered: “${fact}”. No question is sent with it.`
                : `Memory is off, so “${fact}” was not kept.`}
          </p>
          {refused ? <p className="text-caption text-muted">{REFUSED}</p> : null}
          <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
            {kept ? (
              <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={() => setRefused(!onForget(fact))}>
                Forget it
              </Button>
            ) : (
              <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={() => setRefused(!onRemember(fact))}>
                {memory.on ? 'Remember it' : 'Turn memory on and remember it'}
              </Button>
            )}
            <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
              Close
            </Button>
            <Link className={`${inlineLink} text-caption`} to="/chat/memory">
              Everything Chat remembers
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}
