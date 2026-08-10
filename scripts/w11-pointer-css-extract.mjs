// ONE extractor, in a file, used for BOTH sides of the before/after.
//
// ⚠ `298b659` measured this comparison with two ad-hoc shell extractors that escaped
// backslashes differently and read 345 vs 373 — a fact about the two instruments wearing
// the shape of a fact about the merge. There is exactly one extractor now, and both sides
// are read by this file.
//
// Prints: <class-count> <bytes> and one class selector per line, sorted.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = process.argv[2]
const css = readdirSync(dir).filter((f) => f.endsWith('.css'))
if (css.length !== 1) {
  console.error(`expected exactly 1 css file in ${dir}, found ${css.length}: ${css.join(', ')}`)
  process.exit(2)
}
const text = readFileSync(resolve(dir, css[0]), 'utf8')
// class selectors, escapes intact
const names = [...text.matchAll(/\.((?:[\\][^\s{,>+~)]|[A-Za-z0-9_-])+)/g)].map((m) => m[1])
const uniq = [...new Set(names)].sort()
console.log(`COUNT ${uniq.length} BYTES ${Buffer.byteLength(text)}`)
for (const n of uniq) console.log(n)
