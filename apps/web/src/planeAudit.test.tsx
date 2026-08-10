import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AA_BODY, NavItem, ROLES_ON_PLANE, TEXT_PLANES, TEXT_ROLES, ratio, worstRatio } from '@talyvor/ui'
import {
  DEFAULT_PLANE,
  DEFAULT_ROLE,
  auditedPairs,
  judge,
  planeOf,
  planeOffendersIn,
  roleOf,
} from './planeAudit'

/**
 * THE PLANE AUDIT, BOTH DIRECTIONS.
 *
 * The running audit is silent when everything is correct, which is the state a dead observer is
 * indistinguishable from. These are the direct readings: the predicate on real token values, the
 * ancestor walk on real markup, and the census pinned against the classification.
 */

describe('the instrument, before it measures anything', () => {
  it('the four measured numbers on the fourth plane are what the classification rests on', () => {
    // Not a second copy of tokens.ts — these are read FROM it. If a hex moves, this moves with it
    // and the classification below is re-argued rather than quietly wrong.
    expect(ratio('light', 'ink', 'accent-tint')).toBeGreaterThanOrEqual(AA_BODY)
    expect(ratio('dark', 'ink', 'accent-tint')).toBeGreaterThanOrEqual(AA_BODY)
    expect(ratio('light', 'muted', 'accent-tint')).toBeGreaterThanOrEqual(AA_BODY)
    expect(ratio('dark', 'muted', 'accent-tint')).toBeGreaterThanOrEqual(AA_BODY)
    // The refusals. These are FACTS, and if either ever passes, ROLES_ON_PLANE must be widened —
    // contrast.test.ts fails on exactly that, from the other side.
    expect(ratio('light', 'faint', 'accent-tint')).toBeLessThan(AA_BODY)
    expect(ratio('dark', 'faint', 'accent-tint')).toBeLessThan(AA_BODY)
    expect(ratio('light', 'accent', 'accent-tint')).toBeLessThan(AA_BODY)
  })

  it('the same pairs clear the floor on the three planes the matrix already scored', () => {
    for (const plane of ['canvas', 'surface', 'sidebar'] as const) {
      for (const role of ['ink', 'muted', 'faint', 'accent'] as const) {
        expect(worstRatio(role, plane), `${role} on ${plane}`).toBeGreaterThanOrEqual(AA_BODY)
      }
    }
  })

  it('the body defaults are the tokens theme.css actually sets on body', () => {
    expect(DEFAULT_ROLE).toBe('ink')
    expect(DEFAULT_PLANE).toBe('canvas')
  })
})

describe('judge — the predicate, both directions', () => {
  it('passes a permitted pair that clears the floor', () => {
    expect(judge('ink', 'accent-tint')).toBeNull()
    expect(judge('muted', 'surface')).toBeNull()
  })
  it('refuses a role the plane does not permit, and reports both scores', () => {
    const v = judge('faint', 'accent-tint')
    expect(v?.reason).toBe('refused')
    expect(v?.light).toBeLessThan(AA_BODY)
    expect(v?.dark).toBeLessThan(AA_BODY)
  })
  it('refuses the light-only failure too — a pair ships in both themes', () => {
    const v = judge('accent', 'accent-tint')
    expect(v?.reason).toBe('refused')
    expect(v?.light).toBeLessThan(AA_BODY)
    expect(v?.dark).toBeGreaterThan(AA_BODY) // dark is fine; the pair still fails
  })
  it('reports a plane nobody classified rather than passing it', () => {
    const v = judge('ink', 'rule')
    expect(v?.reason).toBe('unclassified')
    expect(v?.light).toBeNull()
  })
})

describe('the ancestor walk — the half a source rule cannot do', () => {
  it('finds the plane on an ancestor, not on the element that carries the text', () => {
    const { container } = render(
      <div className="bg-accent-tint">
        <span>
          <em className="text-ink">selected</em>
        </span>
      </div>,
    )
    const em = container.querySelector('em')!
    expect(planeOf(em).token).toBe('accent-tint')
    expect(roleOf(em).token).toBe('ink')
    expect(planeOffendersIn(container)).toEqual([])
  })

  it('the NEAREST plane wins — a card on the canvas is scored against the card', () => {
    const { container } = render(
      <div className="bg-canvas">
        <div className="bg-surface">
          <p className="text-faint">caption</p>
        </div>
      </div>,
    )
    expect(planeOf(container.querySelector('p')!).token).toBe('surface')
  })

  it('a variant plane is a STATE and is not the resting plane', () => {
    const { container } = render(
      <div className="bg-surface hover:bg-accent-tint">
        <p className="text-faint">caption</p>
      </div>,
    )
    // jsdom never enters :hover. The resting answer is `surface`, where faint is legal.
    expect(planeOf(container.querySelector('p')!).token).toBe('surface')
    expect(planeOffendersIn(container)).toEqual([])
  })

  it('untokened text is ink on canvas, not unknown — and it is scored, not skipped', () => {
    const { container } = render(<p>plain</p>)
    const p = container.querySelector('p')!
    expect(roleOf(p).token).toBe('ink')
    expect(planeOf(p).token).toBe('canvas')
  })

  it('a size utility is not a colour — text-body must not be read as a role', () => {
    const { container } = render(<p className="text-body">sized</p>)
    expect(roleOf(container.querySelector('p')!).token).toBe('ink')
  })
})

