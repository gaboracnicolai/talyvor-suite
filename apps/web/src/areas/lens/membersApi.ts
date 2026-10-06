// B32.72 — adding a member from the Members screen.
//
//   POST /api/members  {"email": "…", "role": "member" | "owner"}  (apps/bff/track_members.go)
//
// The BFF adds the person to the session's Track workspace and relays Track's answer unchanged:
// 201 the new member; 402 Lens's refusal when the plan has no seat left ({error, code, plan, limit,
// allows} — `error` is Lens's own sentence); 409 MEMBER_EXISTS; 403 OWNER_REQUIRED; 503 SEATS_UNCHECKED.

import { ApiError } from '../../lib/api'

/** Track internal/model.Member, as POST answers it (its name is the email until the person signs in). */
export interface AddedMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  avatar_url: string
}

/** An add Track refused, with the sentence it (or, on 402, Lens) gave. */
export class MemberAddError extends ApiError {
  constructor(
    status: number,
    code: string | undefined,
    readonly sentence: string,
  ) {
    super(status, '/api/members', code)
  }
}

export async function addMember(email: string, role: 'owner' | 'member'): Promise<AddedMember> {
  const res = await fetch('/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, role }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<AddedMember> & { error?: string; code?: string }
  if (!res.ok) throw new MemberAddError(res.status, body.code, typeof body.error === 'string' ? body.error : '')
  return body as AddedMember
}
