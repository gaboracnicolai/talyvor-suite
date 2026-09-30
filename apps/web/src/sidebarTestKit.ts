import { fireEvent } from '@testing-library/react'

/**
 * B24.1 — the sidebar starts folded to its group titles, with only the current page's group open.
 * A test reaches a link the way a person does: by pressing the title that holds it.
 */

/** The group titles that are folded right now. */
function foldedTitles(nav: HTMLElement): HTMLButtonElement[] {
  return Array.from(nav.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]'))
}

function linkTo(nav: HTMLElement, path: string): HTMLAnchorElement | undefined {
  return Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
    (a) => new URL(a.href, window.location.origin).pathname === path,
  )
}

/** Presses every folded title, so every link the sidebar offers is on screen. */
export function openEveryGroup(nav: HTMLElement): void {
  for (const title of foldedTitles(nav)) fireEvent.click(title)
}

/**
 * The sidebar's link to `path`, after pressing AT MOST ONE title — B8.1's rule is that every page
 * is two clicks away: its group's title, then the link. A title that turns out not to hold the link
 * is folded again, so the sidebar is left with exactly one more group open than it started with.
 */
export function revealLink(nav: HTMLElement, path: string): HTMLAnchorElement {
  const shown = linkTo(nav, path)
  if (shown) return shown
  for (const title of foldedTitles(nav)) {
    fireEvent.click(title)
    const link = linkTo(nav, path)
    if (link) return link
    fireEvent.click(title)
  }
  throw new Error(`no group title in the sidebar opens a link to ${path}`)
}
