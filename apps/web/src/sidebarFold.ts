import { useEffect, useState } from 'react'

/**
 * B24.1 — the sidebar folds to its group titles.
 *
 * Which groups are open is what the person last CHOSE, remembered in this browser, plus the group
 * holding the current page — that one is opened on load and on every navigation into it, so the
 * sidebar never hides where you are. Opening a group on navigation is not a choice and is not
 * written; only pressing a title or the fold-all control is.
 */
export const SIDEBAR_FOLD_KEY = 'talyvor.sidebar.open'

export type FoldState = Record<string, boolean>

function readStored(): FoldState {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(SIDEBAR_FOLD_KEY) ?? 'null')
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter(([, open]) => typeof open === 'boolean'))
  } catch {
    // Blocked or unreadable storage just means the default: every group folded but the current one.
    return {}
  }
}

function writeStored(next: FoldState): void {
  try {
    window.localStorage.setItem(SIDEBAR_FOLD_KEY, JSON.stringify(next))
  } catch {
    // A refused write leaves this tab working; the next load starts from the default.
  }
}

export function useSidebarFold(groups: readonly string[], current: string | undefined) {
  const [open, setOpen] = useState<FoldState>(() => {
    const stored = readStored()
    return current === undefined ? stored : { ...stored, [current]: true }
  })

  useEffect(() => {
    if (current !== undefined) setOpen((o) => (o[current] ? o : { ...o, [current]: true }))
  }, [current])

  const choose = (next: FoldState) => {
    setOpen(next)
    writeStored(next)
  }
  const anyOpen = groups.some((g) => open[g])

  return {
    /** The props a group title takes: whether it is open, and what pressing it does. */
    group: (group: string) => ({
      open: open[group] === true,
      onToggle: () => choose({ ...open, [group]: !open[group] }),
    }),
    /** Folds every group when any is open; opens every group when all are folded. */
    anyOpen,
    toggleAll: () => choose(Object.fromEntries(groups.map((g) => [g, !anyOpen]))),
  }
}
