import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { Input, cn, focusRing } from '@talyvor/ui'

import type { ChatModel, PickerCatalog } from './chatApi'
import { formatUsdPer1M } from './price'

// B10.4 — every priced model in Lens's catalog, grouped by provider, newest first, with a search box,
// in a panel of fixed height that scrolls inside itself and so never covers the page.
//
// The listbox pattern: focus stays in the search box, arrow keys move the active option
// (aria-activedescendant), Enter picks it, Escape closes. Models whose stream this client cannot
// read are listed but not selectable, with the reason once per provider.

export function ModelPicker({
  catalog,
  selected,
  onSelect,
  disabled,
}: {
  catalog: PickerCatalog
  selected: ChatModel | undefined
  onSelect: (id: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listId = useId()

  const q = query.trim().toLowerCase()
  const groups = useMemo(
    () =>
      catalog.groups
        .map((g) => ({
          ...g,
          models: g.models.filter(
            (m) => q === '' || `${m.display_name} ${m.id} ${g.label}`.toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.models.length > 0),
    [catalog.groups, q],
  )
  const choosable = useMemo(() => groups.filter((g) => g.streamable).flatMap((g) => g.models), [groups])

  // Outside a click, the panel closes.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // The active option follows the filter: the selected model if it is still shown, else the first.
  useEffect(() => {
    if (!open) return
    setActive((cur) =>
      cur !== null && choosable.some((m) => m.id === cur)
        ? cur
        : (choosable.find((m) => m.id === selected?.id) ?? choosable[0])?.id ?? null,
    )
  }, [open, choosable, selected?.id])

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open || active === null) return
    const el = document.getElementById(`${listId}-${active}`)
    if (el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  const close = () => {
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }
  const pick = (id: string) => {
    onSelect(id)
    close()
  }

  return (
    // ⚠ NOT `relative`: the panel is positioned against the whole composer (Chat.tsx's form), so it
    // is as wide as the message box allows rather than as narrow as this trigger.
    <div ref={rootRef} className="min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected === undefined ? 'Choose a model' : `Model: ${selected.display_name}`}
        // No default means nothing to offer: the catalog is still loading, empty, or unreadable —
        // and the chat's main column says which. The picker itself never reads the catalog.
        disabled={disabled || catalog.defaultModel === undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          'inline-flex h-8 max-w-60 items-center gap-1 rounded-control px-2 text-caption text-muted',
          'transition-colors duration-200 hover:text-ink disabled:opacity-50',
          focusRing,
        )}
      >
        <span className="truncate">{selected?.display_name ?? 'Choose a model'}</span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 7.5 6 4.5l3 3" />
        </svg>
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-2 flex h-80 w-full max-w-sm flex-col overflow-hidden rounded-card border border-rule bg-surface">
          <div className="border-b border-rule p-2">
            <Input
              autoFocus
              value={query}
              placeholder="Search models"
              aria-label="Search models"
              aria-controls={listId}
              aria-activedescendant={active === null ? undefined : `${listId}-${active}`}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  close()
                  return
                }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  if (choosable.length > 0) {
                    const at = choosable.findIndex((m) => m.id === active)
                    const step = e.key === 'ArrowDown' ? 1 : -1
                    setActive(choosable[(at + step + choosable.length) % choosable.length].id)
                  }
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (active !== null) pick(active)
                }
              }}
            />
          </div>
          <div id={listId} role="listbox" aria-label="Models" className="min-h-0 flex-1 overflow-y-auto py-1">
            {/* The panel opens only over a loaded catalog, so an empty list here is the search's. */}
            {groups.length > 0 ? (
              groups.map((g) => (
                <div key={g.provider} role="group" aria-label={g.label}>
                  <p className="px-3 pb-1 pt-2 text-caption text-muted">{g.label}</p>
                  {g.streamable ? null : (
                    <p className="px-3 pb-1 text-caption text-faint">
                      Not in chat yet: Lens streams OpenAI and Anthropic formats only.
                    </p>
                  )}
                  {g.models.map((m) => {
                    const isActive = m.id === active
                    return (
                      <div
                        key={m.id}
                        id={`${listId}-${m.id}`}
                        role="option"
                        aria-selected={m.id === selected?.id}
                        aria-disabled={!g.streamable}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => g.streamable && setActive(m.id)}
                        onClick={() => g.streamable && pick(m.id)}
                        className={cn(
                          'flex items-baseline justify-between gap-3 px-3 py-1.5 text-body',
                          g.streamable ? 'cursor-pointer text-ink' : 'cursor-not-allowed text-faint',
                          isActive ? 'bg-canvas' : undefined,
                        )}
                      >
                        <span className="truncate">
                          {m.display_name}
                          {m.id === selected?.id ? <span className="sr-only"> (selected)</span> : null}
                        </span>
                        <span className="shrink-0 font-figure text-caption text-faint">
                          {formatUsdPer1M(m.input_per_1m)} / {formatUsdPer1M(m.output_per_1m)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))
            ) : (
              <p className="px-3 py-2 text-caption text-muted">No model matches &ldquo;{query}&rdquo;.</p>
            )}
          </div>
          <p className="border-t border-rule px-3 py-2 text-caption text-faint">
            Price per 1M tokens, in / out.
            {catalog.omitted > 0 ? (
              <>
                {' '}
                <span className="font-figure">{catalog.omitted}</span> retired or non-chat catalog entr
                {catalog.omitted === 1 ? 'y' : 'ies'} not listed.
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  )
}
