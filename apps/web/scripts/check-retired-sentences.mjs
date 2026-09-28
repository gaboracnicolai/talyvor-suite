// check-retired-sentences.mjs — B21.4. Run by scripts/build-release.sh against the BUILT bundle.
//
// Fails when a sentence B21.4 replaced is still shipped, or when the four that replaced them are
// not (which also proves this read the right files: an empty or misplaced dist cannot pass).
// The fragments are ASCII so an escaped curly quote in the minified output cannot hide a match.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = process.argv[2] ?? 'apps/web/dist'

// What the product can no longer say: switching sharing off does not unshare what was shared,
// stored answers do not expire, the question IS stored with its answer, and "none" stores nothing.
const RETIRED = [
  'nothing of yours is shared',
  'you earn nothing',
  'expire after a configured period of disuse',
  'never persisted',
  'stored under every setting',
  'your prompt text is not kept',
]

// The four facts (components/StoredAnswersFacts.tsx), by an ASCII fragment of each.
const REQUIRED = [
  'Switching sharing off stops new answers being shared',
  'Stored answers are kept until you delete them; they do not expire.',
  'so that two questions can be compared',
  'nothing of a question or answer is stored',
]

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.(js|html)$/.test(name) ? [path] : []
  })
}

const shipped = files(dist).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
let failed = false
for (const s of RETIRED) {
  for (const f of shipped.filter((f) => f.text.includes(s))) {
    console.error(`FAIL retired sentence still shipped: "${s}" in ${f.path}`)
    failed = true
  }
}
for (const s of REQUIRED) {
  if (!shipped.some((f) => f.text.includes(s))) {
    console.error(`FAIL "${s}" is not in the bundle (${dist}, ${shipped.length} files read)`)
    failed = true
  }
}
if (failed) process.exit(1)
console.log(`    ok  no retired sentence in ${shipped.length} bundle files; the four stored-answer facts are there`)
