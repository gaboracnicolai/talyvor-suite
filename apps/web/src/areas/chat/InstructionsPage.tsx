import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, focusRing, inlineLink } from '@talyvor/ui'

import { useAuthMeReader } from '../../lib/authMe'
import { loadCustomInstructions, saveCustomInstructions } from './customInstructions'

// B28.115 — custom instructions: what the person tells the model in every chat, written once here and linked from
// Chat's rail. Chat reads them when a question is asked (Chat.tsx run()), so a chat started after saving is sent
// with them from its first question.

export function InstructionsPage() {
  // Scoped to who is signed in, exactly as Chat.tsx scopes the conversations; until that is known there is nowhere
  // to keep them.
  const me = useAuthMeReader()
  const scope = me.data?.user?.sub ?? me.data?.workspace_id ?? (me.data?.mode === 'disabled' ? 'local' : null)
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState('')
  const [unreadable, setUnreadable] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    if (scope === null) return
    const read = loadCustomInstructions(scope)
    setDraft(read.text)
    setSaved(read.text)
    setUnreadable(read.error)
  }, [scope])

  const write = (text: string) => {
    if (scope === null) return
    if (!saveCustomInstructions(scope, text, Date.now())) {
      setSaid('This browser refused to save them, so new chats are sent without them.')
      return
    }
    setDraft(text.trim())
    setSaved(text.trim())
    setUnreadable(null)
    setSaid(text.trim() === '' ? 'Cleared. New chats are sent without custom instructions.' : 'Saved. Every new chat is sent with them.')
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      {/* The page's name is the console banner's <h1> (CONSOLE_ROUTES' title), so no second one here. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body text-muted">
          What to tell the model in every chat — how to answer, in which language, what to know about you. Every question
          you ask in Chat is sent with them, in a new chat or one you carry on. A project’s own instructions come after them.
        </p>
        <Link className={`text-body text-ink ${inlineLink}`} to="/chat">
          Back to Chat
        </Link>
      </div>

      {me.isPending ? (
        <p className="text-body text-muted">Reading who is signed in…</p>
      ) : scope === null ? (
        <p className="text-body text-ink" role="alert">
          Who is signed in could not be read, so there is nowhere to keep custom instructions.
        </p>
      ) : (
        <form
          className="flex flex-col gap-3 rounded-card border border-rule bg-raised p-4"
          onSubmit={(e) => {
            e.preventDefault()
            write(draft)
          }}
        >
          {unreadable !== null ? (
            <p className="text-body text-ink" role="alert">
              {unreadable} Saving here replaces them.
            </p>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">Custom instructions</span>
            <textarea
              className={`min-h-40 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              placeholder="For example: Answer in French. I run a small design studio; keep answers short."
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setSaid(null)
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={draft.trim() === saved}>
              Save instructions
            </Button>
            {saved !== '' ? <Button onClick={() => write('')}>Clear</Button> : null}
            {said !== null ? (
              <p className="text-caption text-muted" role="status">
                {said}
              </p>
            ) : null}
          </div>
          <p className="text-caption text-muted">Kept in this browser only, with your conversations.</p>
        </form>
      )}
    </div>
  )
}
