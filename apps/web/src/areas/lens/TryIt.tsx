import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Input, focusRing } from '@talyvor/ui'
import { Region, RegionScreen } from '../../components/Region'
import { fetchModels } from '../chat/chatApi'
import { ApiError } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'

// TryIt.tsx — B11.3: a Try-it page for each feature with no natural place to watch it work, linked
// from its row on Features. Each runs the feature on the person's own input through Lens's preview
// (talyvor-lens B11.4): nothing is sent to a model and nothing is charged.
//
// ⚠ THE HONESTY RULE: the page shows what the feature ACTUALLY did to that input. Tare does little to
// a short typed question, and when it declines the page says "nothing to reduce" and why — it never
// implies a saving it did not make. Every token and dollar figure is Lens's estimate and says so.

const fieldClass = `w-full rounded-control border border-rule bg-surface text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

const count = (n: number) => n.toLocaleString('en-US')

/** A preview Lens refused, carrying the reason it gave (an unsupported file, an input too large). */
class PreviewError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly reason: string,
  ) {
    super(status, path)
  }
}

function failure(err: unknown): string {
  if (isSessionExpired(err)) return 'Sign in again to run the preview.'
  return err instanceof PreviewError && err.reason ? err.reason : 'The preview could not run just now.'
}

async function previewPost<T>(path: string, body: BodyInit, contentType: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': contentType, Accept: 'application/json' },
    body,
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new PreviewError(res.status, path, json.error ?? '')
  return json
}

function Back() {
  return (
    <p className="text-caption text-muted">
      <Link className="text-ink underline underline-offset-2" to="/features">
        Features
      </Link>{' '}
      · Nothing here is sent to a model or charged.
    </p>
  )
}

/* ── Tare ─────────────────────────────────────────────────────────────────── */

interface TarePreview {
  reduced: string
  kind: string
  refused: boolean
  refusal_reasons: string[] | null
  tokens_in_estimated: number
  tokens_out_estimated: number
  tokens_saved_estimated: number
  model?: string
  saving_usd_estimated?: number
}

const KINDS = [
  { value: '', label: 'Detect it' },
  { value: 'json', label: 'JSON tool output' },
  { value: 'code', label: 'Go or TypeScript code' },
  { value: 'log', label: 'Log output' },
]

export function TryTare() {
  const [content, setContent] = useState('')
  const [kind, setKind] = useState('')
  const [model, setModel] = useState('')
  const models = useQuery({ queryKey: ['chat-models'], queryFn: fetchModels })
  const priced = (models.data ?? []).filter((m) => !m.deprecated)
  const chosen = model || priced.find((m) => m.id === 'gpt-4o')?.id || priced[0]?.id || ''
  const run = useMutation({
    mutationFn: () =>
      previewPost<TarePreview>(
        '/api/features/tare/preview',
        JSON.stringify({ content, kind, model: chosen }),
        'application/json',
      ),
  })
  const r = run.data
  const modelName = priced.find((m) => m.id === r?.model)?.display_name ?? r?.model

  return (
    <RegionScreen>
      <Region index="01" label="Try Tare" heading="See exactly what Tare would send">
        <Back />
        <p className="mt-3 max-w-2xl text-body text-muted">
          Paste a JSON tool output, Go or TypeScript code, or a log. Tare runs on it here exactly as it would on the
          newest message of a request: repeated JSON rows become one row per shape, function bodies are dropped while
          signatures and types stay, repeated log lines collapse. Anything it cannot shrink safely is sent unchanged.
        </p>
        <form
          className="mt-6 max-w-3xl space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            run.mutate()
          }}
        >
          <label className="block text-caption text-muted" htmlFor="tare-content">
            Content
          </label>
          <textarea
            id="tare-content"
            spellCheck={false}
            className={`min-h-48 w-full rounded-control border border-rule bg-surface p-3 font-mono text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder='{"users":[{"id":1,"name":"ada"},{"id":2,"name":"bob"}]}'
          />
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-caption text-muted">
              What it is
              <select
                className={`${fieldClass} mt-1 block h-8 px-2`}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-caption text-muted">
              Price the saving at
              <select
                className={`${fieldClass} mt-1 block h-8 px-2`}
                value={chosen}
                onChange={(e) => setModel(e.target.value)}
                disabled={models.isError || priced.length === 0}
              >
                {models.isError ? (
                  <option value="">Models could not be read</option>
                ) : priced.length === 0 ? (
                  <option value="">{models.isPending ? 'Loading models…' : 'No priced models'}</option>
                ) : null}
                {priced.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="primary" disabled={content.trim() === '' || run.isPending}>
              {run.isPending ? 'Running…' : 'Run Tare'}
            </Button>
          </div>
        </form>
        {run.isError ? (
          <p role="alert" className="mt-4 text-body text-ink">
            {failure(run.error)}
          </p>
        ) : null}
      </Region>

      {r ? (
        <Region index="02" label="Result" heading={r.refused ? 'Nothing to reduce' : 'What Tare would send'}>
          {r.refused ? (
            <div className="space-y-2" data-testid="tare-refused">
              <p className="text-body text-ink">
                Tare would send this unchanged — about {count(r.tokens_in_estimated)} tokens either way (estimated). No
                saving.
              </p>
              {r.refusal_reasons?.length ? (
                <ul className="list-disc pl-5 text-body text-muted">
                  {r.refusal_reasons.map((why) => (
                    <li key={why}>{why}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4" data-testid="tare-reduced">
              <p className="text-body text-ink">
                About {count(r.tokens_in_estimated)} tokens become {count(r.tokens_out_estimated)} —{' '}
                {count(r.tokens_saved_estimated)} fewer (estimated).
                {r.saving_usd_estimated !== undefined ? (
                  <>
                    {' '}
                    That is about ${r.saving_usd_estimated.toFixed(r.saving_usd_estimated < 0.01 ? 5 : 4)} less per
                    request on {modelName}, at its input rate (estimated).
                  </>
                ) : r.model ? (
                  <> Lens has no price for {modelName}, so no dollar figure is shown.</>
                ) : null}
              </p>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-control border border-rule bg-surface p-3 font-mono text-caption text-ink">
                {r.reduced}
              </pre>
            </div>
          )}
        </Region>
      ) : null}
    </RegionScreen>
  )
}

/* ── Document conversion ──────────────────────────────────────────────────── */

interface ConversionPreview {
  markdown: string
  format: string
  needs_vision: boolean
  warnings?: string[]
  savings: {
    input_bytes: number
    output_bytes: number
    input_tokens_raw: number
    input_tokens_distilled: number
    tokens_saved: number
  }
}

// A browser leaves File.type empty for some files (often .md and .csv); Lens needs the media type.
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
}

export function mediaTypeOf(file: File): string {
  return file.type || BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream'
}

export function TryConversion() {
  const [file, setFile] = useState<File | null>(null)
  const run = useMutation({
    mutationFn: (f: File) => previewPost<ConversionPreview>('/api/features/conversion/preview', f, mediaTypeOf(f)),
  })
  const r = run.data
  const download = () => {
    if (!r || !file) return
    const url = URL.createObjectURL(new Blob([r.markdown], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${file.name.replace(/\.[^.]+$/, '')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <RegionScreen>
      <Region index="01" label="Try document conversion" heading="See the text a model would read instead of your file">
        <Back />
        <p className="mt-3 max-w-2xl text-body text-muted">
          Choose a PDF, Word, Excel, CSV, HTML, JSON, XML or text file. It is converted here exactly as it would be when
          attached to a question, and you can download the result.
        </p>
        <div className="mt-6 flex max-w-3xl flex-wrap items-center gap-3">
          <Input
            type="file"
            aria-label="Document"
            className="h-auto w-auto py-1"
            accept=".pdf,.docx,.xlsx,.csv,.html,.htm,.json,.xml,.txt,.md"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              run.reset()
            }}
          />
          <Button variant="primary" disabled={!file || run.isPending} onClick={() => file && run.mutate(file)}>
            {run.isPending ? 'Converting…' : 'Convert'}
          </Button>
        </div>
        {run.isError ? (
          <p role="alert" className="mt-4 text-body text-ink">
            {failure(run.error)}
          </p>
        ) : null}
      </Region>

      {r ? (
        <Region index="02" label="Result" heading={r.needs_vision ? 'No text to convert' : 'The converted document'}>
          {r.needs_vision ? (
            <p className="text-body text-ink" data-testid="conversion-vision">
              This file has no text layer (a scan or an image), so there is nothing to convert. Reading it would need
              vision, which this preview does not run.
            </p>
          ) : (
            <div className="space-y-4" data-testid="conversion-result">
              <p className="text-body text-ink">
                The {r.format.toUpperCase()} file is about {count(r.savings.input_tokens_raw)} tokens; as text, about{' '}
                {count(r.savings.input_tokens_distilled)}
                {r.savings.tokens_saved > 0 ? (
                  <> — {count(r.savings.tokens_saved)} fewer (estimated).</>
                ) : (
                  <> — no saving on this file (estimated).</>
                )}
              </p>
              {r.warnings?.length ? (
                <ul className="list-disc pl-5 text-body text-muted">
                  {r.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <Button onClick={download}>Download as Markdown</Button>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-control border border-rule bg-surface p-3 font-mono text-caption text-ink">
                {r.markdown}
              </pre>
            </div>
          )}
        </Region>
      ) : null}
    </RegionScreen>
  )
}