/**
 * THE DEFECT THIS AUDIT WAS WRITTEN FOR, rendered through the component's PUBLIC API.
 *
 * `NavItem` takes an `icon`. No surface passes one today, so the pair never reached a DOM and five
 * audits, a reach census and a full palette guard all stayed green over it. It is not a
 * hypothetical: the prop is exported, typed and documented, and the row it renders in is
 * `bg-accent-tint` whenever it is selected or hovered.
 */
describe('NavItem renders its icon on the plane the row is actually on', () => {
  it('a selected row with an icon puts no refused role on the tint', () => {
    const { container } = render(
      <NavItem active icon={<span>+</span>}>
        Ledger
      </NavItem>,
    )
    expect(screen.getByText('Ledger')).toBeInTheDocument()
    expect(planeOffendersIn(container)).toEqual([])
  })

  it('an unselected row keeps the dimmer step it has on the canvas', () => {
    const { container } = render(<NavItem icon={<span>+</span>}>Keys</NavItem>)
    expect(planeOffendersIn(container)).toEqual([])
  })

  /**
   * ⚠ THE HOVER PLANE, PINNED BY NAME BECAUSE NO DOM CAN REACH IT. jsdom never applies `:hover`,
   * so the audit above cannot see that an unselected row's plane BECOMES `accent-tint` under the
   * pointer. That is `planeAudit.ts` limit (a). The class list is the evidence available, so it is
   * asserted here with the number that makes it matter.
   */
  it('the hover plane is accent-tint, so the icon token must clear AA body on it', () => {
    const { container } = render(<NavItem icon={<span>+</span>}>Keys</NavItem>)
    const button = container.querySelector('button')!
    expect(button.className).toContain('hover:bg-accent-tint')

    const icon = container.querySelector('[aria-hidden="true"]')!
    const role = [...icon.classList].find((c) => c.startsWith('text-'))!.slice('text-'.length)
    expect(
      worstRatio(role as 'muted', 'accent-tint'),
      `NavItem's icon is \`${role}\`, which the row's hover plane scores at ` +
        `${worstRatio(role as 'muted', 'accent-tint').toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_BODY)
    // and it must still clear the plane it rests on
    expect(worstRatio(role as 'muted', 'sidebar')).toBeGreaterThanOrEqual(AA_BODY)
  })
})

/**
 * THE CENSUS PIN — the direction planes.ts cannot check, because it has no DOM.
 *
 * ⚠ IT RUNS LAST IN THE FILE AND STILL ONLY SEES THIS FILE. `census` is per-worker, so this is a
 * pin on the pairs THIS file rendered, not a product-wide census — stated rather than implied,
 * because a reader could otherwise take it for a complete answer. The product-wide direction is
 * the running audit itself: any pair on an unclassified plane, anywhere in the suite, is an
 * offender in the file that rendered it.
 */
describe('the classification is a closed set', () => {
  it('every plane this file rendered text on is classified', () => {
    const planes = [...new Set(auditedPairs().map((p) => p.split('|')[1]))]
    const unclassified = planes.filter((p) => !(TEXT_PLANES as string[]).includes(p))
    expect(unclassified, `plane(s) nobody classified: ${unclassified.join(', ')}`).toEqual([])
    expect(planes.length).toBeGreaterThan(1) // it read something, and more than the default
  })

  it('every role in the classification is a role, and every plane permits at least one', () => {
    for (const [plane, roles] of Object.entries(ROLES_ON_PLANE)) {
      expect(roles.length, `${plane} permits nothing`).toBeGreaterThan(0)
      for (const r of roles) expect(TEXT_ROLES).toContain(r)
    }
  })
})
