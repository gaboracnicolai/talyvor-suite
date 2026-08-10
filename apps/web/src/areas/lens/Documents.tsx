import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@talyvor/ui'
import { ApiError } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'

// Documents.tsx — what happens to an attached document, and the switch that stops it.
//
// ⚠ WHY THIS EXISTS. DefaultDistillPolicy is DistillAlways, so every workspace already has
// distill_policy = 'always'. A customer who attaches a PDF is ALREADY having it converted, and
// nothing in the product said so. The route to turn it off — PUT /v1/workspaces/{wsID}/distill —
// has been live the whole time with nothing calling it: a setting that exists, is on, and cannot
// be reached is worse than one that was never built, because it reads as a decision nobody made.
//
// ⚠ THE SCANNED-DOCUMENT PATH IS THE PART A READER WOULD NOT GUESS. A document with no extractable
// text is sent to a VISION MODEL to be read. That is a different disclosure from "we reformat your
// file", it costs tokens rather than saving them, and it is stated plainly rather than folded into
// the sentence about savings.
//
// Structured like Sharing.tsx and for the same reason: the facts and the control live in one file
// so they cannot drift apart, and the copy states the trade rather than selling it.

/** DocumentFacts — the whole description. */
export function DocumentFacts() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body">
        When you attach a document — a PDF, a spreadsheet, a slide deck — Talyvor{' '}
        <strong>converts it to Markdown before the model sees it</strong>. The model reads the
        converted text, not your original file.
      </p>
      <p className="text-body">
        This is <strong>on for this workspace unless you turn it off</strong>. It is on because the
        converted text is smaller than the original, and you are charged for the smaller thing — so
        leaving it on lowers what you are charged for the same question.
      </p>
      <p className="text-body">
        <strong>A scanned document is different.</strong> If a file has no text to extract — a scan,
        a photograph, an image-only PDF — it is sent to a <strong>vision model</strong> to be read.
        That is an extra model call on your document, and it costs tokens rather than saving them.
      </p>
      <p className="text-body text-muted">
        Turning this off means documents reach the model as you sent them. Nothing else about your
        request changes.
      </p>
    </div>
  )
}

type DistillState = {
  distill_policy: 'always' | 'opt_in' | 'disabled'
  converted: number
  vision_ocr: number
  days: number
}

async function readDistill(): Promise<DistillState> {
  const res = await fetch('/api/distill', { headers: { Accept: 'application/json' } })
  // The SHARED ApiError, like every other hand-rolled read in this app. It was
  // `new Error(String(res.status))`, and one untyped throw turned off all THREE session
  // mechanisms at once, because every one of them keys on the TYPE: isSessionExpired() went
  // false so no bar appeared, App.tsx's "a 401 is a verdict, not a flake" retry rule did not
  // apply so the refusal was retried, and QueryCache.onError never re-probed the gate. This
  // was the only query in the product that raised anything else.
  if (!res.ok) throw new ApiError(res.status, '/api/distill')
  return (await res.json()) as DistillState
}

/** DistillChoice — the stored state, the counts, and the control. */
export function DistillChoice() {
  const q = useQuery({ queryKey: ['distill'], queryFn: readDistill, staleTime: 30_000 })
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'on' | 'off' | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const policy = q.data?.distill_policy
  // opt_in is a real third state (convert only when the request asks). For this screen the
  // question is "is it happening to me by default", and only 'always' means yes.
  const on = policy === 'always'

  async function choose(next: 'always' | 'disabled') {
    setBusy(next === 'always' ? 'on' : 'off')
    setFailed(null)
    try {
      // Relative path ⇒ same-origin ⇒ the browser supplies the Origin the BFF requires.
      const res = await fetch('/api/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ distill_policy: next }),
      })
      if (!res.ok) throw new ApiError(res.status, '/api/distill')
      // ⚠ RE-READ rather than trusting the click. The rendered state must be what Lens RECORDED.
      await qc.invalidateQueries({ queryKey: ['distill'] })
    } catch (err) {
      // "You can try again" is true of a blip and false of a dead credential, and under the bar
      // it is a third voice giving a remedy that contradicts the one already on screen. The
      // OUTCOME still has to be stated either way — the reader pressed a button and needs to
      // know it did not take — so only the advice moves.
      setFailed(
        isSessionExpired(err)
          ? 'That did not save, so nothing changed.'
          : 'That did not save, so nothing changed. You can try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {q.isLoading ? (
        <p className="text-body text-muted">Checking this workspace&rsquo;s setting…</p>
      ) : policy === undefined ? (
        // Same element, same classes — only which sentence it holds. On an expired credential
        // the bar above has already named the cause and the fix, so this states availability and
        // nothing else; "the buttons below still work" is a second voice AND untrue in that
        // state. On a genuine fault the buttons DO still work and the re-read DOES happen, so
        // that sentence keeps its job. isSessionExpired is the product's one predicate for this.
        <p className="text-body text-muted">
          {isSessionExpired(q.error) ? (
            'Unavailable.'
          ) : (
            <>
              This workspace&rsquo;s document setting could not be read, so it is not shown. The
              buttons below still work, and the result is re-read afterwards.
            </>
          )}
        </p>
      ) : (
        <p className="text-body">
          Document conversion is currently {on ? 'on' : 'off'} for this workspace.
        </p>
      )}

      {/* ⚠ A COUNT, NEVER A SAVING, AND NEVER A DOLLAR FIGURE. The saving is implicit in the
          smaller token count on the same billing row — there is no separate saving to read, and
          the savings metric reads 0 for every format except HTML at the tier the request path
          uses. A number we cannot compute honestly is not shown at all.
          Rendered only when non-zero: a permanent "0 documents" is noise on every workspace that
          has never attached one, and reads as though the feature were broken. */}
      {q.data && q.data.converted > 0 && (
        <p className="text-body text-muted">
          {q.data.converted} documents converted in the last {q.data.days} days.
        </p>
      )}
      {q.data && q.data.vision_ocr > 0 && (
        <p className="text-body text-muted">
          {q.data.vision_ocr} of them had no text to extract and were read by a vision model.
        </p>
      )}

      {failed && <p className="border-l-2 border-l-slashed pl-2 text-body text-ink">{failed}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button disabled={busy !== null} onClick={() => void choose('disabled')}>
          {busy === 'off' ? 'Saving…' : 'Do not convert my documents'}
        </Button>
        <Button disabled={busy !== null} onClick={() => void choose('always')}>
          {busy === 'on' ? 'Saving…' : 'Convert my documents'}
        </Button>
      </div>
    </div>
  )
}
