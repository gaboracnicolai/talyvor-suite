// B17.3 — THE RUN. N synthetic users (default 100) each sign in to the real web app in a headless
// browser and run their journey through Chat, several at a time, under a hard spend cap (default $5).
// Then every user's ledger is read back. The results land in <out>/run-<time>.json.
//
//   LENS_SYNTHETIC_KEY=… node --experimental-strip-types src/run.ts \
//     --app https://app.talyvor.com --lens https://lens.talyvor.com [--users 100] [--cap-usd 5]
//
// Exit status: 0 when nothing failed, 1 when a scenario FAILED or ERRORED or the run stopped early, 2 when
// it could not start (its flags). B26.18 — whatever stops it, it writes its report and summary first.

import { realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type Browser, chromium } from 'playwright'
import { AppUser, ChargeBook } from './app.ts'
import { CapReached, SpendCap } from './budget.ts'
import { type RunConfig, parseConfig } from './config.ts'
import { type CoverageMap, type Inventory, Matcher, Recorder, type Tag, buildMap, cannotTest, inventory, leastCovered, refreshLensCheckout } from './coverage.ts'
import { type ExplorerSummary, type Finding, Notebook, explore } from './explore.ts'
import { fileItems } from './filing.ts'
import { LensClient, type SyntheticUser, describe } from './lens.ts'
import { groupLeads, reportPath, writeReport, writeTesters } from './report.ts'
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
  /** B26.18 — what ended the run before its end, and when; absent when it ran to the end or to the cap. */
  stopped_by?: string
  /** B26.18 — what went wrong under the run without ending it: a browser that went away, a stray error. */
  incidents: string[]
  counts: Record<Status, number>
  outcomes: Outcome[]
  /** B17.5 — each explorer's session, and what they (or their browsers) found, to check. */
  explorers: ExplorerSummary[]
  findings: Finding[]
  /** B25.5 — every screen, BFF route and Lens route, and its state after this run (none when it stopped before the inventory). */
  coverage?: CoverageMap
}

async function pool<T>(items: T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) await work(items[next++])
  })
  await Promise.all(lanes)
}

const stamp = (): string => new Date().toISOString()

/**
 * B26.18 — the longest the run waits on one thing. A browser call can hang with no timeout of its own
 * (BrowserContext.newPage did, after a browser was killed), and a run that waits on it never reports.
 */
const SIGN_IN_MS = 5 * 60_000
const SCENARIO_MS = 30 * 60_000
const LEDGER_MS = 5 * 60_000
const CLOSE_MS = 60_000

