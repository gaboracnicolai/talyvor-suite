import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, focusRing, inlineLink } from '@talyvor/ui'

import { usePromptLibrary } from './PromptChoice'
import { type ChatPrompt, PROMPTS_KEY, PROMPT_NAME_PATTERN, PromptLibraryError, savePrompt } from './promptLibrary'

// B28.370 — the prompt library: the workspace's named prompts, kept in Lens, linked from Chat's rail. A prompt saved
// here can be chosen under Chat's box, or opened in a new chat from its card; every question in that chat is sent with
// the prompt's name, and Lens swaps in its text.

export function PromptsPage() {
  const library = usePromptLibrary()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const prompts = library.data ?? []
  const taken = prompts.some((p) => p.name === name)
  const nameWrong = name !== '' && !PROMPT_NAME_PATTERN.test(name)

  const save = useMutation({
    mutationFn: () => savePrompt(name, content.trim(), description.trim()),
    onSuccess: (saved) => {
      qc.setQueryData<ChatPrompt[]>(PROMPTS_KEY, (list) => [...(list ?? []).filter((p) => p.name !== saved.name), saved].sort((a, b) => a.name.localeCompare(b.name)))
      setName('')
      setDescription('')
      setContent('')
      setSaid(`Saved ${saved.name}. Choose it under Chat’s box, or open it in a new chat.`)
    },
    onError: (e) => setSaid(e instanceof PromptLibraryError ? e.message : 'Lens did not save the prompt just now.'),
  })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      {/* The page's name is the console banner's <h1> (CONSOLE_ROUTES' title), so no second one here. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body text-muted">
          Prompts your workspace keeps by name — a support tone, a review checklist, a house style. Use one in any chat and
          every question in it is sent with the prompt as it reads now, for everyone in the workspace.
        </p>
        <Link className={`text-body text-ink ${inlineLink}`} to="/chat">
          Back to Chat
        </Link>
      </div>

      <section aria-labelledby="prompts-saved" className="flex flex-col gap-3">
        <h2 id="prompts-saved" className="font-figure text-eyebrow uppercase text-label">
          Your prompts
        </h2>
        {library.isPending ? (
          <p className="text-body text-muted">Reading your prompts…</p>
        ) : library.isError ? (
          <p className="text-body text-ink" role="alert">
            {library.error instanceof PromptLibraryError ? library.error.message : 'Your prompts could not be read just now.'}
          </p>
        ) : prompts.length === 0 ? (
          <p className="text-body text-muted">No prompts yet. Add one below, then choose it under Chat’s box.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {prompts.map((p) => (
              <li key={p.name} className="flex flex-col gap-2 rounded-card border border-rule bg-raised p-4" data-testid="prompt-card">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0 break-all font-figure text-body font-medium text-ink">
                    {p.name} <span className="font-normal text-muted">v{p.version}</span>
                  </p>
                  <Link className={`text-caption text-ink ${inlineLink}`} to={`/chat?prompt=${encodeURIComponent(p.name)}`}>
                    Use in a new chat
                  </Link>
                </div>
                {p.description !== '' ? <p className="text-caption text-muted">{p.description}</p> : null}
                <p className="line-clamp-4 whitespace-pre-wrap text-caption text-ink">{p.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form
        className="flex flex-col gap-3 rounded-card border border-rule bg-raised p-4"
        aria-labelledby="prompts-new"
        onSubmit={(e) => {
          e.preventDefault()
          setSaid(null)
          save.mutate()
        }}
      >
        <h2 id="prompts-new" className="font-figure text-eyebrow uppercase text-label">
          Save a prompt
        </h2>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">Name</span>
          <Input
            className="font-figure"
            placeholder="support-tone"
            value={name}
            maxLength={64}
            onChange={(e) => {
              setName(e.target.value)
              setSaid(null)
            }}
          />
          {nameWrong ? (
            <span className="text-caption text-ink">Letters, digits, dots, dashes and underscores only, without spaces.</span>
          ) : taken ? (
            <span className="text-caption text-ink">Your workspace already has a prompt called {name}.</span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">What it is for (optional)</span>
          <Input placeholder="Replies to customers" value={description} maxLength={512} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">Prompt</span>
          <textarea
            className={`min-h-40 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            placeholder="For example: You answer customers of a small design studio. Be warm, brief and exact; never promise a date."
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setSaid(null)
            }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending || name === '' || nameWrong || taken || content.trim() === ''}>
            {save.isPending ? 'Saving…' : 'Save prompt'}
          </Button>
          {said !== null ? (
            <p className="text-caption text-muted" role="status">
              {said}
            </p>
          ) : null}
        </div>
      </form>
    </div>
  )
}
