// B34.2 — A NIGHT HELD BEHIND MAIN. scripts/e2e-nightly.sh calls this, instead of the run, when it cannot bring
// the checkout to main's head: it puts an entry at the top of TESTERS.md saying why, which commit the night
// would have tested and what the checkout and production are at, and runs no scenario.
//
//   node --experimental-strip-types e2e/src/held.ts --why "<why>" --would-test "<main's head>" [run flags]
//
// Its settings are the run's (config.ts); it exits 2 when it cannot read them.

import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseConfig } from './config.ts'
import { writeHeld } from './report.ts'
import { readVersions } from './versions.ts'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function main(): Promise<number> {
  const rest: string[] = []
  const own = new Map<string, string>()
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--why' || argv[i] === '--would-test') own.set(argv[i], argv[++i] ?? '')
    else rest.push(argv[i])
  }
  const why = own.get('--why') ?? ''
  if (why === '') {
    console.error('e2e held: --why is needed')
    return 2
  }
  let cfg
  try {
    cfg = parseConfig(rest, process.env)
  } catch (e) {
    console.error(`e2e held: ${e instanceof Error ? e.message : String(e)}`)
    return 2
  }
  const held = {
    at: new Date().toISOString(),
    why,
    wouldTest: own.get('--would-test') || "not known (main's head could not be read)",
    versions: await readVersions(REPO, cfg.lensSrc, cfg.appURL, cfg.lensURL),
  }
  if (cfg.testersMd !== 'none') {
    await writeHeld(cfg.testersMd, held)
    console.log(`held: ${why}; the entry is at the top of ${cfg.testersMd}`)
  }
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await main()
}
