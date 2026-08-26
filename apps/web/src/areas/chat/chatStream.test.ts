import { describe, expect, it } from 'vitest'

import { extractDeltas, splitFrames } from './chatStream'

// THE SSE PARSER — the half of the chat screen that a rendering test cannot see.
//
// ⚠ WHY IT IS ITS OWN MODULE WITH ITS OWN TESTS. A chat that renders the right final answer
// through a parser that buffers, and one that renders it through a parser that streams, produce
// IDENTICAL final bytes. This project has already paid for that once: step 3's flush relay had a
// timing test that passed against `io.Copy`, and only a positive control found it. So the frame
// boundaries and the delta extraction are asserted HERE, on the bytes, and the incremental
// RENDERING is asserted separately in Chat.test.tsx. Neither alone is the proof.
//
// ⚠ WHICH SHAPES EXIST, MEASURED IN talyvor-lens RATHER THAN ASSUMED. Lens's streaming dispatch is
// `if cfg.ProviderName() == "openai" { ServeOpenAI } else { ServeAnthropic }` — TWO SSE writers and
// no others. So there are exactly two frame shapes on this wire, and a third would be a change in
// Lens, not a gap here.

describe('splitFrames', () => {
  it('yields only COMPLETE frames and hands the remainder back', () => {
    // The whole point: a chunk boundary can land mid-frame. A parser that treats every read as a
    // frame renders half a JSON object and then throws.
    const { frames, rest } = splitFrames('data: {"a":1}\n\ndata: {"b"')
    expect(frames).toEqual(['data: {"a":1}'])
    expect(rest).toBe('data: {"b"')
  })

  it('carries an incomplete frame across two reads and completes it', () => {
    const first = splitFrames('data: {"a"')
    expect(first.frames).toEqual([])
    const second = splitFrames(first.rest + ':1}\n\n')
    expect(second.frames).toEqual(['data: {"a":1}'])
    expect(second.rest).toBe('')
  })

  it('tolerates CRLF frame separators', () => {
    // Nothing in the path is guaranteed to use bare LF; a proxy may normalise.
    const { frames } = splitFrames('data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n')
    expect(frames).toEqual(['data: {"a":1}', 'data: {"b":2}'])
  })
})

describe('extractDeltas — OpenAI shape', () => {
  it('reads the content delta', () => {
    const got = extractDeltas('data: {"choices":[{"delta":{"content":"Hel"}}]}')
    expect(got.deltas).toEqual([{ text: 'Hel' }])
    expect(got.done).toBe(false)
    expect(got.unrecognised).toBe(0)
  })

  it('treats [DONE] as the end and not as text', () => {
    const got = extractDeltas('data: [DONE]')
    expect(got.done).toBe(true)
    expect(got.deltas).toEqual([])
    // ⚠ AND IT IS NOT UNRECOGNISED EITHER. A sentinel counted as "something I could not read"
    // would make the unrecognised counter fire on every healthy stream, and a warning that is
    // always on is a warning nobody reads.
    expect(got.unrecognised).toBe(0)
  })

  it('does not emit an empty delta for a frame that carries only a role', () => {
    // OpenAI opens with {"delta":{"role":"assistant"}}. Emitting "" for it is harmless to the text
    // and NOT harmless to the caller, which uses "first delta arrived" to drop the pending state.
    const got = extractDeltas('data: {"choices":[{"delta":{"role":"assistant"}}]}')
    expect(got.deltas).toEqual([])
    expect(got.unrecognised).toBe(0)
  })

  it('ignores the usage-only final frame Lens appends', () => {
    const got = extractDeltas('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}')
    expect(got.deltas).toEqual([])
    expect(got.unrecognised).toBe(0)
  })
})

describe('extractDeltas — Anthropic shape', () => {
  it('reads a text_delta', () => {
    const got = extractDeltas(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}',
    )
    expect(got.deltas).toEqual([{ text: 'lo' }])
    expect(got.done).toBe(false)
  })

  it('ends on message_stop', () => {
    const got = extractDeltas('event: message_stop\ndata: {"type":"message_stop"}')
    expect(got.done).toBe(true)
    expect(got.deltas).toEqual([])
    expect(got.unrecognised).toBe(0)
  })

  it('does not read a THINKING delta as answer text', () => {
    // ⚠ A thinking_delta carries `delta.thinking`, not `delta.text`, and rendering it as the answer
    // would put the model's reasoning in the reply. The shape check is on delta.type, not on the
    // mere presence of a string.
    const got = extractDeltas(
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}',
    )
    expect(got.deltas).toEqual([])
  })

  it('is silent about the control frames a healthy stream always sends', () => {
    for (const frame of [
      'data: {"type":"message_start","message":{"id":"m1"}}',
      'data: {"type":"content_block_start","index":0}',
      'data: {"type":"content_block_stop","index":0}',
      'data: {"type":"ping"}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    ]) {
      const got = extractDeltas(frame)
      expect({ frame, ...got }).toEqual({ frame, deltas: [], done: false, unrecognised: 0 })
    }
  })
})

describe('extractDeltas — what it refuses to swallow', () => {
  it('COUNTS a frame it cannot read rather than dropping it', () => {
    // ⚠ THE ONE THAT MATTERS. A parser that returns "no text" for a shape it does not know is
    // indistinguishable, on screen, from a model that answered nothing. The count is what lets the
    // screen say "the stream ended and I could not read N frames" instead of showing a blank reply.
    const got = extractDeltas('data: {"some":"shape nobody here has seen"}')
    expect(got.deltas).toEqual([])
    expect(got.unrecognised).toBe(1)
  })

  it('counts UNPARSEABLE json as unrecognised rather than throwing', () => {
    // A throw inside the read loop aborts a stream that may be 95% delivered.
    const got = extractDeltas('data: {not json')
    expect(got.deltas).toEqual([])
    expect(got.unrecognised).toBe(1)
  })

  it('reads an error frame as an ERROR, not as unrecognised and not as text', () => {
    const got = extractDeltas('data: {"error":{"message":"rate limited"}}')
    expect(got.error).toBe('rate limited')
    expect(got.deltas).toEqual([])
    expect(got.unrecognised).toBe(0)
  })

  it('ignores a comment/keepalive line without counting it', () => {
    expect(extractDeltas(': keep-alive')).toEqual({ deltas: [], done: false, unrecognised: 0 })
  })
})
