// B34.8 — evals, outputs, attribution, nodes and switched-off features have testers. On the 6 Oct map Lens's eval
// cases, runs, results, datasets, schedules and attestations; output verdicts, attribution and artifacts; attribution by
// branch and by pull request; compute, cache and embedding nodes and their heartbeats; PoVI receipts, challenges and a
// node's stake, unbond and release; annotation stakes and tasks; and LENS transfers read "not covered". Each scenario
// here runs on a workspace of its own, on that workspace's own token or key, the way its own software calls Lens. A
// feature Lens runs is checked on what it stores: made, read back, and seen where Lens says it is. A feature switched
// off — the token exchange and staking (B18.1), artifacts without LENS_H5_ARTIFACT_ENABLED — is checked to refuse and
// move nothing: the LXC ledger, the LENS balance and the LENS history all as they were.

import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { fail } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import { ask, judgeRoute, proxyKey, rowsText, servedRight, verdictOf } from './gateway.ts'
import { RUN_SALT, listPriceUSD } from './oracles.ts'
import { within } from './pricing.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'
import { payCheckout } from './screens.ts'
import { call, ok, said } from './settings.ts'

/** How long a row written after the answer (attribution, a verdict) is given to reach what reads it. */
const STORED_WAIT_MS = 15_000
/** The most output an eval case's model call may make: Lens asks Anthropic for at most 1,024 tokens. */
const EVAL_MAX_OUTPUT = 1024

/** The same scenario on another workspace of its own: the other company that reads, attests or is paid. */
async function another(ctx: ScenarioCtx): Promise<ScenarioCtx> {
  const [other] = await ctx.env.lens.createUsers(1)
  return { ...ctx, app: { ...ctx.app, user: { ...other, index: ctx.app.user.index } } as ScenarioCtx['app'] }
}

/** What a workspace holds that a refused request must leave alone: its LXC ledger, its LENS balance and LENS history. */
interface Holdings { lxc: Set<string>; lens: number; held: number; history: string }

async function holdings(ctx: ScenarioCtx): Promise<Holdings> {
  const b = await call<{ balance_ulens?: number; held_balance_ulens?: number }>(ctx, 'GET', '/v1/workspaces/{ws}/tokens/balance')
  if (!ok(b.status)) throw new Error(`reading the LENS balance answered ${said(b)}`)
  const h = await call<unknown>(ctx, 'GET', '/v1/workspaces/{ws}/tokens/history?limit=50')
  return { lxc: new Set((await ctx.env.lens.ledger(ctx.app.user)).map((r) => r.id)), lens: b.value?.balance_ulens ?? 0, held: b.value?.held_balance_ulens ?? 0, history: h.text }
}

/** What moved since `before`, in words; empty when nothing did. */
async function movedSince(ctx: ScenarioCtx, before: Holdings, who: string): Promise<string[]> {
  const now = await holdings(ctx)
  const rows = (await ctx.env.lens.ledger(ctx.app.user)).filter((r) => !before.lxc.has(r.id))
  return [
    ...(rows.length > 0 ? [`${who}'s LXC ledger took ${rowsText(rows)}`] : []),
    ...(now.lens !== before.lens || now.held !== before.held ? [`${who}'s LENS went from ${before.lens} µLENS (${before.held} held) to ${now.lens} (${now.held} held)`] : []),
    ...(now.history !== before.history ? [`${who}'s LENS history changed: ${now.history.slice(0, 160)}`] : []),
  ]
}

const list = <T>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : [])

/** An address nothing answers at (RFC 2606's .invalid): a node Lens never verifies, a webhook nobody receives. */
const nowhere = (what: string) => `http://e2e-${RUN_SALT}-${what}.invalid`

/** `r` refused with `status` (and, when given, Lens's sentence matching `says`); else what it did instead. */
function refused(what: string, r: { status: number; error: string; text: string }, status: number, says?: RegExp): string | undefined {
  if (r.status === status && (says === undefined || says.test(r.error))) return undefined
  return `${what} answered ${said(r)}, not ${status}${says === undefined ? '' : ` ${says}`}`
}

// ─── evals ──────────────────────────────────────────────────────────────────────────────────────────

interface EvalCase { id: string; workspace_id: string; tags: string[] | null }
interface EvalResultRead { test_case_id: string; run_id: string; passed: boolean; score: number; cost_usd: number; error?: string }
interface RunSummary { run_id: string; workspace_id: string; total_tests: number; passed: number; failed: number; total_cost_usd: number }
interface DatasetRun { summary: RunSummary; dataset_id: string; results: EvalResultRead[] | null; estimate: { cases: number; est_cost_usd: number } }

/**
 * Lens's evals. A case made on the workspace's own token is listed by its tag; a run of that tag answers it once and
 * stores the run, its result and its summary, read back three ways. A dataset is made and listed, takes a case, refuses
 * a run whose estimate passes the cap it is given (402, nothing run), runs within a cap, is listed among the workspace's
 * runs, and takes a schedule (made switched off, so nothing runs on its own) that is listed. Each run asks the model on
 * the workspace's behalf, so each is one charge on its ledger. An eval submitted for the pool is attested by another
 * company, never by its author, and an unknown one is 404; neither moves any LENS.
 */