/** Settles as `work` does, or fails naming `what` once `ms` pass. */
function timed<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: nothing within ${ms / 60_000} minute(s), so it was abandoned`)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/**
 * B26.18 — the run's browser. One that crashes or is killed takes only the users in it with it: whoever
 * signs in next gets a new one, and the run's incidents say when the old one went.
 */
class Browsers {
  private readonly headed: boolean
  private readonly incidents: string[]
  private current: Promise<Browser> | undefined
  private closing = false

  constructor(headed: boolean, incidents: string[]) {
    this.headed = headed
    this.incidents = incidents
  }

  get(): Promise<Browser> {
    this.current ??= this.launch()
    return this.current
  }

  private launch(): Promise<Browser> {
    const launched: Promise<Browser> = chromium.launch({ headless: !this.headed }).then((b) => {
      b.on('disconnected', () => {
        if (this.closing) return
        this.incidents.push(`${stamp()} the browser went away mid-run (it crashed or was killed); the users in it errored and the rest had a new one`)
        if (this.current === launched) this.current = undefined
      })
      return b
    })
    // A launch that failed is tried again by the next sign-in.
    launched.catch(() => {
      if (this.current === launched) this.current = undefined
    })
    return launched
  }

  async close(): Promise<void> {
    this.closing = true
    const b = await this.current?.catch(() => undefined)
    await b?.close().catch(() => undefined)
  }
}

/**
 * The run. B26.18 — it never throws: a user, an explorer or a browser that crashes is that one's ERROR, and
 * whatever stops the run early (Lens unreachable, a stage that cannot go on) is its `stopped_by`, with
 * everything it did before that and what it spent.
 */
export async function run(cfg: RunConfig): Promise<RunResult> {
  const started = new Date()
  const incidents: string[] = []
  const outcomes: Outcome[] = []
  const summaries: ExplorerSummary[] = []
  const findings: Finding[] = []
  const rec = new Recorder()
  const lens = new LensClient(cfg.lensURL, cfg.syntheticKey, rec, undefined, undefined, cfg.moderatorKey)
  const cap = new SpendCap(cfg.capUSD)
  const book = new ChargeBook()
  let inv: Inventory | undefined
  let screens: Matcher | undefined
  let users: SyntheticUser[] = []
  let stoppedAtCap: boolean | undefined
  let stoppedBy: string | undefined
  let stage = 'reading what there is to test'
  // Once the run has stopped, nothing still in flight is waited for.
  let halt = (): void => undefined
  const halted = new Promise<void>((resolve) => {
    halt = resolve
  })
  const unlessStopped = <T>(what: string, work: Promise<T>): Promise<T> =>
    Promise.race([work, halted.then((): never => {
      throw new Error(`${what} was abandoned when the run stopped: ${stoppedBy}`)
    })])

  const featureAt = (path: string): string | undefined => screens?.match('GET', path.replace(/(.)\/$/, '$1'))?.feature
  /** The features of the screens a scenario opened; a scenario that opened none stays on Chat, where every one starts. */
  const featuresOf = (paths: string[], named?: string): string[] => {
    const fs = [...new Set(paths.map(featureAt).filter((f): f is string => f !== undefined))]
    return fs.length > 0 ? fs : [named ?? 'Chat']
  }
  /** Why what has not started yet will not: the run stopped, or the cap was reached. */
  const notRun = (): string | undefined => (stoppedBy !== undefined ? `not run: ${stoppedBy}` : cap.reached ? 'spend cap reached' : undefined)
  // After an ERROR: does Lens still answer? The first time it does not, the run stops there.
  let probing: Promise<void> | undefined
  const checkLens = (): Promise<void> => (probing ??= lens.unreachable().then((why) => {
    if (why === undefined) return
    stoppedBy ??= `Lens stopped answering at ${stamp()} (${why}) while ${stage}`
    halt()
  }).finally(() => {
    probing = undefined
  }))
  // A rejection nothing was waiting for (a browser's event, a forgotten promise) is noted, not the end of the run.
  const stray = (e: unknown): void => {
    incidents.push(`${stamp()} an error nothing was waiting for: ${describe(e)}`)
  }
  process.on('unhandledRejection', stray)

  try {
    // B25.5 — what there is to test, read from the code before anything runs, and what is tested, as it is.
    const stale = cfg.lensRepo === undefined ? undefined : await refreshLensCheckout(cfg.lensSrc, cfg.lensRepo)
    if (stale !== undefined) console.log(`lens source: ${stale}`)
    inv = await inventory(REPO, cfg.lensSrc)
    screens = new Matcher(inv.screens, false)
    console.log(`inventory: ${inv.screens.length} screens, ${inv.bff.length} BFF routes, ` +
      `${inv.lensMissing === undefined ? `${inv.lens.length} Lens routes` : `no Lens routes (${inv.lensMissing})`}`)

    stage = 'creating the synthetic users'
    users = await lens.createUsers(cfg.users)
    console.log(`created ${users.length} synthetic users`)
    // B27.16 — this run's users only: another run going on at the same time keeps its answers and credits.
    stage = "resetting the run's synthetic workspaces"
    const reset = await lens.reset(users.map((u) => u.workspaceID))
    console.log(reset === undefined ? 'reset: Lens did not answer within its request timeout; waited for the reset to run on to the end'
      : `reset ${reset} synthetic workspace(s), this run's: stored answers cleared, credits restored`)
    stage = 'reading the catalog'
    const catalog = await lens.catalog(users[0])
    const usdPerLXC = await lens.usdPerLXC()
    if (!catalog.some((m) => m.display_name === cfg.model)) throw new Error(`the catalog has no model named "${cfg.model}"`)

    stage = 'the users ran their journeys'
    const browsers = new Browsers(cfg.headed, incidents)
    const signIn = async (user: SyntheticUser) =>
      AppUser.signIn(await browsers.get(), user, { appURL: cfg.appURL, syntheticKey: cfg.syntheticKey, cap, catalog, modelName: cfg.model, book, usdPerLXC, recorder: rec })
    const env: RunEnv = {
      inventory: inv,
      lens, cap, catalog, usdPerLXC, book,
      judgeProvider: cfg.judgeProvider,
      judgeModel: cfg.judgeModel,
      signInUser: (index) => signIn(users[index]),
      userAt: (index) => users[index],
      userCount: users.length,
      outDir: cfg.outDir,
    }

    try {
      await pool(users, cfg.concurrency, async (user) => {
        const journey = journeyFor(user.index, users.length, STREAMABLE)
        const base = { user: user.index, workspace: user.workspaceID }
        const before = notRun()
        if (before !== undefined) {
          for (const s of journey) outcomes.push({ ...base, scenario: s.id, title: s.title, status: 'SKIP', detail: before, evidence: [], seconds: 0, features: featuresOf([], s.feature) })
          return
        }
        let app: AppUser
        try {
          app = await timed(SIGN_IN_MS, 'signing in', unlessStopped('signing in', signIn(user)))
        } catch (e) {
          for (const s of journey) outcomes.push({ ...base, scenario: s.id, title: s.title, status: 'ERROR', detail: `sign-in: ${String(e)}`, evidence: [], seconds: 0, features: featuresOf([], s.feature) })
          await checkLens()
          return
        }
        try {
          for (const s of journey) {
            if (stoppedBy !== undefined) {
              outcomes.push({ ...base, scenario: s.id, title: s.title, status: 'SKIP', detail: `not run: ${stoppedBy}`, evidence: [], seconds: 0, features: featuresOf([], s.feature) })
              continue
            }
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
              const v = await timed(SCENARIO_MS, s.id, unlessStopped(s.id, (async () => {
                await app.newChat() // every scenario starts from an empty conversation
                return s.run({ app, env: scenarioEnv, evidence })
              })()))
              status = v.pass ? 'PASS' : 'FAIL'
              detail = v.detail
              if (!v.pass) where = v.where
            } catch (e) {
              status = e instanceof CapReached || e instanceof CannotTest ? 'SKIP' : 'ERROR'
              detail = e instanceof Error ? e.message : String(e)
              // Where it was when it broke — before going back to Chat, which is not where it broke.
              where = rec.screensOf(tag)
              if (status === 'ERROR') await timed(CLOSE_MS, 'going back to Chat', unlessStopped('going back to Chat', app.openChat())).catch(() => undefined)
            }
            outcomes.push({ ...base, scenario: s.id, title: s.title, status, detail, evidence, seconds: (Date.now() - t0) / 1000,
              features: featuresOf(where ?? rec.screensOf(tag), s.feature) })
            console.log(`${status.padEnd(5)} user ${String(user.index).padStart(3)} ${s.id}: ${detail}`)
            if (status === 'ERROR') await checkLens()
          }
        } finally {
          await timed(CLOSE_MS, 'closing its browser', app.close()).catch(() => undefined)
        }
      })
    } finally {
      await timed(CLOSE_MS, 'closing the browser', browsers.close()).catch(() => undefined)
    }

    // THE LEDGER, once nothing is in flight: a cross-account scenario charges its partner too.
    stage = 'reading back each user\'s ledger'
    await pool(users, 10, async (user) => {
      const t0 = Date.now()
      let o: Outcome
      const ledgerEnv: RunEnv = { ...env, lens: lens.tagged({ scenario: 'ledger-matches-answers', user: user.index }) }
      if (stoppedBy !== undefined) {
        outcomes.push({ user: user.index, workspace: user.workspaceID, scenario: 'ledger-matches-answers', title: 'ledger read-back',
          status: 'SKIP', detail: `not run: ${stoppedBy}`, evidence: [], seconds: 0, features: ['Ledger'] })
        return
      }
      try {
        const v = await timed(LEDGER_MS, 'the ledger read-back', unlessStopped('the ledger read-back', checkLedger(ledgerEnv, user)))
        o = { user: user.index, workspace: user.workspaceID, scenario: 'ledger-matches-answers',
          title: 'every charged answer is one spend row on the ledger; a free replay is none',
          status: v.pass ? 'PASS' : 'FAIL', detail: v.detail, evidence: v.evidence, seconds: (Date.now() - t0) / 1000, features: ['Ledger'] }
      } catch (e) {
        o = { user: user.index, workspace: user.workspaceID, scenario: 'ledger-matches-answers', title: 'ledger read-back',
          status: 'ERROR', detail: String(e), evidence: [], seconds: (Date.now() - t0) / 1000, features: ['Ledger'] }
      }
      outcomes.push(o)
      if (o.status === 'ERROR') await checkLens()
    })
    stoppedAtCap = cap.reached

    // B17.5 — THE EXPLORERS, after the scenarios, under the same cap: whatever the scenarios left.
    if (cfg.explorers > 0 && !cap.reached && stoppedBy === undefined) {
      stage = 'creating the explorers'
      const explorers = await lens.createUsers(cfg.explorers)
      stage = 'the explorers explored'
      // B25.5 (3) — every explorer is told every feature, and each starts at the next least covered.
      const perFeature = new Map<string, number>()
      for (const o of outcomes) for (const f of o.features) perFeature.set(f, (perFeature.get(f) ?? 0) + 1)
      const areas = leastCovered(buildMap(inv, rec), perFeature)
      // B26.19 — one notebook for them all; a screen with a parameter is reached by a click, never sent to.
      const notebook = new Notebook(findings, inv.screens.filter((e) => cannotTest(e) === undefined && !e.path.includes(':')).map((e) => e.path),
        (path) => screens?.match('GET', path.replace(/(.)\/$/, '$1'))?.path ?? path)
      console.log(`${explorers.length} explorers, up to ${cfg.exploreMinutes} minutes each, with $${(cfg.capUSD - cap.spentUSD).toFixed(2)} of the cap left; ` +
        `least covered first: ${areas.slice(0, explorers.length).map((a) => a.feature).join(', ')}`)
      const again = new Browsers(cfg.headed, incidents)
      try {
        await Promise.all(explorers.map(async (user, n) => {
          let s: ExplorerSummary
          const start = areas.length > 0 ? areas[n % areas.length] : undefined
          const tag: Tag = { scenario: 'explorer', user: n }
          try {
            const app = await timed(SIGN_IN_MS, 'signing in', unlessStopped('signing in',
              (async () => AppUser.signIn(await again.get(), user, { appURL: cfg.appURL, syntheticKey: cfg.syntheticKey, cap, catalog, modelName: cfg.model, book, usdPerLXC, recorder: rec, tag }))()))
            try {
              s = await timed(SIGN_IN_MS + cfg.exploreMinutes * 60_000, 'exploring', unlessStopped('exploring',
                explore(n, app, { lens: lens.tagged(tag), cap, catalog, usdPerLXC, provider: cfg.judgeProvider, model: cfg.explorerModel,
                  minutes: cfg.exploreMinutes, features: areas, start, notebook })))
            } finally {
              await timed(CLOSE_MS, 'closing its browser', app.close()).catch(() => undefined)
            }
          } catch (e) {
            s = { explorer: n, steps: 0, stopped: 'error', detail: e instanceof Error ? e.message : String(e) }
          }
          s.start = start?.feature
          summaries.push(s)
          console.log(`explorer ${n}: ${s.steps} steps, ${s.screens ?? 0} screens, ${s.notes ?? 0} notes, stopped (${s.stopped}): ${s.detail}`)
        }))
      } finally {
        await timed(CLOSE_MS, 'closing the browser', again.close()).catch(() => undefined)
      }
      summaries.sort((a, b) => a.explorer - b.explorer)
    }
  } catch (e) {
    stoppedBy ??= `${stage}: ${describe(e)}`
    halt()
  } finally {
    process.off('unhandledRejection', stray)
  }
  if (stoppedBy !== undefined) console.log(`STOPPED: ${stoppedBy}`)

  outcomes.sort((a, b) => a.user - b.user)
  const counts: Record<Status, number> = { PASS: 0, FAIL: 0, SKIP: 0, ERROR: 0 }
  for (const o of outcomes) counts[o.status]++
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
    stopped_at_cap: stoppedAtCap ?? cap.reached,
    ...(stoppedBy === undefined ? {} : { stopped_by: stoppedBy }),
    incidents,
    counts,
    outcomes,
    explorers: summaries,
    findings,
    ...(inv === undefined ? {} : { coverage: buildMap(inv, rec) }),
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
  // B26.18 — run() answers whatever happens, and each thing written below is tried on its own, so one that
  // cannot be written does not cost the others.
  const result = await run(cfg)
  const c = result.counts
  const attempt = async (what: string, write: () => Promise<void>): Promise<void> => {
    try {
      await write()
    } catch (e) {
      console.error(`e2e: could not write ${what}: ${describe(e)}`)
    }
  }
  const file = join(cfg.outDir, `run-${result.started_at.replace(/[:.]/g, '-')}.json`)
  await attempt('the results', async () => {
    await mkdir(cfg.outDir, { recursive: true })
    await writeFile(file, JSON.stringify(result, null, 2) + '\n')
  })
  console.log(`\n${c.PASS} passed, ${c.FAIL} failed, ${c.ERROR} errored, ${c.SKIP} skipped — ` +
    `spent ≈ $${result.spent_usd.toFixed(4)} of a $${result.cap_usd.toFixed(2)} cap` +
    `${result.stopped_at_cap ? ' (STOPPED AT THE CAP)' : ''}` +
    (result.stopped_by !== undefined ? `\nSTOPPED EARLY: ${result.stopped_by}` : '') +
    result.incidents.map((i) => `\nincident: ${i}`).join('') +
    (result.explorers.length > 0 ? `\n${result.explorers.length} explorers: ${groupLeads(result.findings).length} distinct leads to check, from ${result.findings.length} notes` : '') +
    `\nresults: ${file}`)

  // B17.4 — a build item for each scenario that FAILED and is not covered yet, then the day's report,
  // which names each failure's item. B25.5 (4) — then the run's summary for the morning brief.
  const reportDir = cfg.reportDir ?? join(REPO, 'docs/e2e')
  const planned = reportPath(reportDir, result.started_at)
  const shown = planned.startsWith(REPO + '/') ? relative(REPO, planned) : planned
  const filed: Record<string, string> = {}
  const newItems: string[] = []
  if (cfg.buildMd !== 'none') {
    await attempt(`build items to ${cfg.buildMd}`, async () => {
      const f = await fileItems(cfg.buildMd, result, shown)
      if (f === undefined) {
        console.log(`build items: no queue at ${cfg.buildMd}, so nothing was filed`)
        return
      }
      for (const x of f.filed) {
        filed[x.scenario] = x.id
        newItems.push(x.id)
      }
      for (const x of f.covered) filed[x.scenario] = x.by
      console.log(`build items in ${cfg.buildMd}: ` +
        (f.filed.map((x) => `${x.id} (${x.scenario}, ${x.repo})`).join(', ') || 'none new') +
        (f.covered.length > 0 ? `; already open: ${f.covered.map((x) => `${x.scenario} → ${x.by}`).join(', ')}` : ''))
    })
  }
  await attempt('the report', async () => {
    console.log(`report: ${await writeReport(reportDir, { ...result, filed })}`)
  })
  if (cfg.testersMd !== 'none') {
    await attempt(cfg.testersMd, async () => {
      await writeTesters(cfg.testersMd, { ...result, filed }, shown, newItems)
      console.log(`summary: ${cfg.testersMd}`)
    })
  }
  return c.FAIL + c.ERROR > 0 || result.stopped_by !== undefined ? 1 : 0
}

// B26.25 — Node loads this file by its real path, so started through a symlink (/tmp on macOS) the path it was
// given must be resolved too, or the run does nothing and exits 0.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main()
}
