import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, formatDay, inlineLink } from '@talyvor/ui'

import { UPLOADED_FILES_KEY, type UploadedFile, UploadedFilesError, deleteUploadedFile, fetchUploadedFiles, fileKind, fileSize } from './uploadedFiles'

// B28.380 — uploaded files: every file attached in Chat is stored in Lens so each question can reference it by id
// (B18.24). This page, linked from Chat's rail, lists them and deletes one for good.

export function FilesPage() {
  const qc = useQueryClient()
  const files = useQuery({ queryKey: UPLOADED_FILES_KEY, queryFn: fetchUploadedFiles, retry: false })
  const [confirming, setConfirming] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: async (f: UploadedFile) => ({ file: f, outcome: await deleteUploadedFile(f.id) }),
    onSuccess: ({ file, outcome }) => {
      qc.setQueryData<UploadedFile[]>(UPLOADED_FILES_KEY, (list) => (list ?? []).filter((d) => d.id !== file.id))
      setConfirming(null)
      setSaid(outcome === 'deleted' ? `Deleted ${file.filename || 'the file'}. No question can read it again.` : `${file.filename || 'That file'} was already deleted.`)
    },
    onError: (e) => setSaid(e instanceof UploadedFilesError ? e.message : 'Lens couldn’t delete the file just now.'),
  })

  const list = files.data ?? []
  const total = list.reduce((sum, f) => sum + f.size_bytes, 0)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      {/* The page's name is the console banner's <h1> (CONSOLE_ROUTES' title), so no second one here. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body text-muted">
          Every file you attach in Chat is kept for your workspace, so each question can read it without sending it
          again. It stays until you delete it here.
        </p>
        <Link className={`text-body text-ink ${inlineLink}`} to="/chat">
          Back to Chat
        </Link>
      </div>

      <section aria-labelledby="files-uploaded" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="files-uploaded" className="font-figure text-eyebrow uppercase text-label">
            Your files
          </h2>
          {list.length > 0 ? (
            <p className="font-figure text-caption text-muted" data-testid="uploaded-files-total">
              {list.length} {list.length === 1 ? 'file' : 'files'} · {fileSize(total)}
            </p>
          ) : null}
        </div>
        {said !== null ? (
          <p className="text-caption text-muted" role="status">
            {said}
          </p>
        ) : null}
        {files.isPending ? (
          <p className="text-body text-muted">Reading your files…</p>
        ) : files.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body text-ink" role="alert" data-testid="uploaded-files-error">
              {files.error instanceof UploadedFilesError ? files.error.message : 'Your uploaded files could not be read just now.'}
            </p>
            {files.error instanceof UploadedFilesError && files.error.unavailable ? null : (
              <Button onClick={() => void files.refetch()}>Try again</Button>
            )}
          </div>
        ) : list.length === 0 ? (
          <p className="text-body text-muted" data-testid="uploaded-files-empty">
            No files. A file you attach in Chat is listed here.
          </p>
        ) : (
          <ul className="flex flex-col rounded-card border border-rule bg-raised px-4" aria-label="Uploaded files" data-testid="uploaded-files">
            {list.map((f, i) => {
              const name = f.filename || 'Untitled file'
              return (
                <li key={f.id} className={`flex flex-col gap-2 py-3 ${i > 0 ? 'border-t border-rule' : ''}`} data-testid="uploaded-file" data-id={f.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="break-words text-body text-ink">{name}</p>
                      <p className="text-caption text-muted">
                        {fileKind(f.media_type)} · <span className="font-figure">{fileSize(f.size_bytes)}</span> · uploaded{' '}
                        <span className="font-figure">{formatDay(f.uploaded_at)}</span>
                      </p>
                    </div>
                    {confirming === f.id ? null : (
                      <Button
                        aria-label={`Delete ${name}`}
                        onClick={() => {
                          setConfirming(f.id)
                          setSaid(null)
                        }}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                  {confirming === f.id ? (
                    <div className="flex flex-col gap-2 wide:flex-row wide:items-center wide:justify-between" data-testid="uploaded-file-confirm">
                      <p className="text-caption text-ink">Delete {name} for good? Questions you already asked keep their answers, but none can read it again.</p>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="primary" disabled={remove.isPending} onClick={() => remove.mutate(f)}>
                          {remove.isPending ? 'Deleting…' : 'Delete for good'}
                        </Button>
                        <Button disabled={remove.isPending} onClick={() => setConfirming(null)}>
                          Keep it
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
