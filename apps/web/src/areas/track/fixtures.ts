// ─── FIXTURES — NOT LIVE DATA ────────────────────────────────────────────────
//
// The BFF proxies exactly ONE Track route today (/api/track/workspaces). Every
// dataset in this file stands in for a Track endpoint that exists upstream at
// a3bc7b2 but has no BFF proxy yet:
//
//   FIXTURE_ISSUES   ← GET /v1/workspaces/{wsID}/issues
//   FIXTURE_COMMENTS ← GET /v1/workspaces/{wsID}/issues/{id}/comments
//   FIXTURE_MEMBERS  ← GET /v1/workspaces/{wsID}/members
//   FIXTURE_TEAMS    ← GET /v1/workspaces/{wsID}/teams
//
// Every screen that renders from here wears a <FixtureBadge> — fixture data is
// never presented as live. The shapes are JSON-verbatim to the Track handlers
// (see types.ts), so cutting over is: delete the fixture, point the hook at the
// proxy. The full route inventory the BFF needs is in the PR's gap list.

import type { TrackComment, TrackIssue, TrackMember, TrackTeam } from './types'

export const FIXTURE_TEAMS: TrackTeam[] = [
  { id: 'team-eng', workspace_id: 'ws-fixture', name: 'Engineering', identifier: 'ENG', color: '#5E6AD2', icon: '🛠', created_at: '2026-06-02T09:00:00Z', updated_at: '2026-06-02T09:00:00Z' },
  { id: 'team-ops', workspace_id: 'ws-fixture', name: 'Operations', identifier: 'OPS', color: '#26A269', icon: '📦', created_at: '2026-06-02T09:05:00Z', updated_at: '2026-06-02T09:05:00Z' },
]

// One owner + three members — the shape Track enforces (#58: every workspace has
// ≥1 owner; the roster read is member-visible, the roster WRITES are owner-only).
//
// UNMISTAKABLY SYNTHETIC. These names used to be plausible real-looking people on
// a routable domain — a fixture engineered to look real, which defeats the
// FixtureBadge above it: a reviewer who recognises a name stops trusting every
// number on the screen. Now the names announce themselves as
// samples and every address is on the RFC-2606 `.invalid` TLD, which can never
// resolve to a real mailbox. Still FOUR DISTINCT identities, owner first, with a
// short name (owner) against longer ones (members) so the dense list's assignee
// column and truncation are still exercised honestly — synthetic, not degenerate.
export const FIXTURE_MEMBERS: TrackMember[] = [
  { id: 'mem-owner', name: 'Sample Owner', email: 'owner@example.invalid', role: 'owner', avatar_url: '' },
  { id: 'mem-alpha', name: 'Sample Teammate Alpha', email: 'alpha@example.invalid', role: 'member', avatar_url: '' },
  { id: 'mem-bravo', name: 'Sample Teammate Bravo', email: 'bravo@example.invalid', role: 'member', avatar_url: '' },
  { id: 'mem-charlie', name: 'Sample Teammate Charlie', email: 'charlie@example.invalid', role: 'member', avatar_url: '' },
]

const iso = (day: number, hh: number, mm: number) =>
  `2026-07-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`

