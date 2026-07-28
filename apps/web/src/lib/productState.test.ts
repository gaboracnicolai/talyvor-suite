import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { isSessionExpired, isUnconfigured, notConfiguredCopy } from './productState'

// productState — WHICH STATUS MEANS WHAT.
//
// ⚠ THIS FILE DID NOT EXIST, AND THAT IS WHY A MISDIAGNOSIS SHIPPED. isUnconfigured treated
// 404 as "product not deployed". A BFF routing bug — asking Docs for a path it does not
// register — therefore rendered as "Docs is not configured on this deployment — no upstream is
// wired", while Docs was running and had just served the space list. The operator was sent to
// check environment variables that were correct.
//
// The predicate is four lines and every consumer trusts it, which is exactly the kind of thing
// that gets changed without anyone noticing what else moved. So each status is asserted here,
// including the ones that must NOT match — a predicate is defined as much by what it rejects.

const err = (status: number) => new ApiError(status, '/api/docs/spaces/sp-1')

describe('isUnconfigured means "no upstream is wired", and only that', () => {
  it('503 is the signal — the BFF writes it deliberately for an empty base URL', () => {
    expect(isUnconfigured(err(503))).toBe(true)
  })

  // ⚠ THE REGRESSION THIS FILE EXISTS FOR.
  it('404 is NOT "not configured" — it is a statement about an address', () => {
    expect(isUnconfigured(err(404))).toBe(false)
  })

  it.each([[400], [401], [403], [500], [502]])(
    '%i is a genuine failure and must not be laundered into "off"',
    (status) => {
      expect(isUnconfigured(err(status))).toBe(false)
    },
  )

  it('a non-ApiError is never "not configured" — a thrown string is not a status', () => {
    expect(isUnconfigured(new Error('network down'))).toBe(false)
    expect(isUnconfigured('503')).toBe(false)
    expect(isUnconfigured(null)).toBe(false)
  })
})

describe('the three states stay distinct', () => {
  it('401 is session-expired and NOT unconfigured', () => {
    expect(isSessionExpired(err(401))).toBe(true)
    expect(isUnconfigured(err(401))).toBe(false)
  })

  it('503 is unconfigured and NOT session-expired', () => {
    expect(isUnconfigured(err(503))).toBe(true)
    expect(isSessionExpired(err(503))).toBe(false)
  })

  // 404 must land in NEITHER calm bucket: not "sign in again", not "not wired here".
  it('404 is neither — it falls through to the ordinary error path', () => {
    expect(isUnconfigured(err(404))).toBe(false)
    expect(isSessionExpired(err(404))).toBe(false)
  })
})

describe('the not-configured sentence', () => {
  it('names the product, so two products cannot say the same thing', () => {
    expect(notConfiguredCopy('Docs')).toContain('Docs')
    expect(notConfiguredCopy('Track')).toContain('Track')
    expect(notConfiguredCopy('Docs')).not.toEqual(notConfiguredCopy('Track'))
  })

  it('claims only that no upstream is wired — never that the product is broken', () => {
    const copy = notConfiguredCopy('Docs')
    expect(copy).toMatch(/not configured|no upstream/i)
    expect(copy).not.toMatch(/error|failed|broken|unavailable/i)
  })
})