export function evals(): Scenario {
  return {
    id: 'evals',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Evals',
    title: "eval cases, runs, results, datasets and schedules on the workspace's own token, each stored and read back; every run that asks a model is a charge on the workspace's ledger; an eval submitted for the pool is attested by another company, never its author, and moves no LENS",
    run: async (ctx) => {
      const wrong: string[] = []
      const right: string[] = []
      const { model } = judgeRoute(ctx)
      const tag = `e2e-${RUN_SALT}-${Date.now().toString(36)}`
      const prompt = `Reply with the single word OK and nothing else. (${tag})`
      const evalCase = { provider: model.provider, model: model.id, prompt, expected_output: 'OK', eval_method: 'contains', pass_threshold: 1 }

      // A run asks the model with Talyvor's provider key: its worst case is held against the run's cap until it answers.
      const charged = async <T>(what: string, run: () => Promise<{ status: number; error: string; value?: T; text: string }>, costOf: (v: T | undefined) => number) => {
        const before = new Set((await ctx.env.lens.ledger(ctx.app.user)).map((r) => r.id))
        const hold = ctx.env.cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), EVAL_MAX_OUTPUT))
        let r: { status: number; error: string; value?: T; text: string }
        try {
          r = await run()
        } catch (e) {
          ctx.env.cap.settle(hold, undefined)
          throw e
        }
        const cost = costOf(r.value)
        ctx.env.cap.settle(hold, ok(r.status) && cost > 0 ? cost : undefined)
        const rows = await within(async () => (await ctx.env.lens.ledger(ctx.app.user)).filter((x) => !before.has(x.id)), (rs) => rs.some((x) => x.type === 'spend'), STORED_WAIT_MS)
        for (const x of rows) if (x.type === 'spend') ctx.env.book.add(ctx.app.user.workspaceID, -x.amount_ulxc)
        ctx.evidence.push({ note: `${what}: ${said(r)}; Lens states it cost $${cost}; the ledger took ${rows.length === 0 ? 'nothing' : rowsText(rows)}` })
        if (ok(r.status) && cost > 0 && !rows.some((x) => x.type === 'spend')) {
          wrong.push(`${what} asked ${model.id} for the workspace (Lens states it cost $${cost}) and charged the workspace nothing: Talyvor paid the provider and billed no one`)
        }
        return r
      }

      // 1. A case, listed by its tag.
      const made = await call<EvalCase>(ctx, 'POST', '/v1/eval/cases', { name: `e2e ${tag}`, ...evalCase, tags: [tag] })
      if (made.status !== 201 || made.value?.id === undefined) return fail(`POST /v1/eval/cases answered ${said(made)}`)
      const caseID = made.value.id
      const cases = await call<EvalCase[] | null>(ctx, 'GET', `/v1/eval/cases?tags=${encodeURIComponent(tag)}`)
      if (!list(cases.value).some((c) => c.id === caseID)) wrong.push(`the case ${caseID} is not listed under its tag ${tag}: ${said(cases)}`)
      else right.push('a case listed by its tag')

      // 2. A run of that tag: one result, the run stored and read back three ways.
      const run = await charged<RunSummary>('the run of the tag', () => call<RunSummary>(ctx, 'POST', '/v1/eval/run', { tags: [tag] }), (v) => v?.total_cost_usd ?? 0)
      const runID = run.value?.run_id
      if (!ok(run.status) || runID === undefined) wrong.push(`POST /v1/eval/run answered ${said(run)}`)
      else {
        if (run.value!.total_tests !== 1 || run.value!.workspace_id !== ctx.app.user.workspaceID) wrong.push(`the run of one case reads ${run.text.slice(0, 200)}`)
        const got = await call<RunSummary>(ctx, 'GET', `/v1/eval/runs/${runID}`)
        if (got.value?.run_id !== runID || got.value.total_tests !== 1) wrong.push(`GET /v1/eval/runs/${runID} reads ${said(got)}`)
        const results = await call<EvalResultRead[] | null>(ctx, 'GET', `/v1/eval/runs/${runID}/results`)
        const mine = list(results.value).filter((x) => x.test_case_id === caseID)
        if (mine.length !== 1 || list(results.value).length !== 1) wrong.push(`the run's results read ${said(results)}, not the one result for case ${caseID}`)
        else right.push(`the run read back with its one result (${mine[0].passed ? 'passed' : `failed, ${mine[0].error ?? `score ${mine[0].score}`}`})`)
        const runs = await call<RunSummary[] | null>(ctx, 'GET', '/v1/eval/runs')
        const dash = await call<RunSummary[] | null>(ctx, 'GET', '/v1/api/eval/runs')
        if (!list(runs.value).some((x) => x.run_id === runID)) wrong.push(`GET /v1/eval/runs does not list the run ${runID}: ${said(runs)}`)
        if (!list(dash.value).some((x) => x.run_id === runID)) wrong.push(`GET /v1/api/eval/runs does not list the run ${runID}: ${said(dash)}`)
      }
      const notMine = await call(ctx, 'GET', `/v1/eval/runs/e2e-no-such-run-${RUN_SALT}`)
      const noResults = await call(ctx, 'GET', `/v1/eval/runs/e2e-no-such-run-${RUN_SALT}/results`)
      for (const [w, r] of [['an unknown run', notMine], ["an unknown run's results", noResults]] as const) {
        const why = refused(w, r, 404)
        if (why !== undefined) wrong.push(why)
      }

      // 3. A dataset: made, listed, a case added, a run past its cap refused, a run within it, its schedule.
      const ds = await call<{ id: string; name: string }>(ctx, 'POST', '/v1/workspaces/{ws}/eval/datasets', { name: `e2e ${tag}`, description: 'the nightly testers' })
      const dsID = ds.value?.id
      if (ds.status !== 201 || dsID === undefined) wrong.push(`POST …/eval/datasets answered ${said(ds)}`)
      else {
        const sets = await call<{ id: string }[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/eval/datasets')
        if (!list(sets.value).some((x) => x.id === dsID)) wrong.push(`the dataset ${dsID} is not listed: ${said(sets)}`)
        const added = await call<EvalCase>(ctx, 'POST', `/v1/workspaces/{ws}/eval/datasets/${dsID}/cases`, { name: `e2e ${tag} in a dataset`, ...evalCase })
        if (added.status !== 201) wrong.push(`adding a case to the dataset answered ${said(added)}`)
        const beforeCap = await holdings(ctx)
        const capped = await call(ctx, 'POST', '/v1/workspaces/{ws}/eval/run', { dataset_id: dsID, target: { max_cost_usd: 1e-9 } })
        const why = refused('a dataset run whose estimate passes its cap', capped, 402, /exceeds cap/)
        if (why !== undefined) wrong.push(why)
        wrong.push(...await movedSince(ctx, beforeCap, 'the workspace, after the run refused at its cap,'))
        const dsRun = await charged<DatasetRun>('the dataset run', () => call<DatasetRun>(ctx, 'POST', '/v1/workspaces/{ws}/eval/run', { dataset_id: dsID, target: { max_cost_usd: 0.05 } }), (v) => v?.summary.total_cost_usd ?? 0)
        const dsRunID = dsRun.value?.summary.run_id
        if (!ok(dsRun.status) || dsRunID === undefined) wrong.push(`the dataset run answered ${said(dsRun)}`)
        else {
          if (dsRun.value!.dataset_id !== dsID || list(dsRun.value!.results).length !== 1) wrong.push(`the dataset run of one case reads ${dsRun.text.slice(0, 200)}`)
          const wsRuns = await call<RunSummary[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/eval/runs')
          if (!list(wsRuns.value).some((x) => x.run_id === dsRunID)) wrong.push(`…/eval/runs does not list the dataset run ${dsRunID}: ${said(wsRuns)}`)
          else right.push('a dataset made, listed and run within its cap, refused past it')
        }
        const sched = await call<{ id: string; dataset_id: string; enabled: boolean }>(ctx, 'POST', '/v1/workspaces/{ws}/eval/schedules', { dataset_id: dsID, interval_seconds: 86_400, enabled: false, target_model: model.id })
        const scheds = await call<{ id: string; dataset_id: string; enabled: boolean }[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/eval/schedules')
        if (sched.status !== 201 || sched.value?.id === undefined) wrong.push(`a schedule for the dataset answered ${said(sched)}`)
        else if (!list(scheds.value).some((x) => x.id === sched.value!.id && x.dataset_id === dsID && !x.enabled)) wrong.push(`the schedule ${sched.value.id} is not listed switched off: ${said(scheds)}`)
        else right.push('a schedule made switched off and listed')
      }

      // 4. An eval for the pool: attested by another company, refused to its author; nothing minted to either.
      const there = await another(ctx)
      const mine0 = await holdings(ctx)
      const theirs0 = await holdings(there)
      const submitted = await call<{ id: string }>(ctx, 'POST', '/v1/evals', { input: `What is ${RUN_SALT} plus one? (${tag})`, expected_output: String(RUN_SALT + 1), eval_method: 'exact', feature_category: 'e2e' })
      const evalID = submitted.value?.id
      if (submitted.status !== 201 || evalID === undefined) wrong.push(`POST /v1/evals answered ${said(submitted)}`)
      else {
        const self = await call(ctx, 'POST', `/v1/evals/${evalID}/attest`, { agrees: true })
        const why = refused('its author attesting it', self, 403)
        if (why !== undefined) wrong.push(why)
        const other = await call<{ ok: boolean }>(there, 'POST', `/v1/evals/${evalID}/attest`, { agrees: true })
        if (!ok(other.status) || other.value?.ok !== true) wrong.push(`another company attesting it answered ${said(other)}`)
        else right.push('an eval for the pool attested by another company, refused to its author')
      }
      const unknown = await call(there, 'POST', `/v1/evals/e2e-no-such-eval-${RUN_SALT}/attest`, { agrees: true })
      const why = refused('attesting an unknown eval', unknown, 404)
      if (why !== undefined) wrong.push(why)
      wrong.push(...await movedSince(ctx, mine0, "the eval's author"), ...await movedSince(there, theirs0, 'the attesting company'))
      return verdictOf(wrong, `${right.join('; ')}; each run a charge on the ledger; no LENS moved`)
    },
  }
}

