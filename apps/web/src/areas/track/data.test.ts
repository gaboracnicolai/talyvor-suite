import { describe, expect, it } from 'vitest'
import { filterIssues, memberName, teamIdentifier } from './data'
import { FIXTURE_ISSUES, FIXTURE_MEMBERS, FIXTURE_TEAMS } from './fixtures'

// filterIssues mirrors the server's List WHERE semantics (issue/handler.go): each
// non-empty param is an exact-match AND; empty means absent. These tests pin that
// contract so the fixture behaviour and the eventual live behaviour can't drift apart
// silently.

const none = { status: '', assignee_id: '', team_id: '' }

describe('filterIssues', () => {
  it('empty filter returns everything, newest-updated first', () => {
    const out = filterIssues(FIXTURE_ISSUES, none)
    expect(out).toHaveLength(FIXTURE_ISSUES.length)
    for (let k = 1; k < out.length; k++) {
      expect(out[k - 1].updated_at >= out[k].updated_at).toBe(true)
    }
  })

  it('status narrows to exactly that status', () => {
    const out = filterIssues(FIXTURE_ISSUES, { ...none, status: 'done' })
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((i) => i.status === 'done')).toBe(true)
  })

  it('assignee narrows to exactly that member and never matches the unassigned', () => {
    const out = filterIssues(FIXTURE_ISSUES, { ...none, assignee_id: 'mem-jonas' })
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((i) => i.assignee_id === 'mem-jonas')).toBe(true)
  })

  it('team narrows to exactly that team', () => {
    const out = filterIssues(FIXTURE_ISSUES, { ...none, team_id: 'team-ops' })
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((i) => i.team_id === 'team-ops')).toBe(true)
  })

  it('filters AND together', () => {
    const out = filterIssues(FIXTURE_ISSUES, { status: 'done', assignee_id: 'mem-jonas', team_id: 'team-ops' })
    expect(out.map((i) => i.identifier)).toEqual(['OPS-14'])
  })

  it('an impossible combination is empty, not an error', () => {
    expect(filterIssues(FIXTURE_ISSUES, { ...none, status: 'cancelled', team_id: 'team-ops' })).toEqual([])
  })
})

describe('roster resolution', () => {
  it('resolves a member id to the roster name and dashes the unknown/unassigned', () => {
    expect(memberName(FIXTURE_MEMBERS, 'mem-amara')).toBe('Amara Okafor')
    expect(memberName(FIXTURE_MEMBERS, undefined)).toBe('—')
    expect(memberName(FIXTURE_MEMBERS, 'mem-ghost')).toBe('—')
  })

  it('resolves a team id to its identifier and dashes the unknown', () => {
    expect(teamIdentifier(FIXTURE_TEAMS, 'team-eng')).toBe('ENG')
    expect(teamIdentifier(FIXTURE_TEAMS, 'team-ghost')).toBe('—')
  })
})
