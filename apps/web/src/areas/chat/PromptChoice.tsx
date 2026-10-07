import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { cn, focusRing, inlineLink } from '@talyvor/ui'

import type { AnswerPrompt } from './chatApi'
import { type ChatPrompt, PROMPTS_KEY, fetchPrompts } from './promptLibrary'

// B28.370 — which named prompt a conversation uses. "Prompt", under the composer, names one from the workspace's
// library (/chat/prompts) or none; the choice is kept with the conversation (history.ts) and every question in it is
// sent with the prompt's name for Lens to swap in. Under each answer the screen says it was used only as Lens's
// answer says it.

/** The workspace's prompts, read with the library page's query. */
export function usePromptLibrary(): UseQueryResult<ChatPrompt[]> {
  return useQuery({ queryKey: PROMPTS_KEY, queryFn: fetchPrompts, retry: false, staleTime: 60_000 })
}

export function PromptPicker({
  library,
  value,
  onChange,
  disabled,
}: {
  library: UseQueryResult<ChatPrompt[]>
  /** The chosen prompt's name; '' is none. */
  value: string
  onChange: (name: string) => void
  disabled: boolean
}) {
  const prompts = library.data ?? []
  // A failed read is not "no prompts": a prompt chosen stands, and the line says it cannot be changed just now.
  if (library.isError && library.data === undefined) {
    return value === '' ? null : (
      <p className="text-caption text-muted">
        Prompt <span className="font-figure text-ink">{value}</span>. Your prompts could not be read just now, so it cannot be changed.
      </p>
    )
  }
  if (prompts.length === 0 && value === '') {
    return library.isSuccess ? (
      <Link className={`text-caption text-muted ${inlineLink}`} to="/chat/prompts">
        Save a prompt to use it here
      </Link>
    ) : null
  }
  const gone = value !== '' && library.isSuccess && !prompts.some((p) => p.name === value)
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="font-figure text-eyebrow uppercase text-label">Prompt</span>
      <select
        id="chat-prompt"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'min-w-0 max-w-48 rounded-control border border-rule bg-canvas px-2 py-1 font-figure text-caption text-ink',
          'transition-colors duration-200 hover:border-rule-strong disabled:opacity-50',
          focusRing,
        )}
      >
        <option value="">None</option>
        {prompts.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
        {value !== '' && !prompts.some((p) => p.name === value) ? <option value={value}>{gone ? `${value} (no longer in the library)` : value}</option> : null}
      </select>
    </label>
  )
}

/** Under an answer in a conversation that uses a named prompt: whether Lens swapped it in. */
export function PromptLine({ prompt }: { prompt: AnswerPrompt }) {
  return (
    <p className="ml-1 w-full text-caption text-muted" data-testid="turn-prompt" data-resolved={prompt.resolved}>
      {prompt.resolved ? (
        <>
          Asked with the prompt{' '}
          <Link className={`font-figure ${inlineLink}`} to="/chat/prompts">
            {prompt.name}
          </Link>{' '}
          from your library
        </>
      ) : (
        <>
          Lens did not find the prompt <span className="font-figure text-ink">{prompt.name}</span>, so the model was sent its name, not its
          text.{' '}
          <Link className={inlineLink} to="/chat/prompts">
            Open the library
          </Link>
        </>
      )}
    </p>
  )
}
