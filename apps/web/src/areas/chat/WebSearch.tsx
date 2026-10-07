import { cn, focusRing, inlineLink } from '@talyvor/ui'

import { Card } from '../lens/walletBrand'
import type { Citation } from './chatStream'

// B28.372 — web search with citations. With Search the web on, a question goes with chatApi.ts WEB_SEARCH_HEADER and
// Lens searches before the model answers (talyvor-lens B28.118). The pages it gave the model come back in the stream
// (chatStream.ts CITATIONS_FRAME), numbered as the answer cites them, and are listed under the answer.

/** The composer's switch: on, every question is answered from a web search, until it is turned off. */
export function WebSearchToggle({ on, onChange, disabled }: { on: boolean; onChange: (on: boolean) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title="Search the web"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-caption transition-colors duration-200 disabled:opacity-50',
        // On, the accent tint the sidebar's active item sits on; ink on it, since accent text on the tint is under AA in light.
        on ? 'bg-accent-tint text-ink' : 'text-muted hover:text-ink',
        focusRing,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z" />
      </svg>
      {/* On a phone the composer's row has room for the globe only; its name stays for a screen reader. */}
      <span className="sr-only sm:not-sr-only">Search the web</span>
    </button>
  )
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Under an answer asked with Search the web on: the pages it cites, each a link that opens the page. */
export function Sources({ citations }: { citations: Citation[] }) {
  if (citations.length > 0) return <SourceList citations={citations} />
  // Asked with Search the web on and no page came back: said, so the answer is not taken for one cited from the web.
  return (
    <p className="mt-3 text-caption text-muted" data-testid="turn-sources-none">
      Search the web was on, but no web pages came back with this answer.
    </p>
  )
}

function SourceList({ citations }: { citations: Citation[] }) {
  return (
    <Card className="mt-3 px-4 py-3">
      <nav aria-label="Sources this answer cites" data-testid="turn-sources">
        <p className="font-figure text-eyebrow uppercase text-label">Sources from the web</p>
        <ol className="mt-2 flex flex-col gap-1.5">
          {citations.map((c) => (
            <li key={c.n} className="flex min-w-0 gap-2 text-caption text-muted">
              <span className="shrink-0 font-figure text-label">[{c.n}]</span>
              <span className="min-w-0 break-words">
                <a className={inlineLink} href={c.url} target="_blank" rel="noopener noreferrer" data-testid="turn-source">
                  {c.title ?? host(c.url)}
                </a>
                {c.title !== undefined ? <span> · {host(c.url)}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </nav>
    </Card>
  )
}
