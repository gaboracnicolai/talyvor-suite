import { cn, focusRing } from '@talyvor/ui'

import { Card } from '../lens/walletBrand'
import type { CodeRun } from './chatStream'
import { CopyButton } from './CopyButton'

// B28.373 — code execution in a sandbox. With Run code on, a question goes with chatApi.ts RUN_CODE_HEADER and the
// model may run code in Lens's sandbox while it answers (talyvor-lens B28.119). Each run comes back in the stream
// (chatStream.ts CODE_RUN_FRAME) and is shown under the answer: the code, word for word, and what it printed, as text.

/** The composer's switch: on, the model may run code to answer every question, until it is turned off. */
export function RunCodeToggle({ on, onChange, disabled }: { on: boolean; onChange: (on: boolean) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title="Run code"
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-caption transition-colors duration-200 disabled:opacity-50',
        // On, the accent tint the sidebar's active item sits on; ink on it, since accent text on the tint is under AA in light.
        on ? 'bg-accent-tint text-ink' : 'text-muted hover:text-ink',
        focusRing,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
      </svg>
      {/* On a phone the composer's row has room for the icon only; its name stays for a screen reader. */}
      <span className="sr-only sm:not-sr-only">Run code</span>
    </button>
  )
}

/** How a run ended, in words: only an ending that is not a clean finish is worth a line. */
function ending(run: CodeRun): string | undefined {
  if (run.timed_out === true) return 'Stopped: it ran too long'
  if (run.exit_code !== 0) return `Exited with code ${run.exit_code}`
  return undefined
}

/** What a run printed: its output, then its errors on a line of their own. */
function printed(run: CodeRun): string {
  if (run.stdout === '' || run.stderr === '') return run.stdout + run.stderr
  return run.stdout.endsWith('\n') ? run.stdout + run.stderr : `${run.stdout}\n${run.stderr}`
}

/** Under an answer asked with Run code on: each piece of code the model ran, and what it printed. */
export function CodeRuns({ runs }: { runs: CodeRun[] }) {
  return (
    <Card className="mt-3 px-4 py-3">
      <section aria-label="Code this answer ran" data-testid="turn-code-runs">
        <p className="font-figure text-eyebrow uppercase text-label">Code it ran</p>
        <ol className="mt-2 flex flex-col gap-3">
          {runs.map((run, i) => (
            <li key={i} className="min-w-0" data-testid="turn-code-run">
              <div className="overflow-hidden rounded-card border border-rule bg-raised">
                <div className="flex items-center justify-between border-b border-rule pl-3 pr-1">
                  <span className="font-figure text-caption text-label">{run.language}</span>
                  <CopyButton text={run.code} label="Copy code" />
                </div>
                <pre className="max-h-64 overflow-auto px-3 py-3 font-mono text-caption text-ink" data-testid="turn-code-run-code">
                  <code>{run.code}</code>
                </pre>
              </div>
              <p className="mt-2 text-caption text-muted">Output</p>
              {run.stdout === '' && run.stderr === '' ? (
                <p className="text-caption text-muted">It printed nothing.</p>
              ) : (
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control border border-rule px-3 py-2 font-figure text-caption text-ink" data-testid="turn-code-run-output">
                  {printed(run)}
                </pre>
              )}
              {ending(run) !== undefined ? <p className="mt-1 text-caption text-muted">{ending(run)}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </Card>
  )
}
