// B17.3 — THE RUN. N synthetic users (default 100) each sign in to the real web app in a headless
// browser and run their journey through Chat, several at a time, under a hard spend cap (default $5).
// Then every user's ledger is read back. The results land in <out>/run-<time>.json.
//
//   LENS_SYNTHETIC_KEY=… node --experimental-strip-types src/run.ts \
//     --app https://app.talyvor.com --lens https://lens.talyvor.com [--users 100] [--cap-usd 5]
//
// Exit status: 0 when nothing failed, 1 when a scenario FAILED or ERRORED, 2 when the run could not start.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { AppUser, ChargeBook } from './app.ts'
import { CapReached, SpendCap } from './budget.ts'
import { type RunConfig, parseConfig } from './config.ts'
import { type CoverageMap, Matcher, Recorder, type Tag, buildMap, inventory, leastCovered, refreshLensCheckout } from './coverage.ts'
import { type ExplorerSummary, type Finding, explore } from './explore.ts'
import { fileItems } from './filing.ts'
import { LensClient, type SyntheticUser } from './lens.ts'
import { reportPath, writeReport, writeTesters } from './report.ts'
import { CannotTest, type Evidence, type RunEnv, checkLedger, journeyFor } from './scenarios.ts'

/** The repository this file is in: reports go to its docs/e2e unless told otherwise. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** The providers whose stream the web app reads (apps/web/src/areas/chat/chatApi.ts STREAMABLE_PROVIDERS). */
const STREAMABLE = ['openai', 'anthropic', 'google', 'mistral', 'groq', 'bedrock', 'vllm'] as const

export type Status = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR'

export interface Outcome {
  scenario: string
  title: string
  user: number
  workspace: string
  status: Status
  detail: string
  evidence: Evidence[]
  seconds: number
  /** B25.5 — the features it is reported under: the screens it opened, or the one it names. */
  features: string[]
}

export interface RunResult {
  started_at: string
  finished_at: string
  app: string
  lens: string
  users: number
  model: string
  cap_usd: number
  spent_usd: number
  /** The scenarios reached the cap: everything after it was skipped. */
  stopped_at_cap: boolean
  counts: Record<Status, number>
  outcomes: Outcome[]
  /** B17.5 — each explorer's session, and what they (or their browsers) found, to check. */
  explorers: ExplorerSummary[]
  findings: Finding[]
  /** B25.5 — every screen, BFF route and Lens route, and its state after this run. */
  coverage: CoverageMap
}

async function pool<T>(items: T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) await work(items[next++])
  })
  await Promise.all(lanes)
}

