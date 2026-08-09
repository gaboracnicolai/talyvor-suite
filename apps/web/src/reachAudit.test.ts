import { describe, expect, it } from 'vitest'

import { createReachRecord, isComponentExport, walkFiber } from './reachAudit'

/**
 * THE PREDICATE AND THE WALK, TESTED DIRECTLY — because the floors in
 * scripts/check-audit-reach.mjs cannot see a blinded one.
 *
 * That is the same asymmetry focusAudit's floor was corrected for: a floor computed
 * independently of a predicate is exactly the thing that cannot notice the predicate going
 * wrong. Here, `isComponentExport` returning TRUE for everything makes the registry larger and
 * the floors — which name four components literally — stay green while the checker starts
 * reporting exported constants as unaudited surfaces. Returning FALSE for everything empties the
 * registry, which the MUST_REGISTER floor does catch. One direction each; neither alone.
 *
 * ⚠ EVERY TEST HERE BUILDS ITS OWN RECORD. The module singleton is the one the shard is written
 * from, so registering a fixture into it would put that fixture in the file the checker reads.
 */
describe('isComponentExport — a component, not merely an export', () => {
  it('accepts a capitalised function', () => {
    expect(isComponentExport('Button', function Button() {})).toBe(true)
  })

  it('rejects a lowercase function — exported helpers are functions too', () => {
    expect(isComponentExport('formatUSD', () => '$1')).toBe(false)
    expect(isComponentExport('caseSafeRuns', () => [])).toBe(false)
  })

  it('accepts a forwardRef/memo object by its $$typeof symbol', () => {
    expect(isComponentExport('SelectTrigger', { $$typeof: Symbol.for('react.forward_ref') })).toBe(
      true,
    )
  })

  it('rejects the plain objects modules export beside their components', () => {
    // Each of these was counted as an unrendered component by an earlier draft of the registry.
    expect(isComponentExport('queryClient', { mount: () => {} })).toBe(false)
    expect(isComponentExport('DEFAULT_VIEW', { sort: 'age' })).toBe(false)
    expect(isComponentExport('tokens', { ink: '#fff' })).toBe(false)
  })

  it('rejects primitives and null', () => {
    expect(isComponentExport('UNSTAMPED', 'unstamped')).toBe(false)
    expect(isComponentExport('LIMIT', 10)).toBe(false)
    expect(isComponentExport('Nothing', null)).toBe(false)
  })
})

describe('the record — registration, and what counts as reached', () => {
  it('registers only components, under <where>#<name>', () => {
    const r = createReachRecord()
    r.registerModule('packages/ui', {
      Button: function Button() {},
      formatUSD: () => '$1',
      tokens: { ink: '#fff' },
    })
    expect(r.registered()).toEqual(['packages/ui#Button'])
  })

  it('names a component where it is defined, not where it is re-exported', () => {
    const r = createReachRecord()
    const Button = function Button() {}
    r.registerModule('packages/ui/src/components/Button.tsx', { Button })
    r.registerModule('packages/ui', { Button })
    expect(r.registered()).toEqual(['packages/ui/src/components/Button.tsx#Button'])
  })

  it('reports a component as reached only once, and only if it was registered', () => {
    const r = createReachRecord()
    const Button = function Button() {}
    const Stranger = function Stranger() {}
    r.registerModule('packages/ui', { Button })

    expect(r.note(Button)).toBe(true)
    expect(r.note(Button)).toBe(false)
    expect(r.note(Stranger)).toBe(false)
    expect(r.committed()).toEqual(['packages/ui#Button'])
  })

  it('is keyed by identity, so two components sharing a name stay distinct', () => {
    // ⚠ THE REASON THIS FILE EXISTS IN THIS SHAPE. An earlier recorder keyed on `fiber.type.name`
    // and recorded `Button2`: the transform renames a component whose name collides in scope, so
    // a name-keyed table reports a rendered component as never rendered.
    const r = createReachRecord()
    const a = function Button() {}
    const b = function Button() {}
    r.registerModule('packages/ui', { Button: a })
    r.registerModule('apps/web/src/areas/docs/components.tsx', { Button: b })

    expect(r.registered()).toEqual([
      'apps/web/src/areas/docs/components.tsx#Button',
      'packages/ui#Button',
    ])
    r.note(a)
    expect(r.committed()).toEqual(['packages/ui#Button'])
  })
})

describe('walkFiber — every node, however deep', () => {
  it('visits a child/sibling tree', () => {
    const tree = {
      type: 'root',
      child: { type: 'a', sibling: { type: 'b', child: { type: 'c' } } },
    }
    const seen: unknown[] = []
    walkFiber(tree, (t) => seen.push(t))
    expect([...seen].sort()).toEqual(['a', 'b', 'c', 'root'])
  })

  it('tolerates a null root rather than throwing', () => {
    const seen: unknown[] = []
    expect(() => walkFiber(null, (t) => seen.push(t))).not.toThrow()
    expect(seen).toEqual([])
  })

  it('does not overflow on a tree deeper than the call stack', () => {
    // A recursive walk throws here; the product's trees are shallower than this, but an
    // instrument that can throw on a deep surface reports that surface as unreached.
    let deep: Record<string, unknown> = { type: 'leaf' }
    for (let i = 0; i < 50_000; i += 1) deep = { type: 'node', child: deep }
    let count = 0
    walkFiber(deep, () => {
      count += 1
    })
    expect(count).toBe(50_001)
  })
})
