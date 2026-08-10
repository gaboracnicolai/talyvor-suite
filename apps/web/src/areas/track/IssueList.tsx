import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  focusRing,
} from '@talyvor/ui'
import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { isUnconfigured } from '../../lib/productState'
import { isSessionExpired } from '../../lib/productState'
import { Link } from 'react-router-dom'
import { StatusPill } from './StatusPill'
import { UpstreamCard } from './UpstreamCard'
import { ISSUE_STATUSES, type IssueStatus, type TrackIssue, type TrackMember } from './types'

// THE ISSUE LIST. It used to render fourteen FABRICATED issues — plausible titles, assignees, AI
// costs — behind a filter rail that could never query anything, all marked with a fixture badge.
// That was deleted, and this screen became a probe card: it asked /api/track/issues and reported
// whether the upstream answered, which told a tester the wiring was alive and gave them nothing to do.
//
// Now it is the real thing, and the rule from that deletion still holds: NOTHING HERE IS INVENTED.
// An empty tracker renders an empty state because the API returned [], not because a fixture said so.
// A brand-new workspace showing "No issues yet" is the CORRECT output, not a gap to paper over.
//
// Scope was deliberately small — list, create, change status. Detail (#83) added description,
// priority, assignee and comments, so the LOOP is complete: you can file, describe, assign,
// prioritise, discuss and close.
//
// WHAT THIS ADDS, AND WHY IT IS NOT A NEW SCREEN. The loop being complete is not the same as
// being able to run your work here. What breaks first is this list: it asked for
// `/api/track/issues` with NO query at all, so it rendered every issue ever created — closed work
// included, in whatever order the store returned, unbounded. That is fine on day one with four
// issues and unusable by week three, and no new screen fixes it.
//
// Meanwhile the BFF already validates and forwards a full contract —
// status, team_id, project_id, cycle_id, assignee_id, priority, order_by, order_dir, limit,
// offset — refusing unknown keys, and refusing `labels` outright because upstream would silently
// ignore it. The UI sent none of it. So every control below maps 1:1 onto a parameter the BFF
// already checks; nothing here filters client-side, because a control that narrowed only the rows
// already fetched would be a filter that lies about what it searched.
//
// WHOSE ISSUES: the BFF resolves the workspace from the SESSION, so this screen never names one.
// That claim is asserted in the BFF suite against the upstream path, not here — a form posting to
// the wrong tenant would look identical on this screen.

/** How many rows one page asks for. Track's own List has no COUNT, so the BFF cannot honestly
 *  offer "N of M" — see its comment. A page size plus an explicit "there may be more" is the
 *  honest shape available; inventing a total would mean paging the whole set per render. */
const PAGE = 50

/** The view controls, each one a parameter the BFF already validates and forwards. */
export interface IssueView {
  /** A single model.IssueStatus, or '' for no status filter. Upstream takes one value, not a
   *  list — so "everything except closed" is NOT expressible here, and this deliberately does
   *  not pretend otherwise. */
  status: IssueStatus | ''
  /** A member id, or '' for anyone. */
  assignee: string
  /** ⚠ TIMESTAMP COLUMNS ONLY, AND THAT IS A MEASUREMENT, NOT A PREFERENCE — see SORT_OPTIONS.
   *  issuesQuery sends ONE direction for whichever column is named here, so a column whose
   *  useful end is not "highest first" cannot be listed. */
  orderBy: 'updated_at' | 'created_at'
}

