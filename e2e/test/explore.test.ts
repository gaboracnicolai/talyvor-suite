import { describe, expect, it } from 'vitest'
import { parseMove } from '../src/explore.ts'

describe("an explorer's reply", () => {
  it('is read as one move, from the JSON object in it', () => {
    expect(parseMove('Sure. {"action":"click","target":3}')).toEqual({ action: 'click', target: 3 })
    expect(parseMove('{"action":"fill","target":0,"text":"What is 2 + 2?"}')).toEqual({ action: 'fill', target: 0, text: 'What is 2 + 2?' })
    expect(parseMove('{"action":"finding","note":"the total is wrong","severity":"high"}'))
      .toEqual({ action: 'finding', note: 'the total is wrong', severity: 'high' })
    expect(parseMove('no idea')).toBeUndefined()
  })

  it('never leaves the app or signs out', () => {
    expect(parseMove('{"action":"goto","path":"/features"}')).toEqual({ action: 'goto', path: '/features' })
    expect(parseMove('{"action":"goto","path":"https://example.com"}')).toBeUndefined()
    expect(parseMove('{"action":"goto","path":"//example.com"}')).toBeUndefined()
    expect(parseMove('{"action":"goto","path":"/auth/logout"}')).toBeUndefined()
  })
})
