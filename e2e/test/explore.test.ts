import { describe, expect, it } from 'vitest'
import { cutText, type Finding, Notebook, parseMove } from '../src/explore.ts'

describe("an explorer's reply", () => {
  it('is read as one move, from the JSON object in it', () => {
    expect(parseMove('Sure. {"action":"click","target":3}')).toEqual({ action: 'click', target: 3 })
    expect(parseMove('{"action":"fill","target":0,"text":"What is 2 + 2?"}')).toEqual({ action: 'fill', target: 0, text: 'What is 2 + 2?' })
    expect(parseMove('{"action":"finding","note":"the total is wrong","severity":"high"}'))
      .toEqual({ action: 'finding', note: 'the total is wrong', severity: 'high' })
    expect(parseMove('{"action":"same","lead":4}')).toEqual({ action: 'same', lead: 4 })
    expect(parseMove('{"action":"same","lead":"L4"}')).toEqual({ action: 'same', lead: 4 })
    expect(parseMove('no idea')).toBeUndefined()
  })

  it('never leaves the app or signs out', () => {
    expect(parseMove('{"action":"goto","path":"/features"}')).toEqual({ action: 'goto', path: '/features' })
    expect(parseMove('{"action":"goto","path":"https://example.com"}')).toBeUndefined()
    expect(parseMove('{"action":"goto","path":"//example.com"}')).toBeUndefined()
    expect(parseMove('{"action":"goto","path":"/auth/logout"}')).toBeUndefined()
  })
})

// B26.19 — what the explorers have noted is shared, and one explorer writes at most three notes on a screen.
describe('the explorers\' notebook', () => {
  const book = () => new Notebook([] as Finding[], ['/keys', '/ledger', '/track'], (p) => (p.startsWith('/track/issues/') ? '/track/issues/:id' : p))

  it('keeps one lead for a thing however many explorers see it, and their notes to three a screen each', () => {
    const b = book()
    const keys = b.write(0, 'explorer', 'high', '/keys', 'The key list is stuck on Loading…', [])
    expect(keys).toMatchObject({ id: 1, by: [0] })
    expect(b.write(0, 'explorer', 'high', '/keys?tab=all', 'the key list is stuck on loading', [])).toBe('again')
    expect(b.same(3, 1, '/keys', [])).toMatchObject({ id: 1, by: [0, 3] })
    expect(b.write(5, 'explorer', 'low', '/keys', 'The key list is stuck on loading.', [])).toMatchObject({ id: 1, by: [0, 3, 5] })
    b.write(0, 'explorer', 'low', '/keys', 'a second thing', [])
    b.write(0, 'explorer', 'low', '/keys', 'a third thing', [])
    expect(b.write(0, 'explorer', 'low', '/keys', 'a fourth thing', [])).toBe('full')
    expect(b.notesBy(0, '/keys')).toBe(3)
    expect(b.on('/keys').map((l) => l.id)).toEqual([1, 2, 3])
    expect(b.findings.filter((f) => f.lead === 1).map((f) => f.explorer)).toEqual([0, 3, 5])
    expect(b.write(1, 'explorer', 'low', '/track/issues/42', 'x', [])).toMatchObject({ screen: '/track/issues/:id' })
  })

  it('sends an explorer to the screen seen least, and two sent at once to different ones', () => {
    const b = book()
    b.arrived('/keys')
    expect(b.unseen()).toEqual(['/ledger', '/track'])
    expect(b.leastSeen('/keys')).toBe('/ledger')
    expect(b.leastSeen('/keys')).toBe('/track')
    expect(b.unseen()).toEqual([])
  })
})

describe('cutText (B28.274)', () => {
  it('ends a long screen at a whole line and says how much is below', () => {
    const page = 'Terms\n\n\nA first paragraph.\nWho decides, on what evidence, whether the user is told, and whether they can contest it.'
    const cut = cutText(page, 40)
    expect(cut).toBe('Terms\nA first paragraph.\n[… the screen goes on below: 90 more characters not shown here]')
    expect(cutText('Short.\n\nScreen.', 60)).toBe('Short.\nScreen.')
  })
})
