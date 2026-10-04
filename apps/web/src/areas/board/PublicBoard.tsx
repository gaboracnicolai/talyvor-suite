import { useQuery } from '@tanstack/react-query'
import { Button, ThemeToggle, focusRing, inlineLink } from '@talyvor/ui'
import { useParams } from 'react-router-dom'
import { useDocumentTitle } from '../../documentTitle'
import { ApiError } from '../../lib/api'
import { BoardColumns } from '../track/BoardColumns'
import type { PublicBoardView } from '../track/types'

// B27.30 — a Track board a workspace owner published as a link, opened by anyone who has it,
// signed out. OUTSIDE the AuthGate (App.tsx) for the same reason as /pricing: the reader has no
// account. Read-only by construction — the cards are text, and the BFF route it reads answers GET
// alone.

async function readBoard(token: string): Promise<PublicBoardView> {
  const path = `/api/public/boards/${encodeURIComponent(token)}`
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as PublicBoardView
}

function Body({ token }: { token: string }) {
  const board = useQuery({ queryKey: ['public-board', token], queryFn: () => readBoard(token), retry: false })

  if (board.isLoading) {
    // No heading until the board has answered: the page's one h1 names the board, not a spinner.
    return <p className="text-body text-muted">Reading the board…</p>
  }
  if (board.isError || !board.data) {
    const gone = board.error instanceof ApiError && board.error.status === 404
    return (
      <>
        <h1 className="text-display-3 text-ink">{gone ? 'This board isn’t available' : 'The board couldn’t be read'}</h1>
        <p className="mt-4 max-w-2xl text-body text-muted">
          {gone
            ? 'The link may be mistyped, or the workspace that published it has turned it off. Ask whoever shared it for a new one.'
            : 'Track didn’t answer just now, so nothing is shown rather than something stale. Try again in a moment.'}
        </p>
      </>
    )
  }

  const b = board.data
  return (
    <>
      <p className="font-figure text-eyebrow uppercase text-muted">Read-only board</p>
      <h1 className="mt-3 text-display-3 text-ink">{b.project ? `${b.workspace} · ${b.project}` : b.workspace}</h1>
      <p className="mt-3 max-w-2xl text-body text-muted">
        {b.issues.length === 0
          ? 'Nothing is being tracked on this board yet.'
          : `${b.issues.length} issue${b.issues.length === 1 ? '' : 's'}, by where each one stands. Shared from Talyvor Track — only the people in this workspace can change it.`}
        {b.truncated ? ' This shows the most recently updated; the board holds more.' : ''}
      </p>
      <div className="mt-8">
        <BoardColumns cards={b.issues} />
      </div>
    </>
  )
}

export function PublicBoard() {
  useDocumentTitle('Board')
  const { token = '' } = useParams()
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-10 border-b border-rule bg-canvas">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-y-2 px-gutter py-3">
          <a href="/marketing" className={`block ${focusRing}`}>
            <div className="text-head text-ink">Talyvor</div>
            <div className="text-caption font-normal text-faint">Track</div>
          </a>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button asChild>
              <a href="/">Open the app</a>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-gutter py-12">
          <Body token={token} />
        </div>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-gutter py-6">
          <div className="font-figure text-eyebrow uppercase text-faint">Talyvor Ltd · self-hosted AI development</div>
          <div className="text-caption text-faint">
            <a href="/privacy" className={inlineLink}>
              Privacy
            </a>
            {' · '}
            <a href="/terms" className={inlineLink}>
              Terms
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
