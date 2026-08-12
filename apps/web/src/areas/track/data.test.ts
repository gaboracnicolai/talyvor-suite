import { describe, expect, it } from 'vitest'
import { memberName, teamIdentifier } from './data'
import type { TrackMember, TrackTeam } from './types'

// ⚠ FIVE TESTS FOR `filterIssues` STOOD HERE, AND THE FUNCTION THEY EXERCISED WAS NEVER CALLED BY
// THE PRODUCT. They are deleted with it (#173): the live list forwards every control to the BFF
// and filters nothing client-side, so a mirror of Track's WHERE clauses had no caller and no
// second opinion — its own docstring called `updated_at DESC` "the server's default listing
// order" while the server defaults to created_at, and five green tests could not see that,
// because they compared the function to itself.
//
// NOTE WHERE THIS SAMPLE DATA LIVES: here, in the test, not in a fixtures.ts that screens render
// from. That distinction is the whole lesson of the change that created this file. Rows a test
// declares are inputs to an assertion; rows a module exports become numbers on someone's screen.

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
