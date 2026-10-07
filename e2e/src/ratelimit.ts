// B28.288 — RATE LIMITS HOLD. Lens's rate limiter (talyvor-lens internal/ratelimit) counts each key's requests in Redis
// over a second, a minute and an hour — 100, 1,000 and 10,000 by default — and answers one past a window 429 with
// Retry-After before any handler runs. When Redis errors it lets every request through (it fails open), so a burst the
// limiter does not refuse is what that looks like from outside. One scenario, on a workspace of its own:
//   rate-limits-hold — the workspace's own token reads the workspace once (the control), then sends bursts of reads at
//        once until one is refused. A burst nothing refuses is the FAIL. Each refusal must be 429 with Retry-After in whole
//        seconds (at least one), the same seconds and the window it hit in its body, and X-RateLimit-Remaining 0; once the
//        longest Retry-After has passed, the next read is served.
// A read moves no money, so a burst costs nothing; the hour window (10,000) is never reached by the most this sends.

import { setTimeout as sleep } from 'node:timers/promises'
import { fail } from './bank.ts'
import { verdictOf } from './gateway.ts'
import type { BurstAnswer } from './lens.ts'
import type { Scenario } from './scenarios.ts'

/** How many reads go at once: past Lens's 100 a second a key, by half again. */
const AT_ONCE = 150
/** The most bursts sent before the limiter is judged to refuse none: 600 reads stay under the minute's 1,000. */
const BURSTS = 4
/** How long a read in a burst is given. */
const READ_MS = 20_000
/** The longest Retry-After waited out: the minute window, and the shared HA limiter's 60 s, by a second. */
const WAIT_MAX_S = 61

/** What is wrong with the refusals in `answers`: each must say when to come back, in its headers and its body. */
export function refusalFaults(answers: readonly BurstAnswer[]): string[] {
  const refused = answers.filter((a) => a.status === 429)
  const faults = new Map<string, number>()
  const add = (what: string) => faults.set(what, (faults.get(what) ?? 0) + 1)
  for (const a of refused) {
    const secs = a.retryAfter === null ? NaN : /^\d+$/.test(a.retryAfter.trim()) ? Number(a.retryAfter) : NaN
    if (a.retryAfter === null) add('carried no Retry-After')
    else if (!(secs >= 1)) add(`carried Retry-After "${a.retryAfter}", not a whole number of seconds of at least 1`)
    if (a.remaining !== '0') add(`carried X-RateLimit-Remaining ${a.remaining === null ? '(none)' : `"${a.remaining}"`}, not 0`)
    let body: { limit_type?: unknown; retry_after_seconds?: unknown } = {}
    try {
      body = JSON.parse(a.text) as typeof body
    } catch {
      add('answered no JSON body')
      continue
    }
    if (typeof body.limit_type !== 'string' || body.limit_type === '') add('named no limit_type (the window it hit)')
    if (Number.isFinite(secs) && body.retry_after_seconds !== secs) add(`said retry_after_seconds ${String(body.retry_after_seconds)} against Retry-After ${secs}`)
  }
  const out = [...faults].map(([what, n]) => `${n} of the ${refused.length} refusals ${what}`)
  const others = new Map<number, number>()
  for (const a of answers) if (a.status !== 200 && a.status !== 429 && a.status !== 0) others.set(a.status, (others.get(a.status) ?? 0) + 1)
  if (others.size > 0) out.push(`the burst was answered ${[...others].map(([s, n]) => `${s} ×${n}`).join(', ')}, neither served nor refused 429`)
  return out
}

export function rateLimitsHold(): Scenario {
  return {
    id: 'rate-limits-hold',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Rate limits',
    title: `a burst of ${AT_ONCE} reads at once on the workspace's own token is refused past Lens's limit — 429 with Retry-After in whole seconds, ` +
      'the same in its body with the window it hit, X-RateLimit-Remaining 0 — never all served (as when the limiter fails open on a Redis error), and the next read once Retry-After has passed is served',
    run: async (ctx) => {
      const { lens } = ctx.env
      const { token, workspaceID } = ctx.app.user
      const path = `/v1/workspaces/${workspaceID}`
      const [control] = await lens.burst(token, path, 1, READ_MS)
      ctx.evidence.push({ note: `the control, one read of the workspace: ${control.status}, X-RateLimit-Remaining ${control.remaining ?? '(none)'}` })
      if (control.status !== 200) return fail(`one read of the workspace on its own token answered ${control.status} "${control.text}" before any burst`)

      const all: BurstAnswer[] = []
      let bursts = 0
      while (bursts < BURSTS && !all.some((a) => a.status === 429)) {
        all.push(...(await lens.burst(token, path, AT_ONCE, READ_MS)))
        bursts++
      }
      const served = all.filter((a) => a.status === 200).length
      const refused = all.filter((a) => a.status === 429)
      const lost = all.filter((a) => a.status === 0)
      ctx.evidence.push({ note: `${bursts} burst(s) of ${AT_ONCE} reads at once: ${served} served, ${refused.length} refused 429, ${lost.length} not answered` +
        (refused.length > 0 ? `; the first refusal: Retry-After ${refused[0].retryAfter ?? '(none)'}, ${refused[0].text.trim()}` : '') })
      if (lost.length > all.length / 2) throw new Error(`${lost.length} of ${all.length} reads in the burst were not answered: ${lost[0].text}`)
      if (refused.length === 0) {
        return fail(`${all.length} reads of the workspace on one token, in ${bursts} bursts of ${AT_ONCE} at once, were none of them refused (${served} served) — ` +
          "Lens's limiter (100 a second a key) let the burst through, as it does when Redis errors and it fails open")
      }
      const wrong = refusalFaults(all)

      // It lets go: once the longest Retry-After it gave has passed, the next read is served.
      const wait = Math.min(Math.max(...refused.map((a) => Number(a.retryAfter) || 1)), WAIT_MAX_S)
      await sleep(wait * 1000 + 500)
      const [after] = await lens.burst(token, path, 1, READ_MS)
      ctx.evidence.push({ note: `${wait} s later, once the longest Retry-After had passed: ${after.status}` })
      if (after.status !== 200) wrong.push(`the read ${wait} s later, once the longest Retry-After had passed, answered ${after.status} "${after.text}": the limiter does not let go`)
      return verdictOf(wrong, `of ${all.length} reads sent in ${bursts} burst(s) of ${AT_ONCE} at once, ${served} were served and ${refused.length} refused 429 with Retry-After ` +
        `(${[...new Set(refused.map((a) => a.retryAfter))].join(', ')} s), the window in the body and nothing remaining; the read ${wait} s later was served`)
    },
  }
}
