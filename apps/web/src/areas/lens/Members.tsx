import { Card, CardHeader, Row } from '@talyvor/ui'
import { cn } from '@talyvor/ui'
import { FixtureNotice } from './FixtureNotice'
import { fixtureRoster } from './fixtures'

// Members — the workspace roster. Track owns identity (the BFF forwards the
// session email as the membership join key), so the rows here mirror Track's
// memberView shape exactly: {id, name, email, role, avatar_url}, roles
// owner | member. Owner sorts first; the distinction is WEIGHT, not a hue —
// role text is a category label, and text is never a hue.
//
// FIXTURE-BACKED: Track serves GET /v1/workspaces/{wsID}/members today, but
// the BFF has no proxy for it (needs a pinned TRACK_WORKSPACE_ID, like Docs).
// See the lens-area report for the exact BFF work.
export function Members() {
  const roster = [...fixtureRoster].sort(
    (a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name),
  )
  return (
    <div className="flex flex-col gap-4 px-gutter py-4">
      <FixtureNotice awaiting="live wiring in the lens area — GET /api/members landed with the shared-unblock PR" />
      <Card>
        <CardHeader>Members</CardHeader>
        {roster.map((m) => (
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
        ))}
      </Card>
    </div>
  )
}