/**
 * The Sort control's options — ONE source for the type, the query and the rendered items.
 *
 * ⚠ `priority` IS ABSENT, AND IT USED TO BE HERE. Upstream accepts it (its ORDER BY allowlist
 * is created_at / updated_at / priority / sort_order, and the BFF mirrors that list), so it
 * looked like a fourth free option. It is not an ordering this product can deliver.
 *
 * MEASURED, real Chrome on the built bundle, against the real `issues` DDL in a real Postgres
 * running the ORDER BY talyvor-track's own store builds (internal/issue/store.go:689-709).
 * The control read "Priority" and the screen read, top to bottom:
 *
 *     Low — rename a variable             priority 4
 *     Medium — tidy the settings copy     priority 3
 *     High — customer data export fails   priority 2
 *     Urgent — production is down         priority 1   ← FOURTH of five
 *     None — unprioritised note           priority 0
 *
 * ⚠ THE OTHER DIRECTION IS NOT THE FIX. model.IssuePriority (upstream model.go:94-98) is
 * 0 None · 1 Urgent · 2 High · 3 Medium · 4 Low, so 0 means UNSET and sits inside the scale:
 * `desc` buries Urgent under everything, `asc` puts the unprioritised rows ABOVE it. Neither
 * numeric direction is an importance order, which is why this is not a one-character fix and
 * why the enum premise is pinned as a test that says so when it expires.
 *
 * ⚠ AND THE PAGE MAKES IT UNREACHABLE, NOT MERELY MISORDERED. This screen fetches ONE page of
 * PAGE rows and has no offset control. Measured against the priority distribution tab-8e26
 * read off a real Jira export (3,020 issues: high 1023 · none 816 · medium 624 · urgent 316 ·
 * low 241), the first 50 rows are 50 × Low under `desc` and 50 × None under `asc`, and the
 * first urgent row is number 1,889 or 817 of 3,020. In either direction the sort labelled
 * "Priority" cannot put an urgent issue on the only page it fetches.
 *
 * ⚠ WHAT WOULD BRING IT BACK, so this is a handover and not just a deletion: an upstream
 * ordering that ranks importance — a rank expression that sorts 0 LAST (`CASE WHEN priority=0
 * THEN 5 ELSE priority END ASC`), or a renumbered enum. That is talyvor-track's to make; the
 * expiry test in IssueList.test.tsx fails the day the enum becomes monotone and says to
 * restore this option. The same screen already refuses to offer an "open issues" status for
 * exactly this reason — a control that cannot honestly be delivered is not offered.
 */
export const SORT_OPTIONS: { value: IssueView['orderBy']; label: string }[] = [
  { value: 'updated_at', label: 'Recently updated' },
  { value: 'created_at', label: 'Recently created' },
]

/** The default view. ORDER MATTERS MOST: recently-touched-first is what keeps the list usable as
 *  it grows, because the work someone is actually doing stays at the top without them filtering
 *  for it. */
export const DEFAULT_VIEW: IssueView = { status: '', assignee: '', orderBy: 'updated_at' }

/** Builds the query string. Empty controls are OMITTED rather than sent blank: the BFF treats a
 *  present-but-empty value as absent-filter semantics, and sending one anyway would make the
 *  request say something the user did not ask. */
export function issuesQuery(v: IssueView, limit = PAGE): string {
  const q = new URLSearchParams()
  if (v.status) q.set('status', v.status)
  if (v.assignee) q.set('assignee_id', v.assignee)
  q.set('order_by', v.orderBy)
  q.set('order_dir', 'desc')
  q.set('limit', String(limit))
  return q.toString()
}

const ISSUES_KEY = (v: IssueView) => ['track', 'issues', v.status, v.assignee, v.orderBy] as const

async function listIssues(v: IssueView): Promise<TrackIssue[]> {
  const res = await fetch(`/api/track/issues?${issuesQuery(v)}`, {
    headers: { Accept: 'application/json' },
  })
  // The SHARED ApiError, so isUnconfigured() classifies a Track read exactly as it classifies
  // every other product read — a local !res.ok check would lose the 503/5xx distinction.
  if (!res.ok) throw new ApiError(res.status, '/api/track/issues')
  const body: unknown = await res.json()
  // Track returns a BARE ARRAY, no envelope. A null body is an empty tracker, never a crash.
  return Array.isArray(body) ? (body as TrackIssue[]) : []
}

/**
 * A refused create, carrying whatever the upstream was willing to say.
 *
 * ⚠ THE STATUS CLASS IS THE ADVICE. A 4xx is the server saying "not as sent" — the same request will
 * be refused forever, so "Try again" is not merely unhelpful, it is false. That is what happened
 * here: Track answered
 *
 *   {"error":"issue: WorkspaceID, TeamID, Title, and CreatorID are required","code":"CREATE_FAILED"}
 *
 * on every create in a workspace with no team, and the screen rendered "Try again" while discarding
 * the sentence that explained it. The reason was reachable only from the network tab, which is where
 * the bug was eventually found.
 *
 * A 5xx or an unreadable body genuinely may be transient, so those keep the retry copy.
 */
