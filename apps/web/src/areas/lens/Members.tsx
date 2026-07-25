import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, Row, cn } from '@talyvor/ui'
import { getJSONArray } from '../../lib/api'
import { isUnconfigured, notConfiguredCopy } from '../../lib/productState'

// Members — the workspace roster, LIVE from GET /api/members (the BFF proxies Track's
// /v1/workspaces/{ws}/members, pinned server-side, session email as the membership join key).
//
// This screen used to render two invented people under a caption that already said the route
// had landed. It had: apps/bff/lens.go registers /api/members. Nothing called it.
//
// Track is an OPTIONAL upstream and is not deployed here, so the route answers 503 today. That
// state is DETECTED from the response, not written into this file — see lib/productState.ts
// for why a hardcoded "not configured" would just become the next stale caption. When the
// TRACK_* trio appears, this screen starts showing the real roster with no change here.
//
// Rows mirror Track's memberView exactly: {id, name, email, role, avatar_url}, roles
// owner | member. Owner sorts first; the distinction is WEIGHT, not a hue — role text is a
// category label, and text is never a hue.

/** Track internal/member/mgmt_handler.go memberView, verbatim. */
export interface RosterMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  avatar_url: string
}

export function Members() {
  const q = useQuery({
    queryKey: ['members'],
    // getJSONArray, not getJSON: an empty list arrives as JSON `null` from Go's
    // `var out []T` idiom, and a bare read would make a real empty roster throw.
    queryFn: () => getJSONArray<RosterMember>('/api/members'),
  })

  const roster = [...(q.data ?? [])].sort(
    (a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name),
  )

  return (
    <div className="flex flex-col gap-4 px-gutter py-4">
      <Card>
        <CardHeader>Members</CardHeader>
        {q.isLoading ? (
          <div className="px-gutter py-3 text-body text-muted">Loading…</div>
        ) : isUnconfigured(q.error) ? (
          <div className="px-gutter py-3 text-body text-muted">{notConfiguredCopy('Track')}</div>
        ) : q.isError ? (
          <div className="px-gutter py-3 text-body text-muted">Couldn’t load the members.</div>
        ) : roster.length === 0 ? (
          <div className="px-gutter py-3 text-body text-muted">No members in this workspace yet.</div>
        ) : (
          roster.map((m) => (
            <Row key={m.id} label={m.name} hint={m.email}>
              <span
                className={cn(
                  'text-caption uppercase tracking-wide',
                  m.role === 'owner' ? 'font-semibold text-ink' : 'text-muted',
                )}
              >
                {m.role}
              </span>
            </Row>
          ))
        )}
      </Card>
      {/* The roster comes from Track, which owns identity. Stated only when it actually
          served one — a provenance line under a failed or unconfigured read is exactly the
          "Live from …" bug the Docs area was reviewed for. */}
      {q.isSuccess && roster.length > 0 ? (
        <p className="px-gutter text-body text-faint">
          Live from Track via the BFF — the workspace is pinned server-side.
        </p>
      ) : null}
    </div>
  )
}
