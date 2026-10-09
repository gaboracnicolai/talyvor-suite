import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { Input, cn, focusRing, useTheme } from '@talyvor/ui'

import { type ChatAction, chatActionHref } from '../areas/chat/chatActions'

// B28.135 — THE COMMAND PALETTE AND THE KEYBOARD SHORTCUTS, on every screen behind the gate.
//
// Ctrl+K (Cmd+K on a Mac) opens the palette: a new chat, a search of the conversations, the model picker, the theme,
// this list of shortcuts, and every page of the console by its title. Typing filters them; words that match nothing
// still search the conversations for them. Ctrl+/ opens the list of shortcuts.
//
// Chat's three are an address (chatActions.ts), so they work from any screen: the palette goes to Chat, and Chat does
// what it was asked once it knows who is signed in.

/** On a Mac the modifier is Command, elsewhere Control; either is taken on both, as Chat's Cmd+Shift+S always has. */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export type ShortcutId = 'palette' | 'new-chat' | 'search' | 'rail' | 'shortcuts' | 'close'

export interface Shortcut {
  id: ShortcutId
  /** The keys in the order they are held; 'Mod' is Cmd on a Mac and Ctrl elsewhere. */
  keys: readonly string[]
  label: string
}

/**
 * Every shortcut, in one table: the list Ctrl+/ opens is drawn from it, and the keys this component handles are
 * matched against it. Cmd+Shift+S is Chat's own (B15.5) and Esc each dialog's; they are listed here so the list is whole.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'palette', keys: ['Mod', 'K'], label: 'Open the command palette' },
  { id: 'new-chat', keys: ['Mod', 'Shift', 'O'], label: 'New chat' },
  { id: 'search', keys: ['/'], label: 'Search conversations, when not typing' },
  { id: 'rail', keys: ['Mod', 'Shift', 'S'], label: 'Show or hide the conversations, in Chat' },
  { id: 'shortcuts', keys: ['Mod', '/'], label: 'Show keyboard shortcuts' },
  { id: 'close', keys: ['Esc'], label: 'Close the palette or this list' },
]

const HANDLED: ReadonlySet<ShortcutId> = new Set(['palette', 'new-chat', 'search', 'shortcuts'])

/** A key as the shortcut table names it, in the words this platform uses. */
function keyLabel(key: string): string {
  if (key === 'Mod') return MAC ? 'Cmd' : 'Ctrl'
  return key
}

/** For a control's aria-keyshortcuts: both modifiers, since both are taken. */
export function ariaKeys(id: ShortcutId): string {
  const keys = SHORTCUTS.find((s) => s.id === id)?.keys ?? []
  if (!keys.includes('Mod')) return keys.join('+')
  return ['Meta', 'Control'].map((m) => keys.map((k) => (k === 'Mod' ? m : k)).join('+')).join(' ')
}

/** The shortcut as a tooltip writes it, e.g. "Ctrl+K". */
export function shortcutText(id: ShortcutId): string {
  return (SHORTCUTS.find((s) => s.id === id)?.keys ?? []).map(keyLabel).join('+')
}

function pressed(s: Shortcut, e: KeyboardEvent): boolean {
  const key = s.keys[s.keys.length - 1]
  if (s.keys.includes('Mod') !== (e.metaKey || e.ctrlKey) || e.altKey) return false
  // A letter by the key it types, or by where it sits when the layout types another script.
  if (/^[A-Z]$/.test(key)) {
    if (s.keys.includes('Shift') !== e.shiftKey) return false
    return e.key.toUpperCase() === key || (!/^[a-z]$/i.test(e.key) && e.code === `Key${key}`)
  }
  // A symbol is typed with Shift on some layouts (/ is Shift+7 on a German keyboard), so Shift is not asked of it.
  return e.key === key
}

/** A key pressed in a text field is the person's typing, not a shortcut, unless it holds the modifier. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type)
}

/** A page the palette opens: one of the console's routes, by the title its top bar shows. */
export interface PalettePage {
  path: string
  title: string
}

interface Command {
  id: string
  label: string
  group: 'Actions' | 'Pages' | 'Conversations'
  /** Other words it is found by. */
  words?: string
  shortcut?: ShortcutId
  run: () => void
}