export async function run(cfg: RunConfig): Promise<RunResult> {
  const started = new Date()
  // B25.5 — what there is to test, read from the code before anything runs, and what is tested, as it is.
  const stale = cfg.lensRepo === undefined ? undefined : await refreshLensCheckout(cfg.lensSrc, cfg.lensRepo)
  if (stale !== undefined) console.log(`lens source: ${stale}`)
  const inv = await inventory(REPO, cfg.lensSrc)
  console.log(`inventory: ${inv.screens.length} screens, ${inv.bff.length} BFF routes, ` +
    `${inv.lensMissing === undefined ? `${inv.lens.length} Lens routes` : `no Lens routes (${inv.lensMissing})`}`)
  const rec = new Recorder()
  const screens = new Matcher(inv.screens, false)
  const featureAt = (path: string): string | undefined => screens.match('GET', path.replace(/(.)\/$/, '$1'))?.feature
  /** The features of the screens a scenario opened; a scenario that opened none stays on Chat, where every one starts. */
  const featuresOf = (paths: string[], named?: string): string[] => {
    const fs = [...new Set(paths.map(featureAt).filter((f): f is string => f !== undefined))]
    return fs.length > 0 ? fs : [named ?? 'Chat']
  }
  const lens = new LensClient(cfg.lensURL, cfg.syntheticKey, rec, undefined, undefined, cfg.moderatorKey)
  const cap = new SpendCap(cfg.capUSD)
  const book = new ChargeBook()

  const reset = await lens.reset()
  console.log(`reset ${reset} synthetic workspace(s): stored answers cleared, credits restored`)
  const users = await lens.createUsers(cfg.users)
  console.log(`created ${users.length} synthetic users`)
  const catalog = await lens.catalog(users[0])
  const usdPerLXC = await lens.usdPerLXC()
  if (!catalog.some((m) => m.display_name === cfg.model)) throw new Error(`the catalog has no model named "${cfg.model}"`)

  const browser = await chromium.launch({ headless: !cfg.headed })
  const signIn = (user: SyntheticUser) =>
    AppUser.signIn(browser, user, { appURL: cfg.appURL, syntheticKey: cfg.syntheticKey, cap, catalog, modelName: cfg.model, book, usdPerLXC, recorder: rec })
  const env: RunEnv = {
    inventory: inv,
    lens, cap, catalog, usdPerLXC, book,
    judgeProvider: cfg.judgeProvider,
    judgeModel: cfg.judgeModel,
    signInUser: (index) => signIn(users[index]),
    userAt: (index) => users[index],
    userCount: users.length,
  }

  const outcomes: Outcome[] = []
  try {
    await pool(users, cfg.concurrency, async (user) => {
      const journey = journeyFor(user.index, users.length, STREAMABLE)
      const base = { user: user.index, workspace: user.workspaceID }
      if (cap.reached) {
        for (const s of journey) outcomes.push({ ...base, scenario: s.id, title: s.title, status: 'SKIP', detail: 'spend cap reached', evidence: [], seconds: 0, features: featuresOf([], s.feature) })
        return
      }
      let app: AppUser
      try {
        app = await signIn(user)
      } catch (e) {
        for (const s of journey) outcomes.push({ ...base, scenario: s.id, title: s.title, status: 'ERROR', detail: `sign-in: ${String(e)}`, evidence: [], seconds: 0, features: featuresOf([], s.feature) })
        return
      }
      try {
        for (const s of journey) {
          const t0 = Date.now()
          const evidence: Evidence[] = []
          let status: Status
          let detail: string
          let where: string[] | undefined
          // Everything this scenario makes happen — its browser, a partner it signs in, its calls to
          // Lens — is recorded as its own, for the coverage map.
          const tag: Tag = { scenario: s.id, user: user.index }
          app.tag = tag
          const scenarioEnv: RunEnv = {
            ...env,
            lens: lens.tagged(tag),
            signInUser: async (index) => {
              const other = await signIn(users[index])
              other.tag = tag
              return other
            },
          }
          try {
            await app.newChat() // every scenario starts from an empty conversation
            const v = await s.run({ app, env: scenarioEnv, evidence })
            status = v.pass ? 'PASS' : 'FAIL'
            detail = v.detail
            if (!v.pass) where = v.where
          } catch (e) {
            status = e instanceof CapReached || e instanceof CannotTest ? 'SKIP' : 'ERROR'
            detail = e instanceof Error ? e.message : String(e)
            // Where it was when it broke — before going back to Chat, which is not where it broke.
            where = rec.screensOf(tag)
            if (status === 'ERROR') await app.openChat().catch(() => undefined)
          }
          outcomes.push({ ...base, scenario: s.id, title: s.title, status, detail, evidence, seconds: (Date.now() - t0) / 1000,
            features: featuresOf(where ?? rec.screensOf(tag), s.feature) })
          console.log(`${status.padEnd(5)} user ${String(user.index).padStart(3)} ${s.id}: ${detail}`)
        }
      } finally {
        await app.close()
      }
    })
  } finally {
    await browser.close()
  }

  // THE LEDGER, once nothing is in flight: a cross-account scenario charges its partner too.
  await pool(users, 10, async (user) => {
    const t0 = Date.now()
    let o: Outcome
    const ledgerEnv: RunEnv = { ...env, lens: lens.tagged({ scenario: 'ledger-matches-answers', user: user.index }) }
    try {
      const v = await checkLedger(ledgerEnv, user)
      o = { user: user.index, workspace: user.workspaceID, scenario: 'ledger-matches-answers',
        title: 'every charged answer is one spend row on the ledger; a free replay is none',
        status: v.pass ? 'PASS' : 'FAIL', detail: v.detail, evidence: v.evidence, seconds: (Date.now() - t0) / 1000, features: ['Ledger'] }
    } catch (e) {
      o = { user: user.index, workspace: user.workspaceID, scenario: 'ledger-matches-answers', title: 'ledger read-back',
        status: 'ERROR', detail: String(e), evidence: [], seconds: (Date.now() - t0) / 1000, features: ['Ledger'] }
    }
    outcomes.push(o)
  })

  outcomes.sort((a, b) => a.user - b.user)
  const counts: Record<Status, number> = { PASS: 0, FAIL: 0, SKIP: 0, ERROR: 0 }
  for (const o of outcomes) counts[o.status]++
  const stoppedAtCap = cap.reached

  // B17.5 — THE EXPLORERS, after the scenarios, under the same cap: whatever the scenarios left.
  const summaries: ExplorerSummary[] = []
  const findings: Finding[] = []
  if (cfg.explorers > 0 && !cap.reached) {
    const explorers = await lens.createUsers(cfg.explorers)
    // B25.5 (3) — every explorer is told every feature, and each starts at the next least covered.
    const perFeature = new Map<string, number>()
    for (const o of outcomes) for (const f of o.features) perFeature.set(f, (perFeature.get(f) ?? 0) + 1)
    const areas = leastCovered(buildMap(inv, rec), perFeature)
    console.log(`${explorers.length} explorers, up to ${cfg.exploreMinutes} minutes each, with $${(cfg.capUSD - cap.spentUSD).toFixed(2)} of the cap left; ` +
      `least covered first: ${areas.slice(0, explorers.length).map((a) => a.feature).join(', ')}`)
    const again = await chromium.launch({ headless: !cfg.headed })
    try {
      await Promise.all(explorers.map(async (user, n) => {
        let s: ExplorerSummary
        const start = areas.length > 0 ? areas[n % areas.length] : undefined
        const tag: Tag = { scenario: 'explorer', user: n }
        try {
          const app = await AppUser.signIn(again, user, { appURL: cfg.appURL, syntheticKey: cfg.syntheticKey, cap, catalog, modelName: cfg.model, book, usdPerLXC, recorder: rec, tag })
          try {
            s = await explore(n, app, { lens: lens.tagged(tag), cap, catalog, usdPerLXC, provider: cfg.judgeProvider, model: cfg.explorerModel,
              minutes: cfg.exploreMinutes, features: areas, start }, findings)
          } finally {
            await app.close()
          }
        } catch (e) {
          s = { explorer: n, steps: 0, stopped: 'error', detail: e instanceof Error ? e.message : String(e) }
        }
        s.start = start?.feature
        summaries.push(s)
        console.log(`explorer ${n}: ${s.steps} steps, stopped (${s.stopped}): ${s.detail}`)
      }))
    } finally {
      await again.close()
    }
    summaries.sort((a, b) => a.explorer - b.explorer)
  }
  for (const f of findings) f.feature = featureAt(f.where) ?? '(no screen)'
  return {
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    app: cfg.appURL,
    lens: cfg.lensURL,
    users: users.length,
    model: cfg.model,
    cap_usd: cfg.capUSD,
    spent_usd: Number(cap.spentUSD.toFixed(6)),
    stopped_at_cap: stoppedAtCap,
    counts,
    outcomes,
    explorers: summaries,
    findings,
    coverage: buildMap(inv, rec),
  }
}

