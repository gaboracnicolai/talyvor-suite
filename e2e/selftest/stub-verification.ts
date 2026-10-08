// B30.117 SELF-TEST — the stand-in Lens's verification levels (Lens B30.4), as verification-levels reads and writes them:
// GET …/verification and POST …/verification/contact (L1), /identity (L2) and /company (L3), each needing the level below
// it (409 otherwise). Every check is the Test provider's and passes, so it counts for test money only: the live level
// stays L0. Its defects:
//   verification-unordered — an identity check before the email and phone check is accepted
//   test-pass-live         — a Test provider's pass counts live: the live level follows the level
// (and stub-bank.ts's level-needed-wrong lists payments_out as needing L0.)

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

interface Check { level: number; subject: string; method: string; test: boolean; status: string; evidence_ref: string; verified_name?: string; country?: string; started_at: string; checked_at: string }

const MEANINGS = ['signed in', 'email and phone confirmed', 'identity checked', 'company checked']
const SUBJECTS: Record<string, [number, string]> = { contact: [1, 'contact'], identity: [2, 'person'], company: [3, 'company'] }

export class VerificationDesk {
  private readonly checks = new Map<string, Check[]>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean

  constructor(json: VerificationDesk['json'], body: VerificationDesk['body'], broken: VerificationDesk['broken']) {
    this.json = json
    this.body = body
    this.broken = broken
  }

  /** The workspace's verification routes: true when `rest` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, rest: string, now: string): Promise<boolean> {
    if (rest === '/verification' && req.method === 'GET') return this.json(res, 200, this.record(ws)), true
    const m = /^\/verification\/(contact|identity|company)$/.exec(rest)
    if (m === null || req.method !== 'POST') return false
    const [level, subject] = SUBJECTS[m[1]]
    const b = await this.body<{ name?: string; country?: string; email?: string; phone?: string }>(req)
    const have = this.reached(ws).level
    if (have < level - 1 && !(level === 2 && this.broken('verification-unordered'))) {
      return this.json(res, 409, { error: `economy: verification levels are reached in order: the ${MEANINGS[level]} check (L${level}) needs L${level - 1} — ${MEANINGS[level - 1]} — first; this workspace is at L${have}` }), true
    }
    const c: Check = { level, subject, method: 'test', test: true, status: 'completed', evidence_ref: `kyc_${randomUUID()}`, started_at: now, checked_at: now,
      ...(level === 1 ? {} : { verified_name: b.name ?? '', country: b.country ?? '' }) }
    this.checks.set(ws, [c, ...(this.checks.get(ws) ?? [])])
    return this.json(res, 201, { check: { ...c, level: `L${level}` }, verification: this.record(ws) }), true
  }

  /** B30.118 — the workspace's level and live level, as an agent's credential states its owner's (stub-kya.ts). */
  levels(ws: string): { level: string; live_level: string } {
    const { level, live } = this.reached(ws)
    return { level: `L${level}`, live_level: `L${live}` }
  }

  private reached(ws: string): { level: number; live: number } {
    const passed = new Set((this.checks.get(ws) ?? []).filter((c) => c.status === 'completed').map((c) => c.level))
    let level = 0
    while (level < 3 && passed.has(level + 1)) level++
    return { level, live: this.broken('test-pass-live') ? level : 0 }
  }

  private record(ws: string): object {
    const { level, live } = this.reached(ws)
    return { workspace_id: ws, level: `L${level}`, meaning: MEANINGS[level], live_level: `L${live}`, live_meaning: MEANINGS[live],
      checks: (this.checks.get(ws) ?? []).map((c) => ({ ...c, level: `L${c.level}` })) }
  }
}