// Fourteen issues across both teams, all six statuses, four assignees + unassigned,
// every priority — enough spread that each filter visibly narrows the table.
export const FIXTURE_ISSUES: TrackIssue[] = [
  {
    id: 'iss-1', workspace_id: 'ws-fixture', team_id: 'team-eng', number: 42, identifier: 'ENG-42',
    title: 'Gateway 502s on cold start when the upstream pool is empty',
    description: 'First request after a deploy hits the proxy before the upstream health probe has admitted any node, so the router has an empty candidate set and returns 502.\n\nRepro: deploy, then curl within 3s. Expected: request queues briefly or fails with a retryable 503 + Retry-After.',
    status: 'in_progress', priority: 1, assignee_id: 'mem-alpha', creator_id: 'mem-owner',
    lens_feature: 'gateway', ai_cost_usd: 0.42, ai_tokens: 5210,
    created_at: iso(15, 9, 12), updated_at: iso(21, 16, 40),
  },
  {
    id: 'iss-2', workspace_id: 'ws-fixture', team_id: 'team-eng', number: 43, identifier: 'ENG-43',
    title: 'Allocator 402 body should name the funding step, not just the ceiling',
    description: 'A fresh workspace key’s first request fails with "agent LXC sub-budget exceeded or insufficient balance". Both halves are true but the operator fix (fund the workspace) is not named. Proposal: add a docs URL to the error body.',
    status: 'in_review', priority: 2, assignee_id: 'mem-bravo', creator_id: 'mem-alpha',
    lens_feature: 'economy', ai_cost_usd: 0.08, ai_tokens: 930,
    created_at: iso(17, 11, 3), updated_at: iso(21, 14, 2),
  },
  {
    id: 'iss-3', workspace_id: 'ws-fixture', team_id: 'team-eng', number: 44, identifier: 'ENG-44',
    title: 'Issue table virtualization above 2k rows',
    description: 'The dense list starts dropping frames around 2,000 rows on mid-tier hardware. Windowing keeps the System-Settings feel if the row height stays fixed.',
    status: 'todo', priority: 3, assignee_id: 'mem-alpha', creator_id: 'mem-owner',
    lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(18, 10, 30), updated_at: iso(18, 10, 30),
  },
  {
    id: 'iss-4', workspace_id: 'ws-fixture', team_id: 'team-eng', number: 45, identifier: 'ENG-45',
    title: 'Comment editor drops selection on window blur',
    description: 'Switching apps while a comment is half-written collapses the selection to the end of the text. Safari only.',
    status: 'backlog', priority: 4, creator_id: 'mem-bravo',
    lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(19, 8, 45), updated_at: iso(19, 8, 45),
  },
  {
    id: 'iss-5', workspace_id: 'ws-fixture', team_id: 'team-eng', number: 46, identifier: 'ENG-46',
    title: 'Dependency graph renders cycles as overlapping edges',
    description: 'Two issues blocking each other draw both edges on the same path; add a curvature offset.',
    status: 'done', priority: 3, assignee_id: 'mem-charlie', creator_id: 'mem-charlie',
    completed_at: iso(20, 17, 20), lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(12, 13, 0), updated_at: iso(20, 17, 20),
  },
  {
    id: 'iss-6', workspace_id: 'ws-fixture', team_id: 'team-eng', number: 47, identifier: 'ENG-47',
    title: 'Migrate issue search to the semantic endpoint behind a flag',
    description: 'Track ships /issues/semantic-search; gate the switch per-workspace and fall back to plain search on any error.',
    status: 'backlog', priority: 0, creator_id: 'mem-owner',
    lens_feature: 'search', ai_cost_usd: 1.13, ai_tokens: 14200,
    created_at: iso(20, 9, 10), updated_at: iso(20, 9, 10),
  },
  {
    id: 'iss-7', workspace_id: 'ws-fixture', team_id: 'team-eng', number: 48, identifier: 'ENG-48',
    title: 'Flaky websocket reconnect drops the first event after resume',
    description: 'On reconnect the hub replays from the NEXT sequence number; the event that raced the disconnect is lost. Buffer one.',
    status: 'in_progress', priority: 2, assignee_id: 'mem-charlie', creator_id: 'mem-alpha',
    lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(16, 15, 25), updated_at: iso(22, 8, 5),
  },
  {
    id: 'iss-8', workspace_id: 'ws-fixture', team_id: 'team-eng', number: 49, identifier: 'ENG-49',
    title: 'Cancelled issues still count toward cycle scope',
    description: 'Burndown treats cancelled as open. Track categorises cancelled separately (workflow engine, CategoryCancelled) — mirror it.',
    status: 'cancelled', priority: 3, assignee_id: 'mem-bravo', creator_id: 'mem-bravo',
    lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(11, 12, 12), updated_at: iso(19, 10, 2),
  },
  {
    id: 'iss-9', workspace_id: 'ws-fixture', team_id: 'team-ops', number: 12, identifier: 'OPS-12',
    title: 'Rotate the gateway auth secret without a deploy',
    description: 'Secret lives in the environment; rotation currently needs a restart. Wire the dual-secret window the gatewayauth middleware already supports.',
    status: 'in_progress', priority: 1, assignee_id: 'mem-owner', creator_id: 'mem-owner',
    lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(14, 10, 0), updated_at: iso(21, 11, 30),
  },
  {
    id: 'iss-10', workspace_id: 'ws-fixture', team_id: 'team-ops', number: 13, identifier: 'OPS-13',
    title: 'Backup restore drill for the issues database',
    description: 'Quarterly drill: restore last night’s snapshot into a scratch namespace and diff row counts per table.',
    status: 'todo', priority: 2, assignee_id: 'mem-owner', creator_id: 'mem-owner',
    due_date: iso(28, 0, 0), lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(19, 14, 40), updated_at: iso(20, 9, 55),
  },
  {
    id: 'iss-11', workspace_id: 'ws-fixture', team_id: 'team-ops', number: 14, identifier: 'OPS-14',
    title: 'Alert on webhook dedup table growth',
    description: 'webhookdedup rows are pruned lazily; a stuck pruner shows up as unbounded growth long before failures do.',
    status: 'done', priority: 3, assignee_id: 'mem-alpha', creator_id: 'mem-owner',
    completed_at: iso(18, 16, 0), lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(13, 9, 20), updated_at: iso(18, 16, 0),
  },
  {
    id: 'iss-12', workspace_id: 'ws-fixture', team_id: 'team-ops', number: 15, identifier: 'OPS-15',
    title: 'Document the guest-invite token lifecycle',
    description: 'Invite tokens are single-workspace and expiring; the operator doc never says what happens on re-invite.',
    status: 'backlog', priority: 4, creator_id: 'mem-charlie',
    lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(21, 10, 15), updated_at: iso(21, 10, 15),
  },
  {
    id: 'iss-13', workspace_id: 'ws-fixture', team_id: 'team-ops', number: 16, identifier: 'OPS-16',
    title: 'Import job progress endpoint returns 200 with empty body on unknown id',
    description: 'GET /import/jobs/{id} for a nonexistent id should 404; today it 200s with {} and the UI spins forever.',
    status: 'in_review', priority: 2, assignee_id: 'mem-charlie', creator_id: 'mem-alpha',
    lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(17, 13, 50), updated_at: iso(22, 9, 15),
  },
  {
    id: 'iss-14', workspace_id: 'ws-fixture', team_id: 'team-ops', number: 17, identifier: 'OPS-17',
    title: 'Time-tracking summary mixes timezones in the weekly rollup',
    description: 'Entries logged after 22:00 UTC land in the next day’s bucket for UTC-negative members. Roll up in the workspace timezone.',
    status: 'done', priority: 2, assignee_id: 'mem-bravo', creator_id: 'mem-bravo',
    completed_at: iso(21, 12, 45), lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
    created_at: iso(10, 8, 30), updated_at: iso(21, 12, 45),
  },
]

