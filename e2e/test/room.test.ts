import { describe, expect, it } from 'vitest'
import type { Agent, LensClient, SyntheticUser } from '../src/lens.ts'
import { roomForAgents } from '../src/room.ts'
import type { Evidence } from '../src/scenarios.ts'

const user = { index: 1, workspaceID: 'ws1', token: 't' } as SyntheticUser
const agent = (name: string, archived = false): Agent =>
  ({ id: name, name, balance_ulxc: 0, spent_ulxc: 0, ...(archived ? { archived_at: '2026-10-06T00:00:00Z' } : {}) })

/** Lens as far as roomForAgents reads it: Free's three agents, the book oldest first, and an archive that `refuse` turns away. */
function fakeLens(agents: Agent[], refuse: string[] = []): { lens: LensClient; archived: string[] } {
  const archived: string[] = []
  const lens = {
    workspacePlan: async () => ({ plan: 'free', gates: { agents: 3 }, agents_used: agents.filter((a) => a.archived_at === undefined).length }),
    agentBook: async () => ({ agents }),
    archiveAgent: async (_u: SyntheticUser, id: string) => {
      if (refuse.includes(id)) return { ok: false, status: 409, error: 'pots hold money' }
      archived.push(id)
      return { ok: true, status: 200, value: null }
    },
  } as unknown as LensClient
  return { lens, archived }
}

describe('room for agents on the plan (B34.1)', () => {
  it("archives the oldest active agents, passing over an archived or refused one, until the new ones fit; on a plan with room, none", async () => {
    const evidence: Evidence[] = []
    const full = fakeLens([agent('old', true), agent('a'), agent('b'), agent('c')], ['a'])
    await roomForAgents(full.lens, user, 2, evidence)
    expect(full.archived).toEqual(['b', 'c'])
    expect(evidence[0].note).toContain('archived a (refused: 409 pots hold money), b, c; 1 left')

    const roomy = fakeLens([agent('a')])
    await roomForAgents(roomy.lens, user, 2, [])
    expect(roomy.archived).toEqual([])
  })
})
