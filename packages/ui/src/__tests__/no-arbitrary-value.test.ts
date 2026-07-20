import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Proves the lock bites: linting a file that uses Tailwind arbitrary values must FAIL
// with local/no-arbitrary-value. The fixture is ignored by the normal `pnpm lint`, so
// we lint it explicitly with --no-ignore.
const repoRoot = resolve(import.meta.dirname, '../../../..')

describe('local/no-arbitrary-value fails CI on arbitrary values', () => {
  it('flags text-[#fff] / p-[13px] in the fixture', () => {
    let threw = false
    let out = ''
    try {
      out = execFileSync(
        'pnpm',
        ['exec', 'eslint', '--no-ignore', '--format', 'json', 'packages/ui/fixtures/bad-arbitrary.tsx'],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (e) {
      threw = true
      const err = e as { stdout?: string; stderr?: string }
      out = (err.stdout ?? '') + (err.stderr ?? '')
    }
    expect(threw, 'eslint should exit non-zero on the fixture').toBe(true)
    expect(out).toContain('local/no-arbitrary-value')
  })
})
