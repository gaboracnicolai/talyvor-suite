// B28.293 — EVERY NEW B28 FEATURE SHIPS WITH ITS OWN TEST. A scenario names the build items whose feature it exercises
// end to end (Scenario.items). After the scenarios the run reads the queue (--build-md) and the report gets a B28
// features section: every B28 item marked DONE, the scenarios that name it and their verdicts this run. So the count
// of tested features rises as features land with their scenarios, and a feature that breaks or goes away FAILs by name.
//
// A DONE feature no scenario names files one item for the testers' harness, once (`e2e-scenario: b28-untested-<id>`,
// filing.ts), unless an e2e item already waits on it (OPEN, CLAIMED or BLOCKED, its deps naming the feature) or
// NO_SCENARIO gives the true reason no scenario can reach it. The testers' own items (talyvor-e2e, or titled for an
// e2e scenario) are tests, not features; edge-infra's are proven on kind, in the Talyvor Edge section.

export type Verdicts = Record<'PASS' | 'FAIL' | 'ERROR' | 'SKIP', number>

/** One item of BUILD.md: its heading and its `repo: … · deps: … · status: …` line. */
export interface QueueItem {
  id: string
  title: string
  repo: string
  deps: string[]
  status: string
}

export interface B28Feature {
  id: string
  title: string
  repo: string
  /**
   * tested: a scenario names it and ran this run. not run: one names it, and no user reached it this run. waiting: none
   * names it yet, and an e2e item (`item`) will write one. no scenario: none names it — filed. cannot: no scenario can
   * reach it, `why` says why.
   */
  state: 'tested' | 'not run' | 'waiting' | 'no scenario' | 'cannot'
  scenarios: string[]
  verdicts: Verdicts
  why?: string
  /** The build item that holds it: the e2e item waiting on it, or the one filed (or already open) for it. */
  item?: string
}

export interface B28Report {
  read_at: string
  features: B28Feature[]
}

/** DONE B28 items no scenario can reach, each with the true reason. A feature a person or an agent can use is never here. */
export const NO_SCENARIO: Readonly<Record<string, string>> = {
  'B28.11': "words in Lens's README and docs on GitHub, which the product does not serve",
  'B28.13': "words in the SDKs' READMEs and the VS Code extension's listing, which the product does not serve",
  'B28.14': "words in Track's README on GitHub, which the product does not serve",
  'B28.17': "words in the suite's README and features inventory on GitHub, which the product does not serve",
  'B28.438': "words in Docs' README on GitHub, which the product does not serve",
  'B28.211': "the suite's container image, for running it on Kubernetes; production runs the BFF as a binary under systemd, and CI's image job proves the image's /healthz on every pull request and on main",
  'B28.212': 'Helm charts for running Track and Docs on Kubernetes; production runs them under docker compose',
  'B28.260': "how talyvor-code's CI installs and scans; nothing a person or an agent does reaches it",
  'B28.263': "how the suite's CI audits its frontend packages; nothing a person or an agent does reaches it",
  'B28.448': "how Track's CI scans; nothing a person or an agent does reaches it",
  'B28.449': "how Docs' CI scans; nothing a person or an agent does reaches it",
  'B28.455': "how Track's CI audits its frontend packages; nothing a person or an agent does reaches it",
  'B28.456': "how Docs' CI audits its frontend packages; nothing a person or an agent does reaches it",
  'B28.248': "Docs' /metrics; production serves Docs only to the BFF, on 127.0.0.1, so no request from outside reaches it",
  'B28.436': "Track's /metrics; production serves Track only to the BFF, on 127.0.0.1, so no request from outside reaches it",
  'B28.442': "Track's check of the BFF's signed assertion; production serves Track only to the BFF, on 127.0.0.1, so no forged one can be sent from outside",
}

const EDGE_WHY = 'edge-infra is never deployed: its features are proven on kind by its nightly workflows (the Talyvor Edge section)'

/** The statuses under which an item still holds work to do. */
const OPEN = new Set(['OPEN', 'CLAIMED', 'BLOCKED'])

/** Every item in BUILD.md with a `repo:` line under its heading. */
export function queueItems(buildMd: string): QueueItem[] {
  const out: QueueItem[] = []
  let head: { id: string; title: string } | undefined
  for (const line of buildMd.split('\n')) {
    const h = /^## (B\d+\.\d+) — (.*)$/.exec(line)
    if (h !== null) {
      head = { id: h[1], title: h[2].trim() }
      continue
    }
    const r = /^repo: (.*?) · deps: (.*?) · status: ([A-Z]+)/.exec(line)
    if (r === null || head === undefined) continue
    out.push({ ...head, repo: r[1].trim(), deps: r[2].split(/[\s,]+/).filter((d) => /^B\d+\.\d+$/.test(d)), status: r[3] })
    head = undefined
  }
  return out
}

/** An item that is a test, not a feature: the testers' own, or one that writes an e2e scenario. */
export const isTestItem = (i: Pick<QueueItem, 'repo' | 'title'>): boolean => i.repo === 'talyvor-e2e' || /\be2e\b/i.test(i.title)

const order = (a: string, b: string): number => Number(a.split('.')[1]) - Number(b.split('.')[1])

/**
 * Every DONE B28 feature in `buildMd`, the scenarios `named` (scenario id → the items it names) say test it, and the
 * verdicts those scenarios had in `outcomes`. Pure.
 */
