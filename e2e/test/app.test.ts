import { describe, expect, it } from 'vitest'
import { noAnswer } from '../src/app.ts'

describe('noAnswer (B26.20)', () => {
  const q = 'What is the code word in the attached document?'

  it('says where the question stopped when no answer and no error came', () => {
    expect(noAnswer({ question: q, box: q, uploading: ['memo-2.html'], partial: undefined }, 120)).toBe(
      'no answer and no error after 120 s: the question was never sent — it is still in the message box, with memo-2.html still uploading')
    expect(noAnswer({ question: q, box: q, uploading: [], partial: undefined }, 120)).toBe(
      'no answer and no error after 120 s: the question was never sent — it is still in the message box')
    expect(noAnswer({ question: q, box: '', uploading: [], partial: undefined }, 120)).toBe(
      'no answer and no error after 120 s: the question left the message box but no answer was started')
    expect(noAnswer({ question: q, box: '', uploading: [], partial: 'The code' }, 120)).toBe(
      'no answer and no error after 120 s: the answer started but never finished ("The code")')
  })
})
