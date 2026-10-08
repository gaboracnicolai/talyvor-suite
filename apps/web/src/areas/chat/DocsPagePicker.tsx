import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Input, cn, focusRing } from '@talyvor/ui'

import { ApiError } from '../../lib/api'
import { docsApi } from '../docs/api'
import { type ChatAttachment, uploadDocument } from './chatApi'

// B28.375 — attach a Docs page as context. The composer's Docs page button lists the workspace's Docs spaces and their
// pages; the page chosen is read from Docs as it is stored and goes to Lens as a Markdown document (POST /api/documents),
// so the question references it by its tdoc_ id exactly as an attached file (B18.24): Lens turns it into text before the
// model reads it, and every later question in the conversation still carries it.

/** The Docs page an attachment was read from. */
export interface DocsPageRef {
  space_id: string
  page_id: string
}

/** The text a Docs page is attached as: its title as a heading, then its words as Docs stores them. */
export function docsPageText(title: string, text: string): string {
  return `# ${title}\n\n${text.trim()}\n`
}

/** Reads one Docs page and stores it in Lens as a document the question references. A refusal is an Error whose message
 *  is the sentence the composer shows. */
export async function attachDocsPage(spaceId: string, pageId: string, title: string): Promise<ChatAttachment> {
  let page: Awaited<ReturnType<typeof docsApi.page>>
  try {
    page = await docsApi.page(spaceId, pageId)
  } catch (e) {
    throw new Error(e instanceof ApiError && e.status === 503 ? 'Docs isn’t set up on this deployment.' : `${title} couldn’t be read from Docs.`)
  }
  const name = page.title.trim() === '' ? title : page.title
  const text = page.content_text ?? ''
  if (text.trim() === '') throw new Error(`${name} has no text to attach yet.`)
  const file = new File([docsPageText(name, text)], `${name}.md`, { type: 'text/markdown' })
  let id: string
  try {
    id = await uploadDocument(file, 'text/markdown')
  } catch (e) {
    const why = e instanceof Error && e.message !== '' ? e.message : 'try again.'
    throw new Error(`${name} couldn’t be attached: ${why}${/[.!?]$/.test(why) ? '' : '.'}`)
  }
  return { name, media_type: 'text/markdown', size: file.size, file_id: id, docs_page: { space_id: spaceId, page_id: pageId } }
}

/** The composer's Docs page button and the panel it opens: a space, its pages, and a filter over their titles. */
export function DocsPagePicker({ disabled, onPick }: { disabled: boolean; onPick: (spaceId: string, pageId: string, title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [spaceId, setSpaceId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const spaces = useQuery({ queryKey: ['docs', 'spaces'], queryFn: docsApi.spaces, enabled: open })
  const chosen = spaceId ?? spaces.data?.[0]?.id ?? null
  const pages = useQuery({
    queryKey: ['docs', 'pages', chosen],
    queryFn: () => docsApi.pages(chosen as string),
    enabled: open && chosen !== null,
  })

  // Outside a click, the panel closes, as the model picker's does.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }
  const q = query.trim().toLowerCase()
  const shown = (pages.data ?? []).filter((p) => q === '' || p.title.toLowerCase().includes(q))
  const failed = spaces.error ?? pages.error

  return (
    <div ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        title="Attach a Docs page"
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-200 hover:text-ink disabled:opacity-50',
          focusRing,
        )}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4M9 12h6M9 16h6" />
        </svg>
        {/* The composer's row has room for the page mark only, beside Search the web and Run code; its name stays for a
            screen reader, and the title says it on hover. */}
        <span className="sr-only">Docs page</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Attach a Docs page"
          className="absolute bottom-full left-0 z-20 mb-2 flex h-80 w-full max-w-sm flex-col overflow-hidden rounded-card border border-rule bg-surface"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        >
          <div className="border-b border-rule p-2">
            <Input autoFocus value={query} placeholder="Filter pages" aria-label="Filter pages" onChange={(e) => setQuery(e.target.value)} />
          </div>
          {(spaces.data ?? []).length > 1 ? (
            <div className="flex flex-wrap gap-1 border-b border-rule px-2 py-1.5" role="group" aria-label="Docs spaces">
              {(spaces.data ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={s.id === chosen}
                  onClick={() => setSpaceId(s.id)}
                  className={cn(
                    'rounded-control px-2 py-1 text-caption transition-colors duration-200',
                    s.id === chosen ? 'bg-accent-tint text-ink' : 'text-muted hover:text-ink',
                    focusRing,
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {failed !== null ? (
              <p className="px-3 py-2 text-caption text-ink" role="alert">
                {failed instanceof ApiError && failed.status === 503 ? 'Docs isn’t set up on this deployment.' : 'Docs couldn’t be read just now.'}
              </p>
            ) : spaces.isPending || (chosen !== null && pages.isPending) ? (
              <p className="px-3 py-2 text-caption text-muted">Loading pages…</p>
            ) : chosen === null ? (
              <p className="px-3 py-2 text-caption text-muted">There are no Docs spaces in this workspace yet.</p>
            ) : shown.length === 0 ? (
              <p className="px-3 py-2 text-caption text-muted">{q === '' ? 'This space has no pages yet.' : <>No page matches &ldquo;{query}&rdquo;.</>}</p>
            ) : (
              <ul aria-label="Docs pages">
                {shown.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={cn('block w-full truncate px-3 py-1.5 text-left text-body text-ink transition-colors duration-200 hover:bg-canvas', focusRing)}
                      onClick={() => {
                        onPick(chosen, p.id, p.title === '' ? 'Untitled' : p.title)
                        close()
                      }}
                    >
                      {p.title === '' ? 'Untitled' : p.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="border-t border-rule px-3 py-2 text-caption text-faint">The page goes with your question as it is saved in Docs.</p>
        </div>
      ) : null}
    </div>
  )
}
