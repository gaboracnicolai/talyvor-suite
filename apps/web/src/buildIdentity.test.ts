import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { bundleVersionPayload, describeBuild, UNSTAMPED } from './buildIdentity'

// GUARD 1 FOR THE WEB HALF. The companion — that the built artifact never reports the
// placeholder — is NOT here and cannot be: nothing in a unit test can observe whether `vite build`
// ran with SUITE_COMMIT set. That check runs against apps/web/dist/version.json in CI's web job
// and in scripts/build-release.sh. Test 1 alone proves the placeholder is honest while saying
// nothing about whether it was ever replaced, which is the trap this pair exists to close.
//
// What replaced what: apps/web/package.json carried "version": "0.1.0" from the first commit
// until this change, and it was never right and never wrong — nothing read it and nothing updated
// it. The field is now gone from all three private workspace packages rather than left to be
// misread as a build identity.

const versionShaped = /^\d+\.\d+\.\d+$/

describe('the build identity — the placeholder', () => {
  it('is not version-shaped, so an unstamped build cannot claim a version', () => {
    expect(UNSTAMPED).not.toMatch(versionShaped)
  })

  it('is an explicit, recognisable "unset" marker', () => {
    expect(['dev', 'unknown', 'none']).toContain(UNSTAMPED)
  })

  it('matches the BFF placeholder, or the two services stop understanding each other', () => {
    // The BFF reads the bundle's version.json and classifies it. If Go's notion of "unstamped"
    // drifts from this one, the BFF would treat a placeholder as a real commit and report a
    // MISMATCH against a version that does not exist. Pinned by reading the Go source, because
    // the alternative is a shared constant neither language can hold.
    const go = readFileSync(join(__dirname, '../../bff/version.go'), 'utf8')
    const m = go.match(/const unstampedPlaceholder = "([^"]+)"/)
    expect(m, 'apps/bff/version.go no longer declares unstampedPlaceholder').not.toBeNull()
    expect(m![1]).toBe(UNSTAMPED)
  })
})

describe('the build identity — classification', () => {
  it('treats every flavour of "not set" as unstamped, with no commit and a reason', () => {
    for (const raw of [undefined, '', '   ', '\n', UNSTAMPED]) {
      const got = describeBuild(raw)
      expect(got.stamped, `${JSON.stringify(raw)} should be unstamped`).toBe(false)
      expect(got.commit).toBeUndefined()
      // stamped:false alone does not tell a reader what to do about it.
      expect(got.note ?? '').not.toBe('')
    }
  })

  it('reports a real commit as stamped, trimmed', () => {
    expect(describeBuild('b41ea4d')).toEqual({ commit: 'b41ea4d', stamped: true })
    expect(describeBuild('  b41ea4d\n').commit).toBe('b41ea4d')
  })

  it('carries no note when stamped, so a note always means something', () => {
    expect(describeBuild('b41ea4d').note).toBeUndefined()
  })
})

describe('the build identity — the emitted version.json', () => {
  it('names the service, so the two payloads cannot be confused', () => {
    // An operator curls the BFF's /api/version and the bundle's /version.json within seconds of
    // each other. Both must say which one they are.
    expect(bundleVersionPayload('b41ea4d').service).toBe('web')
  })

  it('omits commit entirely when unstamped, so `jq .commit` is null not "dev"', () => {
    const payload = bundleVersionPayload(undefined)
    expect('commit' in payload).toBe(false)
    expect(payload.stamped).toBe(false)
    // Round-trip through JSON, because the absence has to survive serialisation — this is the
    // shape the BFF and the operator actually read.
    const parsed = JSON.parse(JSON.stringify(payload))
    expect(parsed.commit).toBeUndefined()
    expect(parsed.stamped).toBe(false)
  })

  it('reports the commit when stamped', () => {
    const parsed = JSON.parse(JSON.stringify(bundleVersionPayload('b41ea4d')))
    expect(parsed).toMatchObject({ service: 'web', commit: 'b41ea4d', stamped: true })
  })
})
