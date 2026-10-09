import { cn, focusRing } from '@talyvor/ui'
import { useState } from 'react'

import { ApiError } from '../../lib/api'
import { CopyButton } from '../chat/CopyButton'
import { docsApi } from './api'

/** B28.447 — a view-only link to this page that anyone can open signed out. Quiet, like Pin and Export. */
export function SharePage({ spaceId, pageId }: { spaceId: string; pageId: string }) {
  const [state, setState] = useState<{ kind: 'idle' | 'busy' } | { kind: 'made'; url: string } | { kind: 'failed'; status?: number }>({ kind: 'idle' })

  async function run() {
    setState({ kind: 'busy' })
    try {
      const { link } = await docsApi.sharePage(spaceId, pageId)
      setState({ kind: 'made', url: `${window.location.origin}/docs/s/${link.token}` })
    } catch (e) {
      setState({ kind: 'failed', status: e instanceof ApiError ? e.status : undefined })
    }
  }

  if (state.kind === 'made') {
    return (
      <section aria-label="Share this page" className="flex basis-full flex-wrap items-center gap-2">
        <input
          readOnly
          aria-label="Link to this page"
          value={state.url}
          onFocus={(e) => e.currentTarget.select()}
          className={cn('min-w-0 flex-1 rounded-control border border-rule bg-canvas px-2 py-1 font-mono text-caption text-ink transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50', focusRing)}
        />
        <CopyButton text={state.url} label="Copy link" />
        <span className="basis-full text-caption text-muted">Anyone with this link can read the page, signed out. They cannot edit it.</span>
      </section>
    )
  }

  return (
    <>
      <button
        type="button"
        disabled={state.kind === 'busy'}
        onClick={() => void run()}
        className={cn(
          'rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink',
          focusRing,
        )}
      >
        {state.kind === 'busy' ? 'Making a link…' : 'Share'}
      </button>
      {state.kind === 'failed' ? (
        <span className="text-caption text-ink" role="alert">
          {state.status === 403 ? 'Only an admin of this page can share it.' : 'The link wasn’t made — try again.'}
        </span>
      ) : null}
    </>
  )
}
