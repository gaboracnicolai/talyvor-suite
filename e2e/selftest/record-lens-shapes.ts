// B26.24 — records lens-shapes.json from a real Lens: a new synthetic workspace, seeded as the stub's
// test seeds one, and every read in READS, its status and the shape of its answer.
//
//   LENS_URL=http://127.0.0.1:8080 LENS_SYNTHETIC_KEY=… LENS_MODERATOR_KEY=… \
//     LENS_COMMIT=$(git -C ../talyvor-lens rev-parse --short HEAD) node --experimental-strip-types --no-warnings selftest/record-lens-shapes.ts
//
// Run it against a Lens built from talyvor-lens main whose billing is on and sells plans to test
// workspaces (LENS_BILLING_ENABLED, LENS_STRIPE_TEST_SECRET_KEY, LENS_STRIPE_TEST_WEBHOOK_SECRET,
// LENS_STRIPE_TEST_SUBSCRIPTION_PLANS — placeholders do, nothing here reaches Stripe), as production
// is. The moderator key is one `lens moderator-keys create` made on that Lens. Re-record when Lens changes
// an answer or the app starts reading a route not in READS.

import { writeFileSync } from 'node:fs'
import { MODERATOR_READS, READS, Reader, type Recorded, fill, moderatorHeaders, shapeOf } from './lens-shapes.ts'

const base = process.env.LENS_URL ?? 'http://127.0.0.1:8080'
const lens = new Reader(base, process.env.LENS_SYNTHETIC_KEY ?? '')
const { ws, token } = await lens.workspace()
const agent = await lens.seed(ws, token)
const out: Recorded = { lens: process.env.LENS_COMMIT ?? 'unknown', recorded_at: new Date().toISOString().slice(0, 10), reads: {} }
const moderator = process.env.LENS_MODERATOR_KEY ?? ''
for (const path of [...READS, ...MODERATOR_READS]) {
  const a = MODERATOR_READS.includes(path)
    ? await lens.send(moderator, 'GET', path, undefined, moderatorHeaders(moderator))
    : await lens.send(token, 'GET', fill(path, ws, agent))
  out.reads[path] = a.status < 300 ? { status: a.status, shape: shapeOf(a.json) } : { status: a.status }
  console.log(`${a.status} ${path}`)
}
writeFileSync(new URL('./lens-shapes.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`)
