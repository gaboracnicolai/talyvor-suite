import { describe, expect, it } from 'vitest'
import type { BurstAnswer } from '../src/lens.ts'
import { refusalFaults } from '../src/ratelimit.ts'

const served: BurstAnswer = { status: 200, retryAfter: null, remaining: '7', text: '{"id":"ws"}' }
const refused: BurstAnswer = { status: 429, retryAfter: '1', remaining: '0', text: '{"error":"rate limit exceeded","limit_type":"second","retry_after_seconds":1}' }

describe('B28.288 rate-limits-hold', () => {
  it('passes a refusal that says when to come back, and names each one that does not, and a burst answered neither way', () => {
    expect(refusalFaults([served, refused, refused])).toEqual([])
    expect(refusalFaults([served, refused, { ...refused, retryAfter: null }, { ...refused, retryAfter: '0', text: '{"error":"rate limit exceeded"}' }, { status: 502, retryAfter: null, remaining: null, text: '' }]))
      .toEqual(['1 of the 3 refusals carried no Retry-After', '1 of the 3 refusals carried Retry-After "0", not a whole number of seconds of at least 1',
        '1 of the 3 refusals named no limit_type (the window it hit)', '1 of the 3 refusals said retry_after_seconds undefined against Retry-After 0',
        'the burst was answered 502 ×1, neither served nor refused 429'])
  })
})
