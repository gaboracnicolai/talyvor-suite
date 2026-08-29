import { describe, expect, it } from 'vitest'

import {
  BFF_DECODES,
  NO_SENDER_IN_THIS_REPO,
  decodedKeys,
  webRequestSites,
} from './bffRequestFields'

/**
 * EVERY FIELD THIS APP PUTS IN A REQUEST TO ITS OWN BFF IS ONE THE BFF DECODES — and every field
 * the BFF decodes is one something here sends, or is named in a table with a reason.
 *
 * ── WHY THIS DIRECTION HAD NO GUARD ──────────────────────────────────────────
 *
 * `lib/calledRoutes.test.ts` pins that every BFF ADDRESS this app names is one the BFF mounts.
 * `lensRequestBodyRegister.test.ts` pins what the BFF sends UPSTREAM. Between them the ADDRESS is
 * checked and the NEXT HOP's body is checked, and the fields in the request the browser actually
 * makes are checked by neither.
 *
 * ⚠ AND THE FAILURE HERE IS SILENT, WHICH IS THE HALF THAT NEEDS A GUARD MOST. talyvor-track
 * proved the loud half by execution (W3.68, merge `8359a30`): its `httpx.DecodeJSON` calls
 * `DisallowUnknownFields`, so an undeclared field is a 400 — and two shipped write paths were dead
 * that way with four censuses green over them. Measured in this repository before writing this
 * file: `DisallowUnknownFields` occurs ONCE in `apps/bff` and it is inside a COMMENT. Nothing here
 * refuses an unknown field, so the same defect answers **200 having changed nothing**. A 400
 * eventually reaches a bug report; a control that silently does nothing does not.
 *
 * ── THE RESULT, MEASURED AT 0b8a55e ───────────────────────────────────────────
 *
 *  · 29 `fetch` sites, 11 with a body. Eight are bounded by the type checker and EVERY field each
 *    one sends is decoded by the handler that serves it.
 *  · Three bodies the checker cannot bound, all three deliberate pass-throughs and all three named
 *    in `unboundedBodies` below WITH WHAT CONSUMES THEM — the BFF decodes no field of any of them.
 *  · ONE decoded field with no sender: `expires_at` on `POST /api/keys`. Every layer beneath the
 *    console implements key expiry and the console cannot set one. It is pinned in
 *    `NO_SENDER_IN_THIS_REPO`, not fixed: whether to offer the control is a product and
 *    security-posture decision.
 *
 * ── FLOORS ────────────────────────────────────────────────────────────────────
 *
 * Both halves report an ABSENCE, and a scanner that has gone blind reports the empty set, which
 * agrees with everything. The floors below are UNDER the measured counts, not AT them.
 */

const MIN_FETCH_SITES = 24 // 29 measured
const MIN_BODY_SITES = 9 // 11 measured

/**
 * The three bodies the type checker cannot bound, and what actually consumes each. An unbounded
 * body is an UNMEASURED contract; naming them is what keeps `bodyUnbounded` from being a quiet
 * exemption that grows.
 */
const unboundedBodies: Record<string, string> = {
  // ⚠ KEYED BY FILE + THE BODY EXPRESSION, NOT BY ROUTE OR BY LINE. Two of the three have no
  // literal route at the call site at all (the path and even the method are parameters), so a
  // route key would collide them onto one entry; a line number drifts on any edit above it.
  'src/areas/chat/chatApi.ts JSON.stringify(requestBody(provider, model, messages))':
    'requestBody() is declared `: unknown` and returns the PROVIDER-shaped chat body ' +
    '({ model, stream, messages }, plus max_tokens for anthropic). handleAIStream reads NO field ' +
    'of it — io.ReadAll then bytes.NewReader straight through to lens /v1/proxy/{provider}. The ' +
    'consumer is the model provider, across two repository boundaries, so there is no BFF field ' +
    'contract here to join to.',
  'src/areas/track/IssueDetail.tsx JSON.stringify(fields)':
    'IssueDetail.patch(fields: Record<string, unknown>) — one write path for every control on the ' +
    'screen. The BFF forwards verbatim and talyvor-track decodes into map[string]any, dropping ' +
    'any key not in its `updatableFields` allowlist WITHOUT A WORD (its own comment says so, and ' +
    'that silence is how `milestone_id` was unwritable while answering 200). The four keys this ' +
    'screen actually sends — description, status, priority, assignee_id — were each checked ' +
    'against that allowlist (talyvor-track internal/issue/store.go, read 2026-08-29) and all four ' +
    'are in it. ⚠ CI CANNOT RE-VERIFY THAT HALF: it checks out this repository alone.',
  'src/areas/docs/api.ts JSON.stringify(body)':
    'areas/docs/api.ts#send(path, method, body: unknown) is the shared Docs writer — the path AND ' +
    'the method are parameters, so this site names no route. The Docs page-write field contract ' +
    'is pinned separately and by name in docsPageWriteRegister.test.ts.',
}

