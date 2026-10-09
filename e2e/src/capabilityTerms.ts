// B30.122 — each money capability's terms (Lens B30.9), on Lens's API, once a run, on a workspace of its own.
//
// A new workspace reads GET …/terms: every one of the nineteen B30 capabilities must be listed once, with a version, and
// not yet accepted. It reads GET …/terms/fx: the text must start "# Draft — for legal review", as every terms text does until
// a lawyer has reviewed it. Its owner accepts that version (POST …/terms/fx/accept {"version": n}): 201, the acceptance naming
// the person who accepted it, and the list then shows fx accepted at that version by that person. Accepting a version one
// higher than the latest must be 409.
//
// Whether an unaccepted capability refuses its money is proved in Lens's real-PG tests: nothing a workspace can do yet moves
// money in currencies (economy.PostMoney has no route). Add that leg here when B30.29's conversion route exists.

import { fail } from './bank.ts'
import { B30_CAPABILITIES } from './clearances.ts'
import type { TermsAcceptance, WorkspaceTerms } from './lens.ts'
import { said } from './routes.ts'
import type { Scenario } from './scenarios.ts'

const PATH = '/v1/workspaces/{ws}/terms'
/** How every terms text starts until a lawyer has reviewed it (Lens economy.TermsDraftHeading). */
export const DRAFT_HEADING = '# Draft — for legal review'

/** What is wrong with a new workspace's list of terms: undefined when every B30 capability is listed once, versioned, unaccepted. */
export function termsListFault(listed: readonly WorkspaceTerms[]): string | undefined {
  const wrong: string[] = []
  for (const key of Object.keys(B30_CAPABILITIES)) {
    const rows = listed.filter((t) => t.capability === key)
    if (rows.length === 0) { wrong.push(`${key} is not listed`); continue }
    if (rows.length > 1) wrong.push(`${key} is listed ${rows.length} times`)
    const t = rows[0]
    if (!Number.isInteger(t.version) || t.version < 1) wrong.push(`${key} has no version (${String(t.version)})`)
    if (t.accepted != null) wrong.push(`${key} reads accepted (version ${t.accepted.version} by ${t.accepted.person}) on a workspace that has accepted nothing`)
  }
  if (wrong.length === 0) return undefined
  return `of the ${Object.keys(B30_CAPABILITIES).length} B30 capabilities' terms on a new workspace: ${wrong.join('; ')}`
}

export function capabilityTerms(): Scenario {
  return {
    id: 'capability-terms',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    title: "each money capability's terms: a new workspace lists all nineteen, versioned and unaccepted; fx's text is a draft for legal review; " +
      'accepting its version is 201 naming the person and the list then reads it accepted; a version one higher is 409',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [owner] = await lens.createUsers(1)

      const list = await lens.act<{ terms: WorkspaceTerms[] | null }>(owner, 'GET', PATH)
      ctx.evidence.push({ note: 'a new workspace reads its terms', answer: list.ok ? (list.value.terms ?? []).map((t) => `${t.capability} v${t.version}${t.accepted ? ' accepted' : ''}`).join(', ') : said(list) })
      if (!list.ok) return fail(`a new workspace's read of its terms was refused: ${said(list)}`)
      const listed = list.value.terms ?? []
      const unlisted = termsListFault(listed)
      if (unlisted !== undefined) return fail(unlisted)

      const fx = await lens.act<WorkspaceTerms>(owner, 'GET', `${PATH}/fx`)
      ctx.evidence.push({ note: "the owner reads fx's terms", answer: fx.ok ? `version ${fx.value.version}: ${JSON.stringify((fx.value.body ?? '').slice(0, 80))}` : said(fx) })
      if (!fx.ok) return fail(`reading fx's terms was refused: ${said(fx)}`)
      const version = fx.value.version
      if (version !== listed.find((t) => t.capability === 'fx')?.version) return fail(`fx's terms read version ${version}; the list says ${listed.find((t) => t.capability === 'fx')?.version}`)
      if (!(fx.value.body ?? '').startsWith(DRAFT_HEADING)) {
        return fail(`fx's terms must start "${DRAFT_HEADING}" until a lawyer has reviewed them; they start ${JSON.stringify((fx.value.body ?? '').slice(0, 60))}`)
      }

      const accepted = await lens.act<{ acceptance: TermsAcceptance }>(owner, 'POST', `${PATH}/fx/accept`, { version })
      ctx.evidence.push({ note: `the owner accepts version ${version} of fx's terms`, answer: said(accepted) })
      if (accepted.status !== 201 || !accepted.ok) return fail(`accepting version ${version} of fx's terms must answer 201; Lens answered ${said(accepted)}`)
      const a = accepted.value.acceptance
      if (a?.capability !== 'fx' || a.version !== version || a.workspace_id !== owner.workspaceID) {
        return fail(`the acceptance must be of fx version ${version} for workspace ${owner.workspaceID}; it reads ${JSON.stringify(a)}`)
      }
      if ((a.person ?? '') === '' || a.person === 'operator') return fail(`the acceptance must name the person of the workspace who accepted; it names ${JSON.stringify(a.person)}`)

      const after = await lens.act<{ terms: WorkspaceTerms[] | null }>(owner, 'GET', PATH)
      const fxAfter = after.ok ? (after.value.terms ?? []).find((t) => t.capability === 'fx') : undefined
      ctx.evidence.push({ note: 'the workspace reads its terms again', answer: after.ok ? JSON.stringify(fxAfter) : said(after) })
      if (!after.ok) return fail(`reading the terms after accepting fx was refused: ${said(after)}`)
      if (fxAfter?.accepted?.version !== version || fxAfter.accepted.person !== a.person) {
        return fail(`after accepting fx's version ${version}, the list must read it accepted by ${a.person}; it reads ${JSON.stringify(fxAfter?.accepted ?? null)}`)
      }

      const ahead = await lens.act<{ acceptance: TermsAcceptance }>(owner, 'POST', `${PATH}/fx/accept`, { version: version + 1 })
      ctx.evidence.push({ note: `the owner accepts version ${version + 1} of fx's terms, which is not published`, answer: said(ahead) })
      if (ahead.status !== 409) return fail(`accepting version ${version + 1} of fx's terms, one past the latest, must be 409; Lens answered ${said(ahead)}`)

      return {
        pass: true,
        detail: `all ${Object.keys(B30_CAPABILITIES).length} B30 capabilities' terms listed, versioned and unaccepted; fx's version ${version} is a draft for legal review; ` +
          `accepting it answered 201 naming ${a.person} and the list reads it accepted; version ${version + 1} answered 409`,
      }
    },
  }
}
