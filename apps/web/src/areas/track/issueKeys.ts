import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../../lib/api'
import type { IssueStatus } from './types'

// B4.3 — the issue list without a mouse, on the keys Linear users already have in their fingers:
//
//   c        new issue      — the caret goes into "Add to the tracker"'s title
//   /        search         — the caret goes into the area's Search issues box
//   j / k    next / previous issue — moves FOCUS between the issue links, so Enter opens the one
//            under the focus ring natively and a screen reader announces each as it lands
//   e        edit           — opens the focused issue with its description editor already open
//   s        move           — B27.30: picks the focused issue's status (IssuePicker.tsx)
//   a        assign         — B27.30: picks who the focused issue is assigned to, or no one
//   x        close          — B27.30: marks the focused issue Done
//   Esc      leave a field  — so the keys above work again without reaching for the mouse
//
// s, a and x act on the focused issue link — on the list or the board — or, on an issue's own
// page, on that issue.
//
// Nothing fires while typing (an input, textarea, select or editable region has focus), on a
// filter's combobox or inside an open listbox, menu or dialog — whose own typeahead owns the
// letters — or with a modifier held,
// so Cmd-C and Ctrl-K stay the browser's.

/** The id of the area-level search input (SearchIssues.tsx), which `/` focuses. */
export const TRACK_SEARCH_INPUT_ID = 'track-search'

/** The id of the issue list's new-issue title input (IssueList.tsx), which `c` focuses. */
export const NEW_ISSUE_INPUT_ID = 'new-issue-title'

/** Marks a row's link as an issue for j/k, carrying the issue id `e` opens. */
export const ISSUE_LINK_ATTR = 'data-issue-link'

/** The issue's reference (TAL-12) on the same link, so s/a/x can say which issue they changed. */
export const ISSUE_REF_ATTR = 'data-issue-ref'

/** Router state that tells IssueDetail to open its description editor on arrival. */
export interface IssueArrival {
  edit?: boolean
}

export type PickerKind = 'status' | 'assignee'

/** The issue `s` or `a` opened a picker on. */
export interface PickerTarget {
  kind: PickerKind
  issueId: string
  /** What the reader sees the issue called — its reference, or its title when there is none. */
  name: string
}

/** The two edits the keys make — Track's PATCH takes either. */
export type IssuePatch = { status: IssueStatus } | { assignee_id: string | null }

/** PATCH one issue through the BFF. */
export async function patchIssue(id: string, body: IssuePatch): Promise<void> {
  const res = await fetch(`/api/track/issues/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, `/api/track/issues/${id}`)
}

/** Put the caret back on the issue that was acted on, wherever it is listed. */
export function refocusIssue(id: string) {
  document.querySelector<HTMLElement>(`a[${ISSUE_LINK_ATTR}="${CSS.escape(id)}"]`)?.focus()
}

/** The issue s/a/x act on: the focused issue link, else the issue whose page this is. */
function targetOf(t: HTMLElement | null, pathname: string): { id: string; name: string } | null {
  const id = t instanceof HTMLAnchorElement ? t.getAttribute(ISSUE_LINK_ATTR) : null
  if (id) {
    return { id, name: t?.getAttribute(ISSUE_REF_ATTR) || t?.textContent?.trim() || 'the issue' }
  }
  const page = pathname.match(/^\/track\/issues\/([^/]+)$/)
  return page ? { id: decodeURIComponent(page[1]), name: 'this issue' } : null
}

/**
 * Mounted once for the whole Track area; each key is a no-op where its target is not on screen.
 * Returns the open picker (TrackArea renders it) and the last thing a key did, for a live region.
 */
export function useIssueListKeys() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t && (t.isContentEditable || t.matches('input, textarea, select'))) {
        if (e.key === 'Escape') t.blur()
        return
      }
      if (t?.closest('[role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]')) return

      const links = [...document.querySelectorAll<HTMLAnchorElement>(`a[${ISSUE_LINK_ATTR}]`)]
      const at = t instanceof HTMLAnchorElement ? links.indexOf(t) : -1
      switch (e.key) {
        case 'c': {
          const title = document.getElementById(NEW_ISSUE_INPUT_ID)
          if (!title) return
          e.preventDefault()
          title.focus()
          return
        }
        case '/':
          e.preventDefault()
          document.getElementById(TRACK_SEARCH_INPUT_ID)?.focus()
          return
        case 'j':
        case 'k': {
          if (links.length === 0) return
          e.preventDefault()
          const next = e.key === 'j' ? Math.min(at + 1, links.length - 1) : Math.max(at - 1, 0)
          links[next].focus()
          return
        }
        case 'e': {
          const id = at >= 0 ? links[at].getAttribute(ISSUE_LINK_ATTR) : null
          if (!id) return
          e.preventDefault()
          const arrival: IssueArrival = { edit: true }
          navigate(`/track/issues/${id}`, { state: arrival })
          return
        }
        case 's':
        case 'a': {
          const target = targetOf(t, pathname)
          if (!target) return
          e.preventDefault()
          setPicker({ kind: e.key === 's' ? 'status' : 'assignee', issueId: target.id, name: target.name })
          return
        }
        case 'x': {
          const target = targetOf(t, pathname)
          if (!target) return
          e.preventDefault()
          patchIssue(target.id, { status: 'done' })
            .then(async () => {
              await Promise.all([
                qc.invalidateQueries({ queryKey: ['track', 'issues'] }),
                qc.invalidateQueries({ queryKey: ['track-issue', target.id] }),
              ])
              setNotice(`${target.name} closed.`)
              refocusIssue(target.id)
            })
            .catch(() => setNotice(`Couldn’t close ${target.name} — nothing was changed.`))
          return
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate, pathname, qc])

  return {
    picker,
    notice,
    closePicker: (done?: string) => {
      setPicker(null)
      if (done) setNotice(done)
    },
  }
}