export const FIXTURE_COMMENTS: TrackComment[] = [
  { id: 'com-1', issue_id: 'iss-1', author_id: 'mem-owner', body: 'Repro confirmed on a clean deploy — window is 2.4s on the staging VM. The health probe interval is the whole story.', created_at: iso(15, 10, 2), updated_at: iso(15, 10, 2) },
  { id: 'com-2', issue_id: 'iss-1', author_id: 'mem-alpha', body: 'Queueing beats 503 here: the pool is guaranteed non-empty within one probe tick, so a 250ms hold absorbs the whole window.', created_at: iso(16, 9, 41), updated_at: iso(16, 9, 41) },
  { id: 'com-3', issue_id: 'iss-1', author_id: 'mem-bravo', body: 'Careful with the hold: the client SDK retries on 502 already. Queue + retry stacks to ~4s worst case.', edited_at: iso(16, 12, 0), created_at: iso(16, 11, 48), updated_at: iso(16, 12, 0) },
  { id: 'com-4', issue_id: 'iss-2', author_id: 'mem-owner', body: 'The error body is shared with three other gates — adding a URL there means adding it everywhere or special-casing. Leaning special-case.', created_at: iso(18, 15, 22), updated_at: iso(18, 15, 22) },
  { id: 'com-5', issue_id: 'iss-9', author_id: 'mem-alpha', body: 'Dual-secret window verified in staging; both secrets validate for the overlap. Cutover doc drafted.', created_at: iso(21, 11, 28), updated_at: iso(21, 11, 28) },
]
