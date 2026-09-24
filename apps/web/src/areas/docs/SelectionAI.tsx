import { useMutation } from '@tanstack/react-query'
import { Button, Input } from '@talyvor/ui'
import { useState } from 'react'

import { docsApi } from './api'
import type { EditorSelection, SelectionControls } from './editor/DocEditor'

// AI IN THE EDITOR — B2.3. Every Docs AI operation that writes text, offered where the writing
// is: Write with AI from a prompt; and on a selection, shorten, lengthen and fix grammar
// (Transform's three rewrite actions, which had no button because there was nowhere to put their
// output until B2.1's editor), summarise and translate.
//
// ⚠ THE ANSWER IS A SUGGESTION, NOT AN EDIT. It is shown with Replace / Insert below / Discard,
// and nothing in the document changes until the writer picks one. Replace is refused if the
// selected words changed while the model was answering — see SelectionControls.replace.
//
// ⚠ WHAT IT COSTS, SAID BEFORE THE CLICK AND AGAIN AFTER. Each is a metered Lens completion that
// names this page, so Docs attributes the charge to it under the operation's own feature tag
// (internal/ai/engine.go), and the pinned readout (B2.2) moves when Docs prices it. The response
// carries no figure, so the sentences say where the charge lands and show none — the rule
// AskAI.tsx and PageSummary.tsx follow, held by meteredCostCensus.test.tsx.

type Action = 'write' | 'shorter' | 'longer' | 'grammar' | 'summarize' | 'translate'

const TAG: Record<Action, string> = {
  write: 'docs-ai-write',
  shorter: 'docs-ai-shorter',
  longer: 'docs-ai-longer',
  grammar: 'docs-ai-grammar',
  summarize: 'docs-ai-summarize',
  translate: 'docs-ai-translate',
}

const NOUN: Record<Action, string> = {
  write: 'text',
  shorter: 'shortened text',
  longer: 'lengthened text',
  grammar: 'grammar fix',
  summarize: 'summary',
  translate: 'translation',
}

const ON_SELECTION = [
  ['shorter', 'Shorten'],
  ['longer', 'Lengthen'],
  ['grammar', 'Fix grammar'],
  ['summarize', 'Summarise'],
] as const

export function SelectionAI({
  pageId,
  controls,
  onSpent,
}: {
  pageId: string
  controls: SelectionControls
  onSpent: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [language, setLanguage] = useState('')
  const [result, setResult] = useState<{ action: Action; sel: EditorSelection; text: string } | null>(null)
  const [stale, setStale] = useState(false)

  const ask = useMutation({
    mutationFn: async ({ action, sel }: { action: Action; sel: EditorSelection }) => {
      const res =
        action === 'write'
          ? await docsApi.writeWithAI(pageId, prompt.trim(), controls.docText)
          : action === 'summarize'
            ? await docsApi.summarizePage(pageId, sel.text)
            : action === 'translate'
              ? await docsApi.translatePage(pageId, sel.text, language.trim())
              : await docsApi.rewriteSelection(pageId, action, sel.text)
      return { action, sel, text: res.text }
    },
    onSuccess: (r) => {
      setResult(r)
      setStale(false)
      onSpent()
    },
  })

  const sel = controls.selection !== null && controls.selection.text.trim() !== '' ? controls.selection : null
  const busy = ask.isPending
  const run = (action: Action) => {
    if (busy) return
    if (action === 'write') {
      if (prompt.trim() === '' || controls.cursor === null) return
      ask.mutate({ action, sel: { from: controls.cursor, to: controls.cursor, text: '' } })
      return
    }
    if (sel !== null) ask.mutate({ action, sel })
  }

  return (
    <div className="mt-2 border-t border-rule pt-2">
      {sel === null ? (
        <form
          className="flex flex-wrap items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            run('write')
          }}
        >
          <span className="min-w-0 flex-1">
            <Input
              aria-label="What to write"
              placeholder="Write with AI: say what you want"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </span>
          <Button type="submit" disabled={busy || prompt.trim() === ''}>
            Write
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="AI on the selection">
          {ON_SELECTION.map(([action, name]) => (
            <Button key={action} disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => run(action)}>
              {name}
            </Button>
          ))}
          {/* Input is w-full by design; the box around it sets the width. */}
          <span className="w-32">
            <Input
              aria-label="Translate into"
              placeholder="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            />
          </span>
          {/* No language, no call: upstream a blank language is a billed completion in English. */}
          <Button disabled={busy || language.trim() === ''} onClick={() => run('translate')}>
            Translate
          </Button>
        </div>
      )}

      {/* The price, where the reader meets the control — replaced by the receipt once an answer is
          on screen, as every censused card does: the future tense before, the past tense after. */}
      {result === null ? (
        <p className="mt-1 px-1 text-caption text-muted">
          {sel === null ? (
            <>
              Writing buys a metered Lens call billed to this workspace under <code>{TAG.write}</code>; Docs
              attributes it to this page, so it moves this page&rsquo;s own AI cost. Select text to shorten,
              lengthen, fix, summarise or translate it.
            </>
          ) : (
            <>
              Each buys a metered Lens call billed to this workspace under its own tag —{' '}
              {ON_SELECTION.map(([action]) => (
                <span key={action}>
                  <code>{TAG[action]}</code>,{' '}
                </span>
              ))}
              <code>{TAG.translate}</code> — attributed to this page, so it moves this page&rsquo;s own AI cost.
            </>
          )}
        </p>
      ) : null}

      {busy ? (
        <p className="mt-2 px-1 text-caption text-muted" role="status">
          Asking Docs…
        </p>
      ) : null}
      {ask.isError ? (
        <p className="mt-2 px-1 text-caption text-ink" role="alert">
          Docs couldn&rsquo;t answer that — nothing in the page changed.
        </p>
      ) : null}

      {result !== null ? (
        <div className="mt-2 max-h-60 overflow-y-auto rounded-control border border-rule bg-canvas px-3 py-2">
          <p className="text-caption text-muted">A suggestion — the page does not change until you apply it.</p>
          <p className="mt-1 whitespace-pre-wrap text-body text-ink" data-testid="ai-suggestion">
            {result.text}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {result.action !== 'write' ? (
              <Button
                variant="primary"
                onClick={() => {
                  if (controls.replace(result.sel, result.text)) setResult(null)
                  else setStale(true)
                }}
              >
                Replace selection
              </Button>
            ) : null}
            <Button
              variant={result.action === 'write' ? 'primary' : 'default'}
              onClick={() => {
                if (controls.insertAfter(result.sel, result.text)) setResult(null)
              }}
            >
              Insert below
            </Button>
            <Button onClick={() => setResult(null)}>Discard</Button>
          </div>
          <p className="mt-2 text-caption text-muted">
            This {NOUN[result.action]} was a metered Lens call billed to this workspace under{' '}
            <code>{TAG[result.action]}</code>; it moves this page&rsquo;s own AI cost when Docs prices it.
          </p>
          {stale ? (
            <p className="mt-2 text-caption text-ink" role="alert">
              The selected words changed after they were sent, so they aren&rsquo;t replaced. Insert the
              suggestion below them, or select the text again.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