export function b28Report(buildMd: string, named: ReadonlyMap<string, readonly string[]>,
  outcomes: readonly { scenario: string; status: keyof Verdicts }[], readAt = new Date().toISOString()): B28Report {
  const items = queueItems(buildMd)
  const testedBy = new Map<string, string[]>()
  for (const [scenario, ids] of named) for (const id of ids) testedBy.set(id, [...(testedBy.get(id) ?? []), scenario])
  const features: B28Feature[] = []
  for (const i of items.filter((x) => x.id.startsWith('B28.') && x.status === 'DONE' && !isTestItem(x)).sort((a, b) => order(a.id, b.id))) {
    const scenarios = (testedBy.get(i.id) ?? []).sort()
    const verdicts: Verdicts = { PASS: 0, FAIL: 0, ERROR: 0, SKIP: 0 }
    for (const o of outcomes) if (scenarios.includes(o.scenario)) verdicts[o.status]++
    const f: B28Feature = { id: i.id, title: i.title, repo: i.repo, state: 'no scenario', scenarios, verdicts }
    const waiting = items.find((x) => OPEN.has(x.status) && x.deps.includes(i.id) && isTestItem(x))
    if (scenarios.length > 0) f.state = Object.values(verdicts).some((n) => n > 0) ? 'tested' : 'not run'
    else if (i.repo === 'edge-infra') Object.assign(f, { state: 'cannot', why: EDGE_WHY })
    else if (NO_SCENARIO[i.id] !== undefined) Object.assign(f, { state: 'cannot', why: NO_SCENARIO[i.id] })
    else if (waiting !== undefined) Object.assign(f, { state: 'waiting', item: waiting.id })
    features.push(f)
  }
  return { read_at: readAt, features }
}

export const untestedMarker = (f: Pick<B28Feature, 'id'>): string => `b28-untested-${f.id}`

const cell = (s: string): string => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

function verdictText(f: B28Feature, filed: Readonly<Record<string, string>>): string {
  if (f.state === 'not run') return 'not run — no user reached it this run'
  if (f.state === 'waiting') return `no scenario yet — ${f.item} writes it`
  if (f.state === 'no scenario') return `**NO SCENARIO**${f.item === undefined ? '' : ` — build item ${f.item}`}`
  const v = f.verdicts
  const items = [...new Set(f.scenarios.map((s) => filed[s]).filter((x) => x !== undefined))]
  return [v.FAIL > 0 ? `**FAIL** ${v.FAIL}` : '', v.ERROR > 0 ? `ERROR ${v.ERROR}` : '', v.PASS > 0 ? `PASS ${v.PASS}` : '', v.SKIP > 0 ? `SKIP ${v.SKIP}` : '']
    .filter((x) => x !== '').join(', ') + (v.FAIL > 0 && items.length > 0 ? ` — build item ${items.join(', ')}` : '')
}

const scenarios = (n: number): string => `${n} scenario${n === 1 ? '' : 's'}`

/** The counts the section opens with and TESTERS.md carries. */
function tally(r: B28Report): { done: number; tested: number; scenarios: number; failing: B28Feature[] } {
  const named = r.features.filter((f) => f.scenarios.length > 0)
  return {
    done: r.features.length,
    tested: named.filter((f) => f.state === 'tested').length,
    scenarios: new Set(named.flatMap((f) => f.scenarios)).size,
    failing: named.filter((f) => f.verdicts.FAIL > 0),
  }
}

/** The report's B28 features section; `filed` is each failing scenario's build item (ReportedRun.filed). */
export function renderB28(r: B28Report | undefined, filed: Readonly<Record<string, string>> = {}): string[] {
  if (r === undefined) return []
  const t = tally(r)
  const of = (s: B28Feature['state']): B28Feature[] => r.features.filter((f) => f.state === s)
  const cannot = of('cannot')
  const edge = cannot.filter((f) => f.why === EDGE_WHY)
  return ['', '### B28 features — each with its own test', '',
    `${t.tested} of ${t.done} DONE B28 features were tested this run by the ${scenarios(t.scenarios)} that name one; ` +
      `${of('not run').length} are named by a scenario no user reached this run, ${of('no scenario').length + of('waiting').length} have no scenario yet ` +
      `(${of('waiting').length} held by an e2e item), and ${cannot.length} cannot be reached by one.`, '',
    '| Feature | Repo | Scenarios | This run |', '|---|---|---|---|',
    ...r.features.filter((f) => f.state !== 'cannot').map((f) =>
      `| ${f.id} ${cell(f.title)} | ${f.repo} | ${f.scenarios.length === 0 ? '—' : f.scenarios.map((s) => `\`${s}\``).join(', ')} | ${verdictText(f, filed)} |`),
    '', 'Cannot be reached by a scenario:', '',
    ...cannot.filter((f) => f.why !== EDGE_WHY).map((f) => `- ${f.id} ${cell(f.title)} — ${f.why}.`),
    ...(edge.length === 0 ? [] : [`- edge-infra's ${edge.length} (${edge.map((f) => f.id).join(', ')}) — ${EDGE_WHY}.`]), '']
}

/** The section in one line, for TESTERS.md. */
export function b28Line(r: B28Report | undefined): string[] {
  if (r === undefined) return []
  const t = tally(r)
  const none = r.features.filter((f) => f.state === 'no scenario')
  return [`- **B28 features**: ${t.tested} of ${t.done} DONE tested this run by ${scenarios(t.scenarios)}` +
    (t.failing.length === 0 ? '' : `; FAIL: ${t.failing.map((f) => `${f.id} (${f.scenarios.join(', ')})`).join(', ')}`) +
    (none.length === 0 ? '' : `; no scenario: ${none.map((f) => `${f.id}${f.item === undefined ? '' : ` (${f.item})`}`).join(', ')}`) + '.']
}
