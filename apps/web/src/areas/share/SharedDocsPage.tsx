import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'

import { useDocumentTitle } from '../../documentTitle'
import { ApiError } from '../../lib/api'
import { SiteFooter, SiteHeader } from '../../components/SiteChrome'
import { TealRule } from '../marketing/Landing'
import { formatWhen } from '../lens/format'
import { PMDoc } from '../docs/pm'

// B28.447 — a Docs page its admin shared as a link, opened by anyone who has it, signed out. OUTSIDE the AuthGate
// (App.tsx) for the same reason as a shared chat. Read-only by construction. A link Docs refuses — one character
// changed, never made, expired — is answered 404 by the BFF, and the page says the page is not there.

/** GET /api/public/docs/{token}: talyvor-docs' public share view (internal/sharing Handler.Public).
 *  UPSTREAM-ONLY SharedDocsView: access, has_password, expires_at, powered_by */
export interface SharedDocsView {
  page: { id: string; title: string; content: string; content_text: string; updated_at: string }
}

async function readPage(token: string): Promise<SharedDocsView> {
  const path = `/api/public/docs/${encodeURIComponent(token)}`
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as SharedDocsView
}

function Body({ token }: { token: string }) {
  const shared = useQuery({ queryKey: ['shared-docs-page', token], queryFn: () => readPage(token), retry: false })

  if (shared.isLoading) {
    return <p className="text-body text-muted">Reading the page…</p>
  }
  if (shared.isError || !shared.data) {
    const gone = shared.error instanceof ApiError && shared.error.status >= 400 && shared.error.status < 500
    return (
      <>
        <h1 className="text-display-3 text-ink">{gone ? 'This page isn’t available' : 'The page couldn’t be read'}</h1>
        <TealRule className="mt-5" />
        <p className="mt-5 max-w-lg text-reading text-muted">
          {gone
            ? 'The link may be mistyped or out of date. Ask whoever shared it for a new one.'
            : 'Talyvor didn’t answer just now, so nothing is shown rather than something stale. Try again in a moment.'}
        </p>
      </>
    )
  }

  const p = shared.data.page
  return (
    <>
      <p className="text-eyebrow uppercase text-label">Shared page · read-only</p>
      <h1 className="mt-4 text-display-3 text-ink">{p.title}</h1>
      <TealRule className="mt-5" />
      <p className="mt-5 max-w-lg text-reading text-muted">
        Shared from Talyvor Docs. Last changed <span className="font-figure">{formatWhen(p.updated_at)}</span>.
      </p>
      <article aria-label="The page" className="mt-10 max-w-3xl text-reading text-ink">
        {p.content ? <PMDoc content={p.content} /> : <p className="whitespace-pre-wrap">{p.content_text}</p>}
      </article>
    </>
  )
}

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

export function SharedDocsPage() {
  useDocumentTitle('Shared page')
  const { token = '' } = useParams()
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <SiteHeader product="Docs" />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-gutter py-12">
          <Body token={token} />
        </div>
      </main>

      <SiteFooter links={FOOTER_LINKS} />
    </div>
  )
}
