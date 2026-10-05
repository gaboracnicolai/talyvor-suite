import { cn, focusRing } from '@talyvor/ui'
import { useState } from 'react'

import { download } from '../track/issueExport'
import { docsApi } from './api'

/** B29.30 — download this page as an HTML file, rendered by Docs in the brand. Quiet, like Pin. */
export function ExportHTML({ spaceId, pageId }: { spaceId: string; pageId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')

  async function run() {
    setState('busy')
    try {
      const { filename, html } = await docsApi.exportPageHTML(spaceId, pageId)
      download(filename, 'text/html', html)
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={() => void run()}
        className={cn(
          'rounded-control px-2 py-1 text-caption text-muted transition-colors duration-200 hover:text-ink',
          focusRing,
        )}
      >
        {state === 'busy' ? 'Exporting…' : 'Export as HTML'}
      </button>
      {state === 'failed' ? (
        <span className="text-caption text-ink" role="status">
          Couldn&rsquo;t export this page &mdash; try again.
        </span>
      ) : null}
    </>
  )
}