export function CommandPalette({ pages }: { pages: readonly PalettePage[] }) {
  const [shown, setShown] = useState<'palette' | 'shortcuts' | null>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const theme = useTheme((s) => s.theme)
  const toggleTheme = useTheme((s) => s.toggle)
  const close = useCallback(() => setShown(null), [])

  const toChat = useCallback(
    (action: ChatAction, q = '') => {
      setShown(null)
      // In Chat already, the address is replaced: another entry for the same screen would make Back do nothing.
      navigate(chatActionHref(action, q), { replace: pathname === '/chat' })
    },
    [navigate, pathname],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const hit = SHORTCUTS.find((s) => HANDLED.has(s.id) && pressed(s, e))
      if (hit === undefined || (!hit.keys.includes('Mod') && typing(e.target))) return
      e.preventDefault()
      if (hit.id === 'palette') setShown((s) => (s === 'palette' ? null : 'palette'))
      else if (hit.id === 'shortcuts') setShown((s) => (s === 'shortcuts' ? null : 'shortcuts'))
      else if (hit.id === 'new-chat') toChat('new')
      else toChat('search')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toChat])

  const commands = useMemo<Command[]>(
    () => [
      { id: 'new-chat', label: 'New chat', group: 'Actions', words: 'start conversation', shortcut: 'new-chat', run: () => toChat('new') },
      { id: 'search', label: 'Search conversations', group: 'Actions', words: 'find history', shortcut: 'search', run: () => toChat('search') },
      { id: 'model', label: 'Switch model', group: 'Actions', words: 'change choose pick', run: () => toChat('model') },
      {
        id: 'theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        words: 'appearance colour color mode',
        run: () => {
          setShown(null)
          toggleTheme()
        },
      },
      { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Actions', words: 'keys help', shortcut: 'shortcuts', run: () => setShown('shortcuts') },
      ...pages.map<Command>((p) => ({
        id: `page:${p.path}`,
        label: p.title,
        group: 'Pages',
        words: `go to open ${p.path}`,
        run: () => {
          setShown(null)
          navigate(p.path)
        },
      })),
    ],
    [pages, theme, toChat, toggleTheme, navigate],
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setShown('palette')}
        aria-label="Command palette"
        aria-keyshortcuts={ariaKeys('palette')}
        title={`Command palette (${shortcutText('palette')})`}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-control border border-rule bg-surface',
          'text-muted transition-colors duration-200 hover:border-rule-strong hover:text-ink',
          'active:scale-98',
          focusRing,
        )}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      </button>
      {shown === 'palette' ? (
        <Palette commands={commands} onSearch={(q) => toChat('search', q)} onClose={close} />
      ) : shown === 'shortcuts' ? (
        <ShortcutList onClose={close} />
      ) : null}
    </>
  )
}

/** The frame both dialogs share: over the page, near its top, focus handed back to whatever had it when closed. */
function Overlay({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    return () => {
      if (opener !== null && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center px-gutter pt-20">
      <button type="button" tabIndex={-1} aria-label={`Close ${label.toLowerCase()}`} className="absolute inset-0 bg-canvas opacity-80" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={label} className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-card border border-rule bg-surface">
        {children}
      </div>
    </div>
  )
}

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k) => (
        <kbd key={k} className="rounded-control border border-rule px-1.5 font-figure text-caption text-muted">
          {keyLabel(k)}
        </kbd>
      ))}
    </span>
  )
}

function Palette({ commands, onSearch, onClose }: { commands: readonly Command[]; onSearch: (q: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()

  const found = useMemo<Command[]>(() => {
    const q = query.trim()
    const words = q.toLowerCase().split(/\s+/).filter((w) => w !== '')
    const hits = commands.filter((c) => words.every((w) => `${c.label} ${c.words ?? ''}`.toLowerCase().includes(w)))
    if (q === '') return hits
    return [...hits, { id: 'search-for', label: `Search conversations for “${q}”`, group: 'Conversations', run: () => onSearch(q) }]
  }, [commands, query, onSearch])
  const at = Math.min(active, found.length - 1)
  const groups = (['Actions', 'Pages', 'Conversations'] as const)
    .map((g) => ({ group: g, rows: found.filter((c) => c.group === g) }))
    .filter((g) => g.rows.length > 0)
  const optionId = (c: Command) => `${listId}-${c.id}`

  // Keep the active option in view while arrowing through the pages.
  useEffect(() => {
    const el = found[at] === undefined ? null : document.getElementById(optionId(found[at]))
    if (el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  })

  return (
    <Overlay label="Command palette" onClose={onClose}>
      <div className="border-b border-rule p-2">
        <Input
          autoFocus
          role="combobox"
          aria-expanded={true}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={found[at] === undefined ? undefined : optionId(found[at])}
          aria-label="Type a command or a page"
          placeholder="Type a command or a page"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const step = e.key === 'ArrowDown' ? 1 : -1
              setActive((at + step + found.length) % found.length)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              found[at]?.run()
            } else if (e.key === 'Tab') {
              // The one field in a modal dialog: Tab stays in it rather than reaching the page behind.
              e.preventDefault()
            }
          }}
        />
      </div>
      <div id={listId} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto py-1">
        {groups.map(({ group, rows }) => (
          <div key={group} role="group" aria-label={group}>
            <p className="px-3 pb-1 pt-2 font-figure text-eyebrow uppercase text-label">{group}</p>
            {rows.map((c) => {
              const i = found.indexOf(c)
              const shortcut = SHORTCUTS.find((s) => s.id === c.shortcut)
              return (
                <div
                  key={c.id}
                  id={optionId(c)}
                  role="option"
                  aria-selected={i === at}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => i !== at && setActive(i)}
                  onClick={() => c.run()}
                  className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-body text-ink', i === at && 'bg-canvas')}
                >
                  <span className="min-w-0 truncate">{c.label}</span>
                  {shortcut !== undefined ? <Keys keys={shortcut.keys} /> : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <p className="border-t border-rule px-3 py-2 text-caption text-faint">Enter to choose · Esc to close</p>
    </Overlay>
  )
}

function ShortcutList({ onClose }: { onClose: () => void }) {
  const headingId = useId()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <Overlay label="Keyboard shortcuts" onClose={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
        <h2 id={headingId} className="text-body font-medium text-ink">
          Keyboard shortcuts
        </h2>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className={cn('rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink', focusRing)}
        >
          Close
        </button>
      </div>
      <ul aria-labelledby={headingId} className="divide-y divide-rule">
        {SHORTCUTS.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-body text-ink">
            <span className="min-w-0">{s.label}</span>
            <Keys keys={s.keys} />
          </li>
        ))}
      </ul>
    </Overlay>
  )
}
