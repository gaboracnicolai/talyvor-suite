import { useEffect } from 'react'

/**
 * THE NAME THE BROWSER GETS. See documentTitle.test.tsx for what was measured and where the
 * `<page> | <brand>` shape comes from (the marketing site's own titles, fetched, not chosen).
 *
 * ⚠ `BRAND` IS ALSO IN `index.html`, AND THAT IS NOT A DUPLICATE THAT CAN DRIFT: a full page load
 * paints the file's `<title>` before any JavaScript runs, so the two are the same string at two
 * instants of the same load. The test reads index.html and asserts they are equal.
 */
export const BRAND = 'Talyvor Suite'

/**
 * `null` means "this surface has no name of its own" — the front door — and takes the brand
 * alone, which is what the website does with its own home page. Every other caller passes a
 * string the product ALREADY paints, so this never invents a page name.
 */
export function documentTitle(pageName: string | null): string {
  return pageName ? `${pageName} | ${BRAND}` : BRAND
}

/**
 * Call from the component that RENDERS the surface, never from a router-level observer that has
 * to re-derive which surface won. Deriving it twice is the two-tables-that-must-agree defect
 * `ConsoleTitle.test.tsx` was written for; passing the same expression the surface paints makes
 * the tab and the screen one answer.
 *
 * Nothing is restored on unmount: in this app every unmount is a navigation, and the surface
 * arriving sets the title in the same commit. Restoring here would race with it.
 */
export function useDocumentTitle(pageName: string | null): void {
  useEffect(() => {
    document.title = documentTitle(pageName)
  }, [pageName])
}
