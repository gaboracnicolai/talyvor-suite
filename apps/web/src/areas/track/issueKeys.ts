import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// B4.3 — the issue list without a mouse, on the keys Linear users already have in their fingers:
//
//   c        new issue      — the caret goes into "Add to the tracker"'s title
//   /        search         — the caret goes into the area's Search issues box
//   j / k    next / previous issue — moves FOCUS between the issue links, so Enter opens the one
//            under the focus ring natively and a screen reader announces each as it lands
//   e        edit           — opens the focused issue with its description editor already open
//   Esc      leave a field  — so the keys above work again without reaching for the mouse
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

/** Router state that tells IssueDetail to open its description editor on arrival. */
export interface IssueArrival {
  edit?: boolean
}

/** Mounted once for the whole Track area; each key is a no-op where its target is not on screen. */
export function useIssueListKeys() {
  const navigate = useNavigate()
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
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navigate])
}
