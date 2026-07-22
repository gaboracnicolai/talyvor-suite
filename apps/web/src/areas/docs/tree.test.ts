import { describe, expect, it } from 'vitest'
import type { DocsPage } from './api'
import { buildTree, countNodes } from './tree'

const page = (id: string, parent: string | null, position: number, created = '2026-06-01T00:00:00Z'): DocsPage => ({
  id,
  space_id: 's',
  workspace_id: 'w',
  parent_id: parent,
  title: id,
  slug: id,
  content: '{}',
  content_text: '',
  icon: '',
  cover_url: '',
  position,
  depth: 0,
  is_template: false,
  created_by: 'm',
  updated_by: 'm',
  ai_cost_usd: 0,
  view_count: 0,
  stale_after_days: 0,
  locked: false,
  created_at: created,
  updated_at: created,
})

describe('buildTree', () => {
  it('nests children under parents and orders siblings by position', () => {
    const roots = buildTree([page('b', null, 2), page('a', null, 1), page('a2', 'a', 2), page('a1', 'a', 1)])
    expect(roots.map((r) => r.page.id)).toEqual(['a', 'b'])
    expect(roots[0].children.map((c) => c.page.id)).toEqual(['a1', 'a2'])
    expect(countNodes(roots)).toBe(4)
  })

  it('breaks position ties by created_at, then id', () => {
    const roots = buildTree([
      page('late', null, 1, '2026-06-02T00:00:00Z'),
      page('early', null, 1, '2026-06-01T00:00:00Z'),
    ])
    expect(roots.map((r) => r.page.id)).toEqual(['early', 'late'])
  })

  it('promotes a page whose parent is missing to the root instead of dropping it', () => {
    const roots = buildTree([page('root', null, 1), page('stray', 'gone', 1)])
    expect(roots.map((r) => r.page.id)).toEqual(['root', 'stray'])
    expect(countNodes(roots)).toBe(2)
  })

  it('a self-parenting row cannot orphan itself into a cycle', () => {
    const roots = buildTree([page('selfie', 'selfie', 1)])
    expect(roots.map((r) => r.page.id)).toEqual(['selfie'])
    expect(roots[0].children).toEqual([])
  })
})