class CreateRefusal extends Error {
  constructor(
    readonly status: number,
    /** The upstream sentence, when there was one. Never invented — absent stays absent. */
    readonly reason: string,
  ) {
    super(reason || `create: ${status}`)
  }
  /** Retrying can only help when the server did not reject the request itself. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 0
  }
}

async function createRefusal(res: Response): Promise<CreateRefusal> {
  // A body that is not JSON (an HTML 502 from a proxy) must not become a fake reason, so the parse
  // failure falls through to an empty one rather than showing the user markup.
  let reason = ''
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      reason = (body as { error: string }).error
    }
  } catch {
    reason = ''
  }
  return new CreateRefusal(res.status, reason)
}

export function IssueList() {
  const qc = useQueryClient()
  const [view, setView] = useState<IssueView>(DEFAULT_VIEW)
  const issues = useQuery({
    queryKey: ISSUES_KEY(view),
    queryFn: () => listIssues(view),
    retry: false,
  })
  // The assignee picker needs names. Same route the detail screen uses; react-query dedupes.
  const members = useQuery({
    queryKey: ['track', 'members'],
    queryFn: async (): Promise<TrackMember[]> => {
      const res = await fetch('/api/members', { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new ApiError(res.status, '/api/members')
      const b: unknown = await res.json()
      return Array.isArray(b) ? (b as TrackMember[]) : []
    },
    retry: false,
  })
  const [title, setTitle] = useState('')

  // INVALIDATION IS THE POINT. A create that does not refetch leaves the tester looking at the list
  // they just added to, and the natural conclusion is that it failed. Both mutations invalidate the
  // one list key on success, so the row appears with no reload.
  const create = useMutation({
    mutationFn: async (t: string) => {
      const res = await fetch('/api/track/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ title: t }),
      })
      if (!res.ok) throw await createRefusal(res)
      return res.json()
    },
    onSuccess: async () => {
      setTitle('')
      await qc.invalidateQueries({ queryKey: ['track', 'issues'] })
    },
  })

  const setStatus = useMutation({
    mutationFn: async (v: { id: string; status: IssueStatus }) => {
      // Track's Update decodes map[string]any, so a bare {"status":…} is a valid patch; the BFF
      // forwards it verbatim and the upstream rejects {} with EMPTY_UPDATE.
      const res = await fetch(`/api/track/issues/${encodeURIComponent(v.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ status: v.status }),
      })
      if (!res.ok) throw new Error(`status: ${res.status}`)
      return res.json()
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['track', 'issues'] })
    },
  })

  // THREE STATES THAT MUST NOT COLLAPSE INTO EACH OTHER, and the reason the shared classifier is
  // reused rather than a local !res.ok check: "Track is not deployed here" (503), "Track is broken"
  // (5xx), and "you have no issues yet" ([]) mean completely different things to a tester, and
  // laundering any of them into another tells them their work vanished or that a fault is normal.
  // The unconfigured case keeps its existing card verbatim.
  if (isUnconfigured(issues.error)) {
    return <UpstreamCard title="Issues" state="unconfigured" reads="GET /api/track/issues" />
  }

  const rows = issues.data ?? []

  return (
    <Card>
      <CardHeader>Issues</CardHeader>
      <div className="flex flex-col gap-4 px-gutter py-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const t = title.trim()
            // An empty title posts a blank issue Track would accept and nobody wants; refuse here
            // rather than create noise the tester then has to clean up.
            if (!t || create.isPending) return
            create.mutate(t)
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-caption text-muted">Title</span>
            <input
              className={`w-full rounded-control border border-rule bg-canvas px-2 py-1 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
            />
          </label>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create issue'}
          </Button>
        </form>

        {create.isError ? (
          <p className="text-caption text-muted">
            {create.error instanceof CreateRefusal && !create.error.retryable && create.error.reason
              ? // The upstream sentence, verbatim. It is written for a person (Track's writeErr
                // messages name the field and what to do), and paraphrasing it here would be this
                // screen inventing a diagnosis it does not have.
                `Couldn’t create that issue — ${create.error.reason}`
              : 'Couldn’t create that issue — nothing was saved. Try again.'}
          </p>
        ) : null}

        {/* ⚠ THE RAIL IS THE SCREEN'S USABILITY, and every control is a parameter the BFF already
            validates — nothing is filtered client-side. A control that narrowed only the rows
            already fetched would claim to have searched a set it never saw.

            NOTE WHAT IS ABSENT: there is no "open issues" option. Upstream takes ONE status
            value, not a list, so "everything except done and cancelled" is not expressible — and
            faking it by filtering the page would be exactly the lie above. Sorting by most
            recently updated is what actually keeps this usable as the tracker grows, so that is
            the default instead. */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">Status</span>
            <Select
              value={view.status || 'any'}
              onValueChange={(v) =>
                setView((s) => ({ ...s, status: v === 'any' ? '' : (v as IssueStatus) }))
              }
            >
              <SelectTrigger aria-label="Filter by status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any status</SelectItem>
                {ISSUE_STATUSES.map((st) => (
                  <SelectItem key={st} value={st}>
                    {st.replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">Assignee</span>
            <Select
              value={view.assignee || 'any'}
              onValueChange={(v) => setView((s) => ({ ...s, assignee: v === 'any' ? '' : v }))}
            >
              <SelectTrigger aria-label="Filter by assignee" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Anyone</SelectItem>
                {(members.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name || m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-caption text-muted">Sort</span>
            <Select
              value={view.orderBy}
              onValueChange={(v) => setView((s) => ({ ...s, orderBy: v as IssueView['orderBy'] }))}
            >
              <SelectTrigger aria-label="Sort order" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {view.status || view.assignee || view.orderBy !== DEFAULT_VIEW.orderBy ? (
            <Button onClick={() => setView(DEFAULT_VIEW)}>Reset</Button>
          ) : null}
        </div>

        {issues.isLoading ? (
          <p className="text-caption text-muted">Loading issues…</p>
        ) : isSessionExpired(issues.error) ? (
          <p className="text-caption text-muted">Unavailable.</p>
        ) : issues.isError ? (
          // A fault must not read as an empty tracker: those are different states and conflating
          // them tells a tester their work vanished.
          <p className="text-caption text-muted">
            Couldn’t reach Track, so no issues can be shown. This is a fault, not an empty tracker.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-caption text-muted">
            No issues yet. Create the first one above — it lands in your own workspace.
          </p>
        ) : (
          <table className="w-full border-collapse text-body">
            <thead>
              <tr className="text-left text-caption text-muted">
                <th className="py-1 font-normal">Ref</th>
                <th className="py-1 font-normal">Title</th>
                <th className="py-1 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.id} className="border-t border-rule align-middle">
                  {/* ⚠ THE LINK IS THE WHOLE POINT. Until now a row was terminal: you could see an
                      issue existed and had no way to open it. The title is the target because that
                      is what a reader aims at; the ref stays plain so the row has one link, not two.
                      ⚠ UNDERLINED AT REST, not on hover — the same correction Crumbs already made in
                      areas/docs/components.tsx and recorded there as "the only Link in the app
                      without a resting affordance". It was not the only one: this cell is the link,
                      the whole cell, and at rest it was text-ink text between a muted mono ref and a
                      Pill, so the one cell that navigates was the one cell with no mark on it — and
                      a hover affordance is the one affordance a touch device can never produce.
                      src/restingAffordance.test.ts fails on a hover-only underline in either
                      package now, so this cannot come back as a third instance. */}
                  <td className="py-2 pr-3 font-mono text-caption text-muted">{it.identifier}</td>
                  <td className="py-2 pr-3 text-ink">
                    <Link className="underline underline-offset-2" to={`/track/issues/${it.id}`}>
                      {it.title}
                    </Link>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={it.status} />
                      <select
                        aria-label={`Status for ${it.identifier}`}
                        className={`rounded-control border border-rule bg-canvas px-1 py-0.5 text-caption text-ink ${focusRing}`}
                        value={it.status}
                        disabled={setStatus.isPending}
                        onChange={(e) =>
                          setStatus.mutate({ id: it.id, status: e.target.value as IssueStatus })
                        }
                      >
                        {ISSUE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ⚠ NOT "N of M". Track's issue store has no COUNT query, so neither this screen nor the
            BFF can say how many exist — the BFF's own comment says deriving a total would mean
            paging the entire result set per render. A full page is the only honest signal that
            there may be more, so that is what is said, and it names the controls that narrow it
            rather than offering a Next button that could not report where it was. */}
        {rows.length === PAGE ? (
          <p className="text-caption text-muted">
            Showing the first {PAGE}. There may be more — narrow by status or assignee to see
            them. This tracker has no total to count against, so no page number is shown.
          </p>
        ) : null}
      </div>
    </Card>
  )
}