describe('the fields this app sends to its own BFF', () => {
  it('the scan sees the app at all', () => {
    const sites = webRequestSites()
    const withBody = sites.filter((s) => s.bodyFields !== null)
    expect(
      sites.length,
      `only ${sites.length} fetch sites found; 29 were measured at 0b8a55e. Do not lower this ` +
        'floor to make a red go green — find out why the scan stopped seeing the app.',
    ).toBeGreaterThanOrEqual(MIN_FETCH_SITES)
    expect(withBody.length).toBeGreaterThanOrEqual(MIN_BODY_SITES)
  })

  it('every unbounded body is named with what consumes it', () => {
    const unnamed = webRequestSites()
      .filter((s) => s.bodyFields !== null && s.bodyUnbounded)
      .map((s) => `${s.file} ${s.bodyRaw ?? '?'}`)
      .filter((k) => !(k in unboundedBodies))
    expect(
      unnamed,
      'a request body whose keys the type checker cannot bound is an UNMEASURED contract. Name ' +
        'it in `unboundedBodies` with what consumes it, or narrow the call site so the checker ' +
        'can read it. Leaving it unnamed makes the census look complete when it is not.',
    ).toEqual([])
  })

  it('every BFF request decode is locatable, so an absent key set is never read as agreement', () => {
    for (const d of BFF_DECODES) {
      expect(
        decodedKeys(d),
        `${d.route}: the anchor ${JSON.stringify(d.anchor)} inside ${JSON.stringify(d.fn)} in ` +
          `apps/bff/${d.file} did not resolve to a key set. An anchor that matches twice parses ` +
          'the wrong struct and one that matches zero times parses nothing — both compare equal ' +
          'to an empty set, which is why this is a red rather than a skip.',
      ).not.toBeNull()
    }
  })

  it('every field this app sends is one the BFF decodes', () => {
    const decoded = new Map<string, string[]>()
    for (const d of BFF_DECODES) decoded.set(d.route, decodedKeys(d) ?? [])

    const dropped: string[] = []
    let joined = 0
    for (const s of webRequestSites()) {
      if (s.bodyFields === null || s.bodyUnbounded) continue
      const key = `${s.verb} ${s.path}`
      const keys = decoded.get(key)
      if (!keys) continue // not a decode route — the proxied ones are covered by the tests above
      joined += 1
      for (const f of s.bodyFields) {
        if (!keys.includes(f)) dropped.push(`${key} sends ${f} — the handler decodes ${keys.join(', ')}`)
      }
    }
    expect(
      joined,
      'the join matched no route at all. A join that matches nothing reports no dropped fields, ' +
        'which is the flattering direction — check that the paths on both sides still agree.',
    ).toBeGreaterThanOrEqual(BFF_DECODES.length)
    expect(
      dropped,
      'this BFF does not use DisallowUnknownFields, so a field it never decodes is dropped in ' +
        'SILENCE and the request answers 200. The control that did nothing looks exactly like the ' +
        'control that worked.',
    ).toEqual([])
  })

  it('every field the BFF decodes is sent here, or named with what reaches it', () => {
    const sent = new Map<string, Set<string>>()
    for (const s of webRequestSites()) {
      if (s.bodyFields === null) continue
      const key = `${s.verb} ${s.path}`
      const set = sent.get(key) ?? new Set<string>()
      for (const f of s.bodyFields) set.add(f)
      sent.set(key, set)
    }
    const unexplained: string[] = []
    for (const d of BFF_DECODES) {
      for (const f of decodedKeys(d) ?? []) {
        if (sent.get(d.route)?.has(f)) continue
        if (`${d.route} ${f}` in NO_SENDER_IN_THIS_REPO) continue
        unexplained.push(`${d.route} ${f}`)
      }
    }
    expect(
      unexplained,
      'a request field the BFF decodes that nothing here sends is a capability with no client. ' +
        'Some are deliberate; each needs a line saying which, in NO_SENDER_IN_THIS_REPO.',
    ).toEqual([])
  })

  it('the no-sender table may not excuse a field that IS sent', () => {
    // ⚠ WITHOUT THIS THE TABLE ROTS INTO A PERMANENT EXCUSE. Wiring a control for one of these
    // fields must SHRINK the table and red, exactly as `routesWithNoSPACaller` requires in
    // talyvor-track — otherwise the entry outlives the gap it documents and nobody notices.
    const stale: string[] = []
    for (const entry of Object.keys(NO_SENDER_IN_THIS_REPO)) {
      const idx = entry.lastIndexOf(' ')
      const route = entry.slice(0, idx)
      const field = entry.slice(idx + 1)
      for (const s of webRequestSites()) {
        if (`${s.verb} ${s.path}` !== route) continue
        if (s.bodyFields?.includes(field)) stale.push(entry)
      }
    }
    expect(
      stale,
      'these fields ARE sent now, so their no-sender entries are stale. Delete them — an entry ' +
        'that outlives the gap it documents is decoration.',
    ).toEqual([])
  })
})
