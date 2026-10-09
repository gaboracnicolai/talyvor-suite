import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, focusRing } from '@talyvor/ui'
import { ARTIFACT, artifactOf, bodyOf } from './Marketplace'
import { type Listing, type ListingVersion, marketApi, refusalText } from './marketApi'
import { CATALOG_KEY, Card, MINE_KEY, Note } from './parts'

// NewVersion.tsx — B28.162: the seller uploads a new version of their listing, with a changelog saying what changed.
// Lens adds it as the next version and keeps every earlier one as it was, so a use or a licence pinned to an earlier
// version still runs that one. It opens on the latest version's artifact; the model and the parents carry over.

export function NewVersion({ listing, latest }: { listing: Listing; latest: ListingVersion }) {
  const qc = useQueryClient()
  const artifact = latest.artifact ?? {}
  const model = typeof artifact.model === 'string' ? artifact.model : ''
  const [body, setBody] = useState(() => bodyOf(listing.kind, artifact))
  const [changelog, setChangelog] = useState('')
  const publish = useMutation({
    mutationFn: () => marketApi.publishVersion(listing.id, artifactOf(listing.kind, body, model), changelog.trim()),
    onSuccess: () => {
      setChangelog('')
      void qc.invalidateQueries({ queryKey: ['market-listing', listing.id] })
      void qc.invalidateQueries({ queryKey: MINE_KEY })
      void qc.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
  const ready = body.trim() !== '' && changelog.trim() !== ''
  return (
    <Card data-testid="new-version">
      <CardHeader>New version</CardHeader>
      <form
        className="flex flex-col gap-4 p-gutter"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !publish.isPending) publish.mutate()
        }}
      >
        <p className="text-body text-muted">
          Publishing makes it version <span className="font-figure">{listing.latest_version + 1}</span>. Earlier versions
          stay as they are: anyone who chose one, or holds a licence for one, keeps running it.
        </p>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {ARTIFACT[listing.kind].label}
          <textarea
            className={`min-h-40 w-full rounded-control border border-rule bg-surface p-3 font-mono text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            spellCheck={false}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <span>{ARTIFACT[listing.kind].hint}</span>
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          What changed
          <Input value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="Shorter answers" />
        </label>
        <div>
          <Button type="submit" variant="primary" disabled={!ready || publish.isPending}>
            {publish.isPending ? 'Publishing…' : 'Publish this version'}
          </Button>
        </div>
        {publish.isError ? <Note ok={false}>{refusalText(publish.error)}</Note> : null}
        {publish.isSuccess ? (
          <Note ok>
            Version {publish.data.version} is published
            {publish.data.scan?.held ? ', and held for review' : ''}.
          </Note>
        ) : null}
      </form>
    </Card>
  )
}