async function main(): Promise<number> {
  let cfg: RunConfig
  try {
    cfg = parseConfig(process.argv.slice(2), process.env)
  } catch (e) {
    console.error(`e2e: ${e instanceof Error ? e.message : String(e)}`)
    return 2
  }
  let result: RunResult
  try {
    result = await run(cfg)
  } catch (e) {
    console.error(`e2e: the run could not complete: ${e instanceof Error ? e.message : String(e)}`)
    return 2
  }
  await mkdir(cfg.outDir, { recursive: true })
  const file = join(cfg.outDir, `run-${result.started_at.replace(/[:.]/g, '-')}.json`)
  await writeFile(file, JSON.stringify(result, null, 2) + '\n')
  const c = result.counts
  console.log(`\n${c.PASS} passed, ${c.FAIL} failed, ${c.ERROR} errored, ${c.SKIP} skipped — ` +
    `spent ≈ $${result.spent_usd.toFixed(4)} of a $${result.cap_usd.toFixed(2)} cap` +
    `${result.stopped_at_cap ? ' (STOPPED AT THE CAP)' : ''}` +
    (result.explorers.length > 0 ? `\n${result.explorers.length} explorers: ${result.findings.length} findings to check` : '') +
    `\nresults: ${file}`)

  // B17.4 — a build item for each scenario that FAILED and is not covered yet, then the day's report,
  // which names each failure's item. B25.5 (4) — then the run's summary for the morning brief.
  const reportDir = cfg.reportDir ?? join(REPO, 'docs/e2e')
  const planned = reportPath(reportDir, result.started_at)
  const shown = planned.startsWith(REPO + '/') ? relative(REPO, planned) : planned
  const filed: Record<string, string> = {}
  const newItems: string[] = []
  if (cfg.buildMd !== 'none') {
    const f = await fileItems(cfg.buildMd, result, shown)
    if (f === undefined) {
      console.log(`build items: no queue at ${cfg.buildMd}, so nothing was filed`)
    } else {
      for (const x of f.filed) {
        filed[x.scenario] = x.id
        newItems.push(x.id)
      }
      for (const x of f.covered) filed[x.scenario] = x.by
      console.log(`build items in ${cfg.buildMd}: ` +
        (f.filed.map((x) => `${x.id} (${x.scenario}, ${x.repo})`).join(', ') || 'none new') +
        (f.covered.length > 0 ? `; already open: ${f.covered.map((x) => `${x.scenario} → ${x.by}`).join(', ')}` : ''))
    }
  }
  const report = await writeReport(reportDir, { ...result, filed })
  console.log(`report: ${report}`)
  if (cfg.testersMd !== 'none') {
    await writeTesters(cfg.testersMd, { ...result, filed }, shown, newItems)
    console.log(`summary: ${cfg.testersMd}`)
  }
  return c.FAIL + c.ERROR > 0 ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main()
}
