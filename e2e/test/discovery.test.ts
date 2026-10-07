import { describe, expect, it } from 'vitest'
import { type Collection, type Hit, collectionFaults, featuredFaults, searchFaults, trendingFaults } from '../src/discovery.ts'

const mine = { cheap: 'lst_cheap', dear: 'lst_dear', other: 'lst_other' }
const hit = (id: string, capabilities: string[], price: number | null): Hit => ({ id, title: id, capabilities, price_per_use_usd_micros: price, distinct_buyers_7d: 0, trending_score: 0 })
const cheap = hit('lst_cheap', ['extract'], 40_000)
const col = (id: string, featured: boolean): Collection => ({ id, title: id, public: true, featured, listing_count: 2 })

describe('B32.90 market-discovery', () => {
  it('passes the $0.04 extract listing alone, and fails on the $0.06 one, the summarize one, or a hit outside the filter', () => {
    expect(searchFaults([cheap, hit('lst_free', ['extract', 'summarize'], 0)], mine)).toEqual([])
    expect(searchFaults([cheap, hit('lst_dear', ['extract'], 60_000)], mine)).toEqual(['the $0.06 extract listing lst_dear is found, above max_price_per_use 50000'])
    expect(searchFaults([cheap, hit('lst_other', ['summarize'], 10_000)], mine)).toEqual(['the summarize listing lst_other is found for capability=extract'])
    expect(searchFaults([hit('lst_x', ['summarize'], 70_000)], mine)).toEqual(['the $0.04 extract listing lst_cheap is not found',
      'lst_x "lst_x" is found for capability=extract and declares ["summarize"]', 'lst_x "lst_x" is found under max_price_per_use 50000 and is billed 70000 µUSD a use'])
  })

  it('holds every trending hit to its distinct buyers and score', () => {
    expect(trendingFaults([cheap])).toEqual([])
    expect(trendingFaults([])).toEqual(['sort=trending found no listing'])
    expect(trendingFaults([{ ...cheap, trending_score: undefined }])).toEqual(['lst_cheap carries distinct_buyers_7d 0 and trending_score undefined'])
  })

  it('reads the collection as exactly its listings in its order, and fails when the featured one is not first', () => {
    expect(collectionFaults({ ...col('c', false), listings: [{ id: 'b' }, { id: 'a' }] }, ['b', 'a'])).toEqual([])
    expect(collectionFaults({ ...col('c', false), listings: [{ id: 'a' }, { id: 'b' }] }, ['b', 'a'])).toEqual(['the collection lists ["a","b"], not ["b","a"] in that order'])
    expect(featuredFaults([col('mine', true), col('old', true)], 'mine')).toEqual([])
    expect(featuredFaults([col('old', true), col('mine', true)], 'mine')).toEqual(['the featured collection mine is listed at 2, after old "old"'])
  })
})
