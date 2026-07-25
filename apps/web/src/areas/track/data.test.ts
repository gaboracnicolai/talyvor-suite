import { describe, expect, it } from 'vitest'
import { filterIssues, memberName, teamIdentifier } from './data'
import type { TrackIssue, TrackMember, TrackTeam } from './types'

// The query semantics mirror Track's own WHERE clauses, so they are worth keeping tested even
// while no upstream is wired — they are what the live list will use.
//
// NOTE WHERE THIS SAMPLE DATA LIVES: here, in the test, not in a fixtures.ts that screens
// render from. That distinction is the whole lesson of this change. Rows a test declares are
// inputs to an assertion; rows a module exports become numbers on someone's screen.

const ISSUE = (over: Partial<TrackIssue>): TrackIssue => ({
  id: 'i', workspace_id: 'w', team_id: 'team-a', number: 1, identifier: 'A-1',
  title: 't', description: '', status: 'todo', priority: 0, creator_id: 'm1',
  lens_feature: '', ai_cost_usd: 0, ai_tokens: 0,
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
  ...over,
})

const ISSUES: TrackIssue[] = [
  ISSUE({ id: 'i1', status: 'done', assignee_id: 'm1', team_id: 'team-a', updated_at: '2026-07-03T00:00:00Z' }),
  ISSUE({ id: 'i2', status: 'todo', assignee_id: 'm2', team_id: 'team-a', updated_at: '2026-07-05T00:00:00Z' }),
  ISSUE({ id: 'i3', status: 'done', assignee_id: 'm2', team_id: 'team-b', updated_at: '2026-07-04T00:00:00Z' }),
  ISSUE({ id: 'i4', status: 'todo', team_id: 'team-b', updated_at: '2026-07-02T00:00:00Z' }), // unassigned
]

const NONE = { status: '', assignee_id: '', team_id: '' }

describe('filterIssues mirrors the server WHERE semantics', () => {
  it('empty filter returns everything, newest-updated first', () => {
    expect(filterIssues(ISSUES, NONE).map((i) => i.id)).toEqual(['i2', 'i3', 'i1', 'i4'])
  })

  it('each filter narrows to an exact match', () => {
    expect(filterIssues(ISSUES, { ...NONE, status: 'done' }).map((i) => i.id)).toEqual(['i3', 'i1'])
    expect(filterIssues(ISSUES, { ...NONE, assignee_id: 'm2' }).map((i) => i.id)).toEqual(['i2', 'i3'])
    expect(filterIssues(ISSUES, { ...NONE, team_id: 'team-b' }).map((i) => i.id)).toEqual(['i3', 'i4'])
  })

  it('an assignee filter never matches an unassigned issue', () => {
    expect(filterIssues(ISSUES, { ...NONE, assignee_id: 'm1' }).map((i) => i.id)).toEqual(['i1'])
  })

  it('filters AND together, and an impossible combination is empty rather than an error', () => {
    expect(filterIssues(ISSUES, { status: 'done', assignee_id: 'm2', team_id: 'team-b' }).map((i) => i.id)).toEqual(['i3'])
    expect(filterIssues(ISSUES, { status: 'done', assignee_id: 'm1', team_id: 'team-b' })).toEqual([])
  })

  it('does not mutate its input', () => {
    const before = ISSUES.map((i) => i.id)
    filterIssues(ISSUES, NONE)
    expect(ISSUES.map((i) => i.id)).toEqual(before)
  })
})

describe('ids resolve through the roster, never inventing a name', () => {
  const members: TrackMember[] = [
    { id: 'm1', name: 'Ada', email: 'ada@corp.example', role: 'owner', avatar_url: '' },
  ]
  const teams: TrackTeam[] = [
    { id: 'team-a', workspace_id: 'w', name: 'Alpha', identifier: 'ALP', color: '', icon: '', created_at: '', updated_at: '' },
  ]

  it('resolves a known id and dashes the unknown or absent', () => {
    expect(memberName(members, 'm1')).toBe('Ada')
    expect(memberName(members, 'nope')).toBe('—')
    expect(memberName(members, undefined)).toBe('—')
    expect(teamIdentifier(teams, 'team-a')).toBe('ALP')
    expect(teamIdentifier(teams, 'nope')).toBe('—')
  })
})
