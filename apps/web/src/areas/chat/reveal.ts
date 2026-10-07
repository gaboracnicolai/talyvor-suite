/**
 * reveal.ts — B16.3: an answer appears at a steady pace, however its bytes arrive.
 *
 * MEASURED 27 Sep, the whole chain (provider → Lens → BFF → Caddy 2.11.4 → this app in Chromium):
 * NO HOP BUFFERS. Lens, the BFF and Caddy each delivered a recorded gpt-4o-mini stream as 69–83
 * reads, 12–15 ms apart at the median, first text within 10 ms of the provider's. What the reader saw
 * was the arrival pattern itself: a live answer in bursts (one frame added 12% of the answer; gaps up
 * to 186 ms) and a cached answer in ONE frame — Lens replays a cached answer as a single delta
 * (replayAsSSE), so nothing downstream can stream it. The fix therefore lives here, in the display.
 *
 * The pace is set when text ARRIVES and held until the next arrival, so between arrivals the text
 * grows linearly rather than easing out:
 *  · while the answer is still arriving, whatever is waiting is shown over STREAM_HORIZON_MS — a
 *    burst is spread out, and the display is never more than that far behind the network;
 *  · once the whole answer is known (a finished stream, or a cached answer that arrived at once),
 *    the rest is shown at FINISHED_CPS, or faster if it would otherwise take longer than
 *    FINISH_HORIZON_MS. The pace never drops at that moment, so a live answer does not slow down
 *    as it ends.
 */

import { useEffect, useRef, useState } from 'react'

/** While text is still arriving, a burst is revealed over this long. */
export const STREAM_HORIZON_MS = 350
/** Text that is already complete is revealed within about this long, however much of it there is. */
export const FINISH_HORIZON_MS = 1200
/** The slowest pace while text is still arriving — a trickle still reads as typing, not stalling. */
export const MIN_CPS = 120
/** The pace of a complete answer — about what a fast model streams at. */
export const FINISHED_CPS = 600

/** The pacer, separate from React so its arithmetic can be tested frame by frame. */
export class Reveal {
  private shown: number
  private received = 0
  private perMs = 0
  private complete = false

  /** B28.113 — `shown` characters are already on screen: a continued answer reveals only what is added. */
  constructor(shown = 0) {
    this.shown = shown
  }

  /** `received` characters have arrived; `complete` once no more will. */
  arrive(received: number, complete: boolean): void {
    this.shown = Math.min(this.shown, received)
    this.received = received
    const backlog = received - this.shown
    this.perMs = complete
      ? Math.max(this.perMs, FINISHED_CPS / 1000, backlog / FINISH_HORIZON_MS)
      : Math.max(MIN_CPS / 1000, backlog / STREAM_HORIZON_MS)
    this.complete = complete
  }

  /** Advances the display by `ms` and returns how many characters to show. */
  step(ms: number): number {
    this.shown = Math.min(this.received, this.shown + this.perMs * ms)
    return Math.floor(this.shown)
  }

  /** Everything is shown and nothing more is coming. */
  get finished(): boolean {
    return this.complete && this.shown >= this.received
  }
}

/** Never cut a surrogate pair: half an emoji renders as a replacement glyph for a frame. */
function cut(text: string, n: number): string {
  if (n >= text.length) return text
  const c = text.charCodeAt(n - 1)
  return text.slice(0, c >= 0xd800 && c <= 0xdbff ? n + 1 : n)
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * useRevealedText paces `text` while `live` (the answer is being received) and until it has caught
 * up afterwards. Text that was never live — a conversation reopened from history — shows at once,
 * and so does everything under prefers-reduced-motion.
 */
export function useRevealedText(text: string, live: boolean): { text: string; revealing: boolean } {
  const [paced] = useState(() => typeof requestAnimationFrame === 'function' && !prefersReducedMotion())
  const [revealing, setRevealing] = useState(paced && live)
  const [count, setCount] = useState(0)
  const pacer = useRef<Reveal | null>(null)
  const seen = useRef('')
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (!paced) return
    const continues = text.startsWith(seen.current)
    const prior = seen.current
    seen.current = text
    if (pacer.current !== null && !continues) pacer.current = null // a regenerated or different answer
    if (pacer.current === null) {
      if (!live) {
        setRevealing(false)
        return
      }
      // B28.113 — an answer continued keeps what it already showed (Continue trims it to its last break first).
      let kept = 0
      while (kept < prior.length && kept < text.length && prior[kept] === text[kept]) kept++
      pacer.current = new Reveal(kept)
      setCount(kept)
      setRevealing(true)
    }
    pacer.current.arrive(text.length, !live)
    if (frame.current !== null) return
    let last = performance.now()
    const tick = (now: number) => {
      const p = pacer.current
      if (p === null) {
        frame.current = null
        return
      }
      setCount(p.step(Math.max(0, now - last)))
      last = now
      if (p.finished) {
        pacer.current = null
        frame.current = null
        setRevealing(false)
        return
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [paced, text, live])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    },
    [],
  )

  return revealing ? { text: cut(text, count), revealing } : { text, revealing }
}