// ─── outputs and attribution ────────────────────────────────────────────────────────────────────────

interface BranchCost { branch: string; cost_usd: number; requests: number }
interface BranchStats { branch: string; total_cost_usd: number; request_count: number }
interface PRStats { pr_number: string; total_cost_usd: number; request_count: number; commits: string[] | null; authors: string[] | null }
interface BranchSpend { branch: string; pr_number: string; repository: string; total_cost_usd: number; request_count: number }
interface AttributionSummary { by_branch: BranchCost[] | null; by_pr: BranchCost[] | null; by_repo: BranchCost[] | null }

/**
 * Attribution by branch and by pull request, and an output's verdicts, attribution and artifact. One request on the
 * workspace's own key names a branch, a pull request, a repository, a commit and an author: it is one charge at the
 * catalog price, and every read of the workspace's attribution — its branches, the branch, the pull request, the
 * summary, the repository's branch and its top branches — counts that one request at what it was charged. When Lens
 * names the output it served (X-Talyvor-Output-Id), the workspace reports a mechanical verdict on it and attributes it
 * to its pull request, each read back, and a second attribution of the same kind conflicts (409); when Lens does not
 * (its output verdicts switched off), an output the workspace never produced is refused both (403) and has no
 * attribution (404). Artifacts are switched off here (LENS_H5_ARTIFACT_ENABLED): the route is 404. Nothing but the one
 * request is charged.
 */
