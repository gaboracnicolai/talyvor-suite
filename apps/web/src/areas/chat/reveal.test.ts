import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { FINISH_HORIZON_MS, Reveal, STREAM_HORIZON_MS, useRevealedText } from './reveal'

const FRAME = 16

/** Steps the pacer frame by frame until it has shown `upTo` characters; returns each frame's gain. */
function frames(r: Reveal, upTo: number, limit = 1000): number[] {
  const gains: number[] = []
  let prev = 0
  for (let i = 0; i < limit && prev < upTo; i++) {
    const now = r.step(FRAME)
    gains.push(now - prev)
    prev = now
  }
  return gains
}

describe('Reveal — the pace an answer grows at', () => {
  it('spreads a burst that arrives while the answer is streaming over the stream horizon', () => {
    const r = new Reveal()
    r.arrive(600, false)
    const gains = frames(r, 600)
    // Measured before B16.3: one frame showed 12% of a live answer. Spread over the horizon, no
    // frame shows more than a frame's share of it.
    expect(Math.max(...gains)).toBeLessThanOrEqual(Math.ceil((600 * FRAME) / STREAM_HORIZON_MS) + 1)
    expect(gains.length * FRAME).toBeLessThanOrEqual(STREAM_HORIZON_MS + FRAME)
  })

  it('reveals a complete answer — a cached one arrives in one piece — steadily, within the finish horizon', () => {
    const r = new Reveal()
    r.arrive(3000, true)
    const gains = frames(r, 3000)
    expect(gains.length).toBeGreaterThan(30) // not one block
    expect(Math.max(...gains) - Math.min(...gains.slice(0, -1))).toBeLessThanOrEqual(1) // steady
    expect(gains.length * FRAME).toBeLessThanOrEqual(FINISH_HORIZON_MS + FRAME)
    expect(r.finished).toBe(true)
  })
})

describe('useRevealedText', () => {
  it('shows an answer reopened from history at once, and paces one that is arriving', async () => {
    const past = renderHook(() => useRevealedText('An earlier answer, kept in history.', false))
    expect(past.result.current).toEqual({ text: 'An earlier answer, kept in history.', revealing: false })

    const answer = 'A cached answer arrives in one piece and still grows on screen.'
    const live = renderHook(({ text, live }) => useRevealedText(text, live), { initialProps: { text: '', live: true } })
    live.rerender({ text: answer, live: false })
    await act(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    expect(live.result.current.revealing).toBe(true)
    expect(live.result.current.text.length).toBeGreaterThan(0)
    expect(live.result.current.text.length).toBeLessThan(answer.length)
    expect(answer.startsWith(live.result.current.text)).toBe(true)
  })
})
