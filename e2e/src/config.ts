// B17.3 — what one run is told: where the app and Lens are, how many synthetic users, and the most it
// may spend. Flags win over the environment; nothing here has a production default that spends money
// without the operator key being set.

export interface RunConfig {
  /** The web app a person uses, e.g. https://app.talyvor.com. */
  appURL: string
  /** Lens, for the synthetic routes, ledger read-backs and the judge. */
  lensURL: string
  /** LENS_SYNTHETIC_KEY — the same value Lens and the BFF boot with. */
  syntheticKey: string
  users: number
  /** How many users drive a browser at the same moment. */
  concurrency: number
  /** HARD cap on what the run may spend, in US dollars: committed charges plus every in-flight worst case. */
  capUSD: number
  /** The cheap model every journey uses, by the name the picker shows. */
  model: string
  /** The model the judge asks, by catalog id and provider. */
  judgeModel: string
  judgeProvider: string
  outDir: string
  /** Where the day's Markdown report is appended (B17.4); undefined means the repo's docs/e2e. */
  reportDir: string | undefined
  /** The build queue each new FAIL is filed in (B17.4), or 'none' to file nothing. */
  buildMd: string
  headed: boolean
}

export const DEFAULTS = {
  users: 100,
  concurrency: 20,
  capUSD: 5,
  model: 'Claude Haiku 4.5',
  judgeModel: 'claude-haiku-4-5',
  judgeProvider: 'anthropic',
  outDir: 'out',
} as const

export function parseConfig(argv: string[], env: Record<string, string | undefined>): RunConfig {
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`)
    const [k, inline] = a.slice(2).split('=', 2)
    if (k === 'headed') {
      flags.set(k, 'true')
      continue
    }
    const v = inline ?? argv[++i]
    if (v === undefined) throw new Error(`--${k} needs a value`)
    flags.set(k, v)
  }
  const pick = (flag: string, name: string): string | undefined => flags.get(flag) ?? env[name]
  const num = (flag: string, name: string, fallback: number): number => {
    const raw = pick(flag, name)
    if (raw === undefined) return fallback
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${flag} must be a positive number, got ${raw}`)
    return n
  }

  const appURL = (pick('app', 'E2E_APP_URL') ?? '').replace(/\/+$/, '')
  const lensURL = (pick('lens', 'E2E_LENS_URL') ?? '').replace(/\/+$/, '')
  const syntheticKey = env.LENS_SYNTHETIC_KEY ?? ''
  const missing = [
    appURL === '' ? '--app (or E2E_APP_URL)' : '',
    lensURL === '' ? '--lens (or E2E_LENS_URL)' : '',
    syntheticKey === '' ? 'LENS_SYNTHETIC_KEY in the environment' : '',
  ].filter((m) => m !== '')
  if (missing.length > 0) throw new Error(`missing ${missing.join(', ')}`)

  return {
    appURL,
    lensURL,
    syntheticKey,
    users: Math.floor(num('users', 'E2E_USERS', DEFAULTS.users)),
    concurrency: Math.floor(num('concurrency', 'E2E_CONCURRENCY', DEFAULTS.concurrency)),
    capUSD: num('cap-usd', 'E2E_CAP_USD', DEFAULTS.capUSD),
    model: pick('model', 'E2E_MODEL') ?? DEFAULTS.model,
    judgeModel: pick('judge-model', 'E2E_JUDGE_MODEL') ?? DEFAULTS.judgeModel,
    judgeProvider: pick('judge-provider', 'E2E_JUDGE_PROVIDER') ?? DEFAULTS.judgeProvider,
    outDir: pick('out', 'E2E_OUT') ?? DEFAULTS.outDir,
    reportDir: pick('report-dir', 'E2E_REPORT_DIR'),
    buildMd: pick('build-md', 'E2E_BUILD_MD') ?? `${env.HOME ?? ''}/talyvor-queue/BUILD.md`,
    headed: flags.get('headed') === 'true',
  }
}