export function outputsAttribution(): Scenario {
  return {
    id: 'outputs-attribution',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Outputs and attribution',
    title: "a request naming a branch, a pull request and a repository is counted at its charge in every attribution read; an output Lens names takes a mechanical verdict and an attribution, read back, and refuses a second; one the workspace never produced is refused; artifacts, switched off, refuse; nothing else is charged",
    run: async (ctx) => {
      const wrong: string[] = []
      const right: string[] = []
      const k = await proxyKey(ctx, `attribution ${RUN_SALT}`)
      if (typeof k === 'string') return fail(k)
      const { route, model } = judgeRoute(ctx)
      const branch = `e2e/${RUN_SALT}-${Date.now().toString(36)}`
      const pr = String(100_000 + (RUN_SALT % 900_000))
      const repo = `talyvor-e2e/run-${RUN_SALT}`
      const commit = randomBytes(20).toString('hex')
      const a = await ask(ctx, k.key, route, model.id, 'a request naming a branch, a pull request and a repository', {
        'X-Talyvor-Branch': branch, 'X-Talyvor-PR': pr, 'X-Talyvor-Repository': repo, 'X-Talyvor-Commit': commit, 'X-Talyvor-Author': 'e2e-tester',
      })
      const served = await servedRight(ctx, a, model, 'the request naming a branch')
      if (served !== undefined) return fail(served)
      const chargedUSD = (-a.fresh.filter((x) => x.type === 'spend').reduce((s, x) => s + x.amount_ulxc, 0) / 1e6) * ctx.env.usdPerLXC
      // What attribution states it cost is what the request was charged, to a part in twenty (Lens rounds both its own way).
      const near = (usd: number) => Math.abs(usd - chargedUSD) <= Math.max(1e-6, chargedUSD * 0.05)
      const counted = (what: string, n: number | undefined, usd: number | undefined) => {
        if (n !== 1 || usd === undefined || !near(usd)) wrong.push(`${what} reads ${n ?? 'no'} request${n === 1 ? '' : 's'} at $${usd ?? '?'}, not the one request charged $${chargedUSD.toFixed(6)}`)
      }
      const branches = await within(() => call<BranchCost[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/attribution/branches'), (r) => list(r.value).some((x) => x.branch === branch), STORED_WAIT_MS)
      const b = list(branches.value).find((x) => x.branch === branch)
      counted(`the workspace's branches (${said(branches)})`, b?.requests, b?.cost_usd)
      const one = await call<BranchStats>(ctx, 'GET', `/v1/workspaces/{ws}/attribution/branches/${encodeURIComponent(branch)}`)
      counted(`the branch ${branch}`, one.value?.request_count, one.value?.total_cost_usd)
      const prs = await call<PRStats>(ctx, 'GET', `/v1/workspaces/{ws}/attribution/prs/${pr}`)
      counted(`pull request ${pr}`, prs.value?.request_count, prs.value?.total_cost_usd)
      if (!list(prs.value?.commits).includes(commit) || !list(prs.value?.authors).includes('e2e-tester')) wrong.push(`pull request ${pr} does not name its commit and author: ${said(prs)}`)
      const sum = await call<AttributionSummary>(ctx, 'GET', '/v1/workspaces/{ws}/attribution/summary?days=1')
      const sb = list(sum.value?.by_branch).find((x) => x.branch === branch)
      counted("the summary's branch", sb?.requests, sb?.cost_usd)
      const q = `branch=${encodeURIComponent(branch)}&repository=${encodeURIComponent(repo)}`
      const spend = await call<BranchSpend>(ctx, 'GET', `/v1/attribution/branch?${q}`)
      counted(`/v1/attribution/branch for ${repo} (${said(spend)})`, spend.value?.request_count, spend.value?.total_cost_usd)
      const top = await call<BranchSpend[] | null>(ctx, 'GET', `/v1/attribution/top?repository=${encodeURIComponent(repo)}`)
      const tb = list(top.value).find((x) => x.branch === branch)
      counted(`/v1/attribution/top for ${repo} (${said(top)})`, tb?.request_count, tb?.total_cost_usd)
      if (wrong.length === 0) right.push(`one request on ${branch}, pull request ${pr}, counted at its $${chargedUSD.toFixed(6)} in all six reads`)

      // The output Lens served: a verdict and an attribution when it names it; refusals for one the workspace never produced.
      const before = await holdings(ctx)
      const oid = a.headers.get('X-Talyvor-Output-Id')
      ctx.evidence.push({ note: `X-Talyvor-Output-Id: ${oid ?? 'not sent (output verdicts switched off)'}` })
      const foreign = randomBytes(32).toString('hex')
      const notOurs = [
        refused("a verdict on an output the workspace never produced", await call(ctx, 'POST', `/v1/output-verdicts/${foreign}/mechanical`, { verdict: 'tests_passed', exit_code: 0, tool: 'e2e' }), 403, /not the producer/),
        refused("attributing an output the workspace never produced", await call(ctx, 'POST', `/v1/outputs/${foreign}/attribution`, { target_kind: 'pr', target_ref: `${repo}#${pr}` }), 403, /not the producer/),
        refused("the attribution of an output the workspace never produced", await call(ctx, 'GET', `/v1/outputs/${foreign}/attribution`), 404),
        // Artifacts are switched off here: the route is not registered (LENS_H5_ARTIFACT_ENABLED).
        refused('an artifact for an output, switched off', await call(ctx, 'POST', `/v1/outputs/${oid ?? foreign}/artifact`, { manifest_sha256: randomBytes(32).toString('hex') }), 404),
      ].filter((x) => x !== undefined)
      wrong.push(...notOurs)
      if (oid !== null) {
        const v = await call<{ recorded: boolean }>(ctx, 'POST', `/v1/output-verdicts/${oid}/mechanical`, { verdict: 'tests_passed', exit_code: 0, tool: 'e2e' })
        if (!ok(v.status) || v.value?.recorded !== true) wrong.push(`a verdict on the output Lens served answered ${said(v)}`)
        const verdicts = await within(() => call<{ output_id: string }[] | null>(ctx, 'GET', '/v1/output-verdicts'), (r) => list(r.value).some((x) => x.output_id === oid), STORED_WAIT_MS)
        if (!list(verdicts.value).some((x) => x.output_id === oid)) wrong.push(`GET /v1/output-verdicts does not list the output ${oid}: ${said(verdicts)}`)
        const at = await call<{ recorded: boolean }>(ctx, 'POST', `/v1/outputs/${oid}/attribution`, { target_kind: 'pr', target_ref: `${repo}#${pr}` })
        if (!ok(at.status) || at.value?.recorded !== true) wrong.push(`attributing the output to its pull request answered ${said(at)}`)
        const again = refused('a second attribution of the same kind', await call(ctx, 'POST', `/v1/outputs/${oid}/attribution`, { target_kind: 'pr', target_ref: `${repo}#${Number(pr) + 1}` }), 409)
        if (again !== undefined) wrong.push(again)
        const byOutput = await call<{ target_ref: string }[] | null>(ctx, 'GET', `/v1/outputs/${oid}/attribution`)
        const all = await call<{ output_id: string }[] | null>(ctx, 'GET', '/v1/attributions')
        if (!list(byOutput.value).some((x) => x.target_ref === `${repo}#${pr}`)) wrong.push(`the output's attribution reads ${said(byOutput)}`)
        if (!list(all.value).some((x) => x.output_id === oid)) wrong.push(`GET /v1/attributions does not list the output ${oid}: ${said(all)}`)
        right.push('the output Lens served took a verdict and an attribution, read back, and refused a second')
      } else {
        const verdicts = await call<unknown[] | null>(ctx, 'GET', '/v1/output-verdicts')
        const all = await call<unknown[] | null>(ctx, 'GET', '/v1/attributions')
        if (!ok(verdicts.status) || list(verdicts.value).length > 0) wrong.push(`with output verdicts switched off, the workspace's verdicts read ${said(verdicts)}`)
        if (!ok(all.status) || list(all.value).length > 0) wrong.push(`with output verdicts switched off, the workspace's attributions read ${said(all)}`)
        right.push('output verdicts switched off: no output named, verdicts and attributions empty')
      }
      // The workspace's audit, exported to a webhook it names: started for an address, refused without one.
      const noURL = refused('an audit export to no webhook', await call(ctx, 'POST', '/v1/audit/webhook', {}), 400, /webhook_url required/)
      if (noURL !== undefined) wrong.push(noURL)
      const hook = await call<{ ok: boolean }>(ctx, 'POST', '/v1/audit/webhook', { webhook_url: `${nowhere('audit')}/export` })
      if (hook.status !== 202 || hook.value?.ok !== true) wrong.push(`an audit export to a webhook answered ${said(hook)}, not 202 started`)
      wrong.push(...await movedSince(ctx, before, 'the workspace, after the verdicts, attributions and audit export,'))
      return verdictOf(wrong, `${right.join('; ')}; an output the workspace never produced refused, artifacts switched off (404); the audit export started for a webhook and refused without one; nothing else charged`)
    },
  }
}

// ─── compute, cache and embedding nodes ────────────────────────────────────────────────────────────

interface InferenceNode { id: string; workspace_id: string; url: string; models: string[] | null; active: boolean; verified: boolean }
interface EmbeddingNode { id: string; workspace_id: string; model: string; active: boolean; verified: boolean }

/**
 * A workspace's compute, cache and embedding nodes, on its own token. Each is registered at an address nothing answers
 * at, so Lens never verifies it: listed as the workspace's, unverified, and never offered for the model it serves. Its
 * heartbeat is taken from its owner, and refused (404) for a node that does not exist and for another company's token.
 * Another company cannot remove one; removed by its owner, a compute or embedding node lists inactive. The
 * workspace's mining reads name it, and nothing is charged or minted.
 */
export function nodes(): Scenario {
  return {
    id: 'nodes',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Compute nodes',
    title: "compute, cache and embedding nodes registered, listed unverified, never offered, heartbeats taken from their owner and refused for an unknown node and another company, removed; nothing charged or minted",
    run: async (ctx) => {
      const wrong: string[] = []
      const there = await another(ctx)
      const mine0 = await holdings(ctx)
      const unknown = `00000000-0000-4000-8000-${String(RUN_SALT).padStart(12, '0')}`
      const heartbeats = async (what: string, path: (id: string) => string, id: string, body: unknown) => {
        const own = await call(ctx, 'POST', path(id), body)
        if (!ok(own.status)) wrong.push(`the ${what}'s heartbeat answered ${said(own)}`)
        const none = refused(`a heartbeat for a ${what} that does not exist`, await call(ctx, 'POST', path(unknown), body), 404)
        const foreign = refused(`another company's heartbeat for the ${what}`, await call(there, 'POST', path(id).replace(ctx.app.user.workspaceID, there.app.user.workspaceID), body), 404)
        for (const x of [none, foreign]) if (x !== undefined) wrong.push(x)
      }

      // Compute.
      const model = `e2e-${RUN_SALT}-model`
      const cn = await call<InferenceNode>(ctx, 'POST', '/v1/workspaces/{ws}/nodes', { url: nowhere('compute'), provider: 'ollama', models: [model], gpu_type: 'cpu', max_concurrent: 1, price_per_token: 0.000001 })
      const cid = cn.value?.id
      if (cn.status !== 201 || cid === undefined) return fail(`registering a compute node answered ${said(cn)}`)
      const listed = await call<InferenceNode[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/nodes')
      const c = list(listed.value).find((x) => x.id === cid)
      if (c === undefined || !c.active || c.verified) wrong.push(`the compute node ${cid} lists as ${c === undefined ? 'missing' : `active ${c.active}, verified ${c.verified}`}: ${said(listed)}`)
      const offered = await call<InferenceNode[] | null>(ctx, 'GET', `/v1/nodes/available?model=${encodeURIComponent(model)}`)
      if (!ok(offered.status) || list(offered.value).some((x) => x.id === cid)) wrong.push(`compute nodes offered for ${model} read ${said(offered)}: an unverified node is offered to nobody`)
      await heartbeats('compute node', (id) => `/v1/workspaces/${ctx.app.user.workspaceID}/nodes/${id}/heartbeat`, cid, { active_requests: 0, uptime_seconds: 60, models_loaded: [model] })
      const mining = await call<{ workspace_id: string }>(ctx, 'GET', '/v1/workspaces/{ws}/tokens/mining/compute')
      if (mining.value?.workspace_id !== ctx.app.user.workspaceID) wrong.push(`the workspace's compute mining reads ${said(mining)}`)
      const notTheirs = refused('another company removing the compute node', await call(there, 'DELETE', `/v1/workspaces/{ws}/nodes/${cid}`), 404)
      if (notTheirs !== undefined) wrong.push(notTheirs)
      const gone = await call(ctx, 'DELETE', `/v1/workspaces/{ws}/nodes/${cid}`)
      const after = await call<InferenceNode[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/nodes')
      if (!ok(gone.status) || list(after.value).find((x) => x.id === cid)?.active !== false) wrong.push(`removing the compute node answered ${said(gone)} and it lists ${said(after)}`)

      // Cache: no list of its own, so the heartbeat is what says it is stored, and whose.
      const cc = await call<{ id: string; workspace_id: string }>(ctx, 'POST', '/v1/workspaces/{ws}/cache-nodes', { url: nowhere('cache'), max_size_gb: 1, node_secret: `e2e-${RUN_SALT}` })
      const ccid = cc.value?.id
      if (cc.status !== 201 || ccid === undefined || cc.value?.workspace_id !== ctx.app.user.workspaceID) wrong.push(`registering a cache node answered ${said(cc)}`)
      else {
        await heartbeats('cache node', (id) => `/v1/workspaces/${ctx.app.user.workspaceID}/cache-nodes/${id}/heartbeat`, ccid, { entries: 1, size_mb: 0.1, hit_rate: 0 })
        const foreign = refused('another company removing the cache node', await call(there, 'DELETE', `/v1/workspaces/{ws}/cache-nodes/${ccid}`), 404)
        if (foreign !== undefined) wrong.push(foreign)
        const del = await call(ctx, 'DELETE', `/v1/workspaces/{ws}/cache-nodes/${ccid}`)
        if (!ok(del.status)) wrong.push(`removing the cache node answered ${said(del)}`)
      }

      // Embedding.
      const em = await call<EmbeddingNode>(ctx, 'POST', '/v1/workspaces/{ws}/embedding-nodes', { url: nowhere('embed'), model: 'text-embedding-3-small', dimensions: 1536, node_secret: `e2e-${RUN_SALT}` })
      const eid = em.value?.id
      if (em.status !== 201 || eid === undefined) wrong.push(`registering an embedding node answered ${said(em)}`)
      else {
        const els = await call<EmbeddingNode[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/embedding-nodes')
        const e = list(els.value).find((x) => x.id === eid)
        if (e === undefined || !e.active || e.verified) wrong.push(`the embedding node ${eid} lists as ${e === undefined ? 'missing' : `active ${e.active}, verified ${e.verified}`}: ${said(els)}`)
        const eoff = await call<EmbeddingNode[] | null>(ctx, 'GET', '/v1/embedding-nodes/available?model=text-embedding-3-small')
        if (!ok(eoff.status) || list(eoff.value).some((x) => x.id === eid)) wrong.push(`embedding nodes offered read ${said(eoff)}: an unverified node is offered to nobody`)
        await heartbeats('embedding node', (id) => `/v1/workspaces/${ctx.app.user.workspaceID}/embedding-nodes/${id}/heartbeat`, eid, { speed_tps: 1, inflight: 0, uptime_seconds: 60 })
        const emining = await call<{ workspace_id: string }>(ctx, 'GET', '/v1/workspaces/{ws}/tokens/mining/embeddings')
        if (emining.value?.workspace_id !== ctx.app.user.workspaceID) wrong.push(`the workspace's embedding mining reads ${said(emining)}`)
        const del = await call(ctx, 'DELETE', `/v1/workspaces/{ws}/embedding-nodes/${eid}`)
        const eafter = await call<EmbeddingNode[] | null>(ctx, 'GET', '/v1/workspaces/{ws}/embedding-nodes')
        if (!ok(del.status) || list(eafter.value).find((x) => x.id === eid)?.active !== false) wrong.push(`removing the embedding node answered ${said(del)} and it lists ${said(eafter)}`)
      }
      wrong.push(...await movedSince(ctx, mine0, 'the workspace'))
      return verdictOf(wrong, `a compute, a cache and an embedding node registered, unverified and offered to nobody, their heartbeats taken from their owner only, removed; nothing charged or minted`)
    },
  }
}

// ─── PoVI ───────────────────────────────────────────────────────────────────────────────────────────

/** A PoVI receipt as a node signs it (talyvor-lens internal/povi/receipt.go CanonicalPayload). */
export interface Receipt {
  request_id: string
  node_id: string
  workspace_id: string
  model: string
  input_tokens: number
  output_tokens: number
  merkle_root: number[]
  timestamp: number
  leaf_count: number
}

/** The bytes a node signs: each string length-prefixed, each number a big-endian int64, the root's 32 bytes as they are. */
export function canonicalPayload(r: Receipt): Buffer {
  const str = (s: string) => {
    const b = Buffer.from(s, 'utf8')
    const l = Buffer.alloc(4)
    l.writeUInt32BE(b.length)
    return Buffer.concat([l, b])
  }
  const i64 = (n: number) => {
    const b = Buffer.alloc(8)
    b.writeBigInt64BE(BigInt(n))
    return b
  }
  return Buffer.concat([str(r.request_id), str(r.node_id), str(r.workspace_id), str(r.model), i64(r.input_tokens), i64(r.output_tokens),
    Buffer.from(r.merkle_root), i64(r.timestamp), i64(r.leaf_count)])
}

/** A node's ed25519 key pair: the public half as Lens stores it (standard base64 of the raw 32 bytes), and a signer. */
export function nodeKey(): { pub: string; signed: (r: Receipt) => Receipt & { signature: string } } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url')
  const priv = createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' }))
  return { pub: raw.toString('base64'), signed: (r) => ({ ...r, signature: sign(null, canonicalPayload(r), priv).toString('base64') }) }
}

interface StoredReceipt { request_id: string; node_id: string; verified: boolean }
interface Challenge { id: string; request_id: string; node_id: string; result: string; slashed_amount_ulens: number }

/**
 * PoVI on a compute node of the workspace's own, registered with an ed25519 key. A receipt it signs is verified and
 * recorded but mints nothing (the node holds no stake, and minting is Lens's operator's switch); one with a bad
 * signature is recorded unverified; both read back from the workspace's receipts. A challenge issued on the verified
 * receipt is recorded against the node and read back three ways, and another company cannot read it. Staking the node
 * with LENS the workspace does not have is refused; with nothing staked, unbond and release are refused; another
 * company cannot stake the node; and the staking, security and status reads, and Lens's challenge key, answer. Nothing
 * is charged, minted or slashed.
 */
export function povi(): Scenario {
  return {
    id: 'povi',
    owner: 'talyvor-lens',
    own: true,
    feature: 'PoVI',
    title: "a node's signed receipt verified and recorded with nothing minted, a bad one recorded unverified; a challenge on it recorded and read back by its owner only; a stake without LENS refused, unbond and release refused with nothing staked; nothing charged, minted or slashed",
    run: async (ctx) => {
      const wrong: string[] = []
      const ws = ctx.app.user.workspaceID
      const there = await another(ctx)
      const mine0 = await holdings(ctx)
      const key = nodeKey()
      const model = `e2e-${RUN_SALT}-povi`
      const node = await call<InferenceNode>(ctx, 'POST', '/v1/workspaces/{ws}/nodes', { url: nowhere('povi'), provider: 'ollama', models: [model], gpu_type: 'cpu', max_concurrent: 1, price_per_token: 0.000001, ed25519_pubkey: key.pub })
      const nid = node.value?.id
      if (node.status !== 201 || nid === undefined) return fail(`registering a node with its key answered ${said(node)}`)
      try {
        // Receipts: a signed one verified and recorded, a forged one recorded unverified; neither mints.
        const base: Receipt = { request_id: `e2e-${RUN_SALT}-${Date.now().toString(36)}`, node_id: nid, workspace_id: ws, model, input_tokens: 12, output_tokens: 8,
          merkle_root: [...randomBytes(32)], timestamp: Math.floor(Date.now() / 1000), leaf_count: 8 }
        const good = await call<{ verified: boolean; stake_eligible: boolean; minted: boolean; amount_ulens: number; reason?: string }>(ctx, 'POST', '/v1/workspaces/{ws}/povi/receipts', key.signed(base))
        if (!ok(good.status) || good.value?.verified !== true || good.value.minted || good.value.amount_ulens !== 0) wrong.push(`a receipt the node signed answered ${said(good)}: verified, nothing minted`)
        const forged = { ...key.signed({ ...base, request_id: `${base.request_id}-forged` }), output_tokens: 9_999 }
        const bad = await call<{ verified: boolean; minted: boolean }>(ctx, 'POST', '/v1/workspaces/{ws}/povi/receipts', forged)
        if (!ok(bad.status) || bad.value?.verified !== false || bad.value.minted) wrong.push(`a receipt altered after signing answered ${said(bad)}: recorded unverified`)
        const receipts = await call<StoredReceipt[] | null>(ctx, 'GET', `/v1/povi/receipts?workspace=${ws}`)
        const rs = list(receipts.value)
        if (rs.find((x) => x.request_id === base.request_id)?.verified !== true || rs.find((x) => x.request_id === forged.request_id)?.verified !== false) {
          wrong.push(`the workspace's receipts read ${said(receipts)}: the signed one verified and the altered one not`)
        }

        // A challenge on the verified receipt, recorded against the node; the node answers nothing, so it is not a pass.
        const issued = await call<Challenge>(ctx, 'POST', '/v1/povi/challenges/issue', { request_id: base.request_id })
        const cid = issued.value?.id
        if (!ok(issued.status) || cid === undefined || issued.value?.node_id !== nid || issued.value.result === 'pass') wrong.push(`a challenge on the signed receipt answered ${said(issued)}`)
        else {
          if (issued.value.slashed_amount_ulens !== 0) wrong.push(`a challenge on a node with nothing staked slashed ${issued.value.slashed_amount_ulens} µLENS`)
          const read = await call<Challenge>(ctx, 'GET', `/v1/povi/challenges/${cid}`)
          if (read.value?.id !== cid || read.value.request_id !== base.request_id) wrong.push(`the challenge reads ${said(read)}`)
          const byNode = await call<Challenge[] | null>(ctx, 'GET', `/v1/povi/challenges?node=${nid}`)
          if (!list(byNode.value).some((x) => x.id === cid)) wrong.push(`the node's challenges read ${said(byNode)}`)
          const dash = await call<Challenge[] | null>(ctx, 'GET', `/v1/api/povi/challenges?node=${nid}`)
          if (!list(dash.value).some((x) => x.id === cid)) wrong.push(`/v1/api/povi/challenges for the node reads ${said(dash)}`)
          const foreign = refused("another company reading the challenge", await call(there, 'GET', `/v1/povi/challenges/${cid}`), 404)
          if (foreign !== undefined) wrong.push(foreign)
        }
        const again = await call(ctx, 'POST', '/v1/povi/challenges/issue', { request_id: base.request_id })
        if (ok(again.status)) wrong.push(`a second challenge on the same receipt was issued: ${said(again)}`)
        const nobody = refused('a challenge on a receipt that does not exist', await call(ctx, 'POST', '/v1/povi/challenges/issue', { request_id: `e2e-no-such-receipt-${RUN_SALT}` }), 404)
        if (nobody !== undefined) wrong.push(nobody)
        const all = refused("every node's challenges, asked without naming a node", await call(ctx, 'GET', '/v1/povi/challenges'), 403)
        if (all !== undefined) wrong.push(all)

        // Stake: refused without LENS; unbond and release refused with nothing staked; another company cannot stake it.
        const status = await call<{ min_stake_ulens: number; unbond_period_seconds: number }>(ctx, 'GET', '/v1/povi/staking/status')
        const min = status.value?.min_stake_ulens ?? 0
        if (!ok(status.status) || !(min > 0)) wrong.push(`the staking status reads ${said(status)}`)
        const stake = await call(ctx, 'POST', `/v1/povi/nodes/${nid}/stake`, { amount_ulens: min })
        if (ok(stake.status)) wrong.push(`staking ${min} µLENS the workspace does not have was taken: ${said(stake)}`)
        const held = await call<{ staked?: boolean; stake?: unknown }>(ctx, 'GET', `/v1/povi/nodes/${nid}/stake`)
        if (!ok(held.status) || held.value?.staked !== false) wrong.push(`the node's stake reads ${said(held)}, not nothing staked`)
        for (const step of ['unbond', 'release']) {
          const r = await call(ctx, 'POST', `/v1/povi/nodes/${nid}/${step}`)
          if (ok(r.status)) wrong.push(`${step} with nothing staked was taken: ${said(r)}`)
        }
        const theirs = await call(there, 'POST', `/v1/povi/nodes/${nid}/stake`, { amount_ulens: min })
        if (ok(theirs.status) || theirs.status === 500) wrong.push(`another company staking the node answered ${said(theirs)}`)
        const stakes = await call<{ node_id: string }[] | null>(ctx, 'GET', '/v1/api/povi/stakes')
        if (!ok(stakes.status) || list(stakes.value).some((x) => x.node_id === nid)) wrong.push(`/v1/api/povi/stakes reads ${said(stakes)} with nothing staked on the node`)

        // What Lens states about PoVI, and the key its challenges are signed with.
        const st = await call<{ attestation_only: boolean; minting_enabled: boolean }>(ctx, 'GET', '/v1/povi/status')
        const sec = await call<{ minting_enabled: boolean; min_stake: number }>(ctx, 'GET', '/v1/povi/security/status')
        const pub = await call<{ ed25519_pubkey: string }>(ctx, 'GET', '/v1/povi/pubkey')
        if (st.value?.attestation_only !== true || st.value.minting_enabled !== sec.value?.minting_enabled) wrong.push(`the PoVI status reads ${said(st)} and its security ${said(sec)}`)
        if (Buffer.from(pub.value?.ed25519_pubkey ?? '', 'base64').length !== 32) wrong.push(`Lens's challenge key reads ${said(pub)}`)
      } finally {
        await call(ctx, 'DELETE', `/v1/workspaces/{ws}/nodes/${nid}`)
      }
      wrong.push(...await movedSince(ctx, mine0, 'the workspace'))
      return verdictOf(wrong, `a signed receipt verified and recorded with nothing minted, an altered one unverified; a challenge on it recorded, read back by its owner and not by another company, never issued twice; a stake without LENS refused, unbond and release refused with nothing staked; nothing charged, minted or slashed`)
    },
  }
}

// ─── LENS: annotation, transfers, and the retired token exchange and staking ───────────────────────

/**
 * What a workspace can do with LENS, and what it no longer can. The rates and its own mining reads answer for it.
 * Staking LENS on annotation, with none to stake, is refused (402) and unstaking with nothing staked moves nothing; an
 * annotation task that does not exist takes no answer. A transfer to another company of LENS it does not have is refused
 * (402). The token exchange and LENS staking are switched off (B18.1): each of their routes is 404. Nothing moves on
 * either company's LXC ledger or LENS.
 */
export function lensTokens(): Scenario {
  return {
    id: 'lens-tokens',
    owner: 'talyvor-lens',
    own: true,
    feature: 'LENS tokens',
    title: "annotation stake and unstake, a task answered and a LENS transfer, with no LENS to move, are refused; the retired token exchange and staking routes are 404; the rates and mining reads answer; nothing moves on either company",
    run: async (ctx) => {
      const wrong: string[] = []
      const right: string[] = []
      const there = await another(ctx)
      const mine0 = await holdings(ctx)
      const theirs0 = await holdings(there)
      const ws = ctx.app.user.workspaceID

      const rates = await call<{ annotation?: { stake_required_ulens?: number } }>(ctx, 'GET', '/v1/tokens/rates')
      if (!ok(rates.status) || rates.value?.annotation === undefined) wrong.push(`the LENS rates read ${said(rates)}`)
      for (const m of ['annotations', 'compute', 'embeddings', 'patterns']) {
        const r = await call<{ workspace_id?: string }>(ctx, 'GET', `/v1/workspaces/{ws}/tokens/mining/${m}`)
        if (!ok(r.status) || (r.value?.workspace_id !== undefined && r.value.workspace_id !== ws)) wrong.push(`the workspace's ${m} mining reads ${said(r)}`)
      }
      const stats0 = await call<{ workspace_id: string; annotations: number; staked_tokens_ulens: number }>(ctx, 'GET', '/v1/workspaces/{ws}/annotate/stats')
      if (stats0.value?.workspace_id !== ws) wrong.push(`the workspace's annotation stats read ${said(stats0)}`)

      // Annotation: nothing to stake, nothing staked, no task to answer.
      const stakeAmount = Math.max(1, rates.value?.annotation?.stake_required_ulens ?? 1_000_000)
      const stake = refused('staking LENS on annotation with none to stake', await call(ctx, 'POST', '/v1/workspaces/{ws}/annotate/stake', { amount_ulens: stakeAmount }), 402)
      const unstake = await call(ctx, 'DELETE', '/v1/workspaces/{ws}/annotate/stake')
      const task = await call<{ id?: string }>(ctx, 'GET', '/v1/workspaces/{ws}/annotate/task')
      const answer = await call(ctx, 'POST', `/v1/workspaces/{ws}/annotate/task/e2e-no-such-task-${RUN_SALT}`, { decision: 'approve', confidence: 3, time_spent_ms: 1000 })
      ctx.evidence.push({ note: `annotation — unstake with nothing staked ${said(unstake)}; the next task ${said(task)}; answering a task that does not exist ${said(answer)}` })
      if (stake !== undefined) wrong.push(stake)
      // Unstaking nothing may answer ok or refuse; either way nothing may move (the stats and holdings below).
      if (unstake.status >= 500) wrong.push(`unstaking with nothing staked answered ${said(unstake)}`)
      if (!ok(task.status) && task.status !== 404) wrong.push(`the next annotation task answered ${said(task)}`)
      if (ok(answer.status) || answer.status >= 500) wrong.push(`answering an annotation task that does not exist answered ${said(answer)}`)
      const stats1 = await call<{ annotations: number; staked_tokens_ulens: number }>(ctx, 'GET', '/v1/workspaces/{ws}/annotate/stats')
      if (stats1.value?.annotations !== stats0.value?.annotations || stats1.value?.staked_tokens_ulens !== stats0.value?.staked_tokens_ulens) wrong.push(`the annotation stats went from ${stats0.text.slice(0, 120)} to ${stats1.text.slice(0, 120)}`)
      else right.push('annotation stake refused (402), unstaking nothing moved nothing, no task answered')

      // A transfer of LENS the workspace does not have.
      const transfer = refused('a LENS transfer to another company with none to send', await call(ctx, 'POST', '/v1/workspaces/{ws}/tokens/transfer', { to_workspace: there.app.user.workspaceID, amount_ulens: 1_000, description: `e2e ${RUN_SALT}` }), 402)
      if (transfer !== undefined) wrong.push(transfer)
      else right.push('a LENS transfer with none to send refused (402)')

      // The token exchange and LENS staking, switched off by B18.1: not registered, so 404.
      const retired: [string, string, unknown?][] = [
        ['POST', '/v1/workspaces/{ws}/tokens/stake', { amount_ulens: 1_000_000, duration_days: 30 }],
        ['POST', '/v1/workspaces/{ws}/tokens/unstake', { position_id: `e2e-${RUN_SALT}` }],
        ['GET', '/v1/workspaces/{ws}/tokens/stakes'],
        ['GET', '/v1/marketplace/trades'],
        ['POST', `/v1/marketplace/listings/e2e-${RUN_SALT}/buy`, { amount_ulens: 1_000 }],
      ]
      for (const [m, p, body] of retired) {
        const why = refused(`${m} ${p}, switched off`, await call(ctx, m, p, body), 404)
        if (why !== undefined) wrong.push(why)
      }
      right.push('the token exchange and LENS staking 404')

      // Pattern mining (it mints LENS for patterns shared): opted into only where Lens runs it; out again either way.
      const mining0 = await call<{ enabled: boolean; opted_in: boolean }>(ctx, 'GET', '/v1/workspaces/{ws}/pattern-mining/opt-in')
      const optIn = await call(ctx, 'POST', '/v1/workspaces/{ws}/pattern-mining/opt-in', {})
      const mining1 = await call<{ enabled: boolean; opted_in: boolean }>(ctx, 'GET', '/v1/workspaces/{ws}/pattern-mining/opt-in')
      const optOut = await call<{ opted_in: boolean }>(ctx, 'DELETE', '/v1/workspaces/{ws}/pattern-mining/opt-in')
      const mining2 = await call<{ enabled: boolean; opted_in: boolean }>(ctx, 'GET', '/v1/workspaces/{ws}/pattern-mining/opt-in')
      ctx.evidence.push({ note: `pattern mining — ${said(mining0)}; opt in ${said(optIn)}; then ${said(mining1)}; opt out ${said(optOut)}; then ${said(mining2)}` })
      if (mining0.value?.enabled === false) {
        if (ok(optIn.status) || mining1.value?.opted_in !== false) wrong.push(`pattern mining is switched off and opting in answered ${said(optIn)}, then reads ${said(mining1)}`)
        else right.push('pattern mining, switched off, refused the opt-in')
      } else if (!ok(optIn.status) || mining1.value?.opted_in !== true) wrong.push(`opting into pattern mining answered ${said(optIn)}, then reads ${said(mining1)}`)
      if (!ok(optOut.status) || optOut.value?.opted_in !== false || mining2.value?.opted_in !== false) wrong.push(`opting out of pattern mining answered ${said(optOut)}, then reads ${said(mining2)}`)
      wrong.push(...await movedSince(ctx, mine0, 'the workspace'), ...await movedSince(there, theirs0, 'the other company'))
      return verdictOf(wrong, `${right.join('; ')}; the rates and mining reads answered; nothing moved on either company`)
    },
  }
}

// ─── credits bought, and a test workspace's plan ───────────────────────────────────────────────────

/** The smallest top-up Lens takes, in US cents (talyvor-lens internal/billing minTopUpCents). */
const TOP_UP_CENTS = 1_000
/** How long Stripe's webhook is given to reach Lens once the test card is paid. */
const WEBHOOK_WAIT_MS = 60_000

/**
 * Credits bought, on the workspace's own token, and paid with Stripe's test card: below the smallest top-up Lens refuses
 * (400) and nothing moves; the smallest opens Stripe's checkout, and once paid the ledger takes one credit of exactly
 * what was bought, at Lens's price of an LXC, and the balance moves by exactly that. Before it, the testers' key puts
 * the workspace on Team and back on Free (POST /v1/synthetic/workspaces/{ws}/plan), and Lens holds it to each.
 */
export function creditsTopUp(seed: number): Scenario {
  return {
    id: 'credits-top-up',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Billing',
    title: "credits bought with Stripe's test card: below the smallest top-up refused with nothing moved; the smallest paid is one credit of exactly what was bought on the ledger; a test workspace's plan set by the testers' key is the plan Lens holds it to",
    run: async (ctx) => {
      const wrong: string[] = []
      const { env, app } = ctx
      for (const plan of ['team', 'free'] as const) {
        const set = await env.lens.setTestPlan(app.user, plan)
        const held = await env.lens.workspacePlan(app.user)
        if (!set.ok || set.value.plan.plan !== plan || held.plan !== plan) wrong.push(`the testers' key putting the workspace on ${plan} answered ${set.ok ? set.value.plan.plan : `${set.status} ${set.error}`}, and Lens holds it to ${held.plan}`)
      }
      const before = await holdings(ctx)
      const balance0 = await env.lens.lxcBalance(app.user)
      const below = refused('a top-up below the smallest', await call(ctx, 'POST', '/v1/workspaces/{ws}/billing/checkout', { usd_cents: TOP_UP_CENTS - 1 }), 400, /usd_cents must be/)
      if (below !== undefined) wrong.push(below)
      wrong.push(...await movedSince(ctx, before, 'the workspace, after the top-up refused,'))
      const start = await call<{ url: string }>(ctx, 'POST', '/v1/workspaces/{ws}/billing/checkout', { usd_cents: TOP_UP_CENTS })
      if (!ok(start.status) || start.value?.url === undefined) return fail([...wrong, `a $${TOP_UP_CENTS / 100} top-up answered ${said(start)}`].join('; '))
      const paid = await payCheckout(app, start.value.url, `tester-${seed}@example.com`)
      ctx.evidence.push({ note: `$${TOP_UP_CENTS / 100} of credits, paid with the test card on ${paid.checkout}${paid.refused === undefined ? '' : `: ${paid.refused}`}` })
      if (paid.refused !== undefined) return fail([...wrong, `paying the top-up with the test card: ${paid.refused}`].join('; '))
      const want = Math.round(0.01 / env.usdPerLXC * 1e6) * TOP_UP_CENTS
      const fresh = await within(async () => (await env.lens.ledger(app.user)).filter((r) => !before.lxc.has(r.id)), (rs) => rs.some((r) => r.amount_ulxc > 0), WEBHOOK_WAIT_MS)
      ctx.evidence.push({ note: `the ledger after paying: ${fresh.length === 0 ? 'nothing' : rowsText(fresh)}`, ledger: fresh.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })) })
      const credits = fresh.filter((r) => r.amount_ulxc > 0)
      if (credits.length !== 1 || credits[0].amount_ulxc !== want || fresh.length !== 1) {
        wrong.push(`paid $${TOP_UP_CENTS / 100}, the ledger took ${fresh.length === 0 ? 'nothing' : rowsText(fresh)} within ${WEBHOOK_WAIT_MS / 1000} s, not one credit of ${want} µLXC`)
      }
      const balance1 = await env.lens.lxcBalance(app.user)
      if (balance1 - balance0 !== want) wrong.push(`the balance went from ${balance0} to ${balance1} µLXC, not up by the ${want} bought`)
      return verdictOf(wrong, `on Team and back on Free by the testers' key; below $${TOP_UP_CENTS / 100} refused with nothing moved; $${TOP_UP_CENTS / 100} paid with the test card is one credit of ${want} µLXC on the ledger`)
    },
  }
}
