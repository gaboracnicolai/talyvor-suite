import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ModelTier, modelTier } from './ModelTier'

/**
 * NEVER GUESS A TIER — the rule ModelTier.tsx was rewritten to hold, which nothing enforced.
 *
 * That file's comment describes a real, shipped defect and its repair: the lookup used to be
 * `fixtureModelTiers[model] ?? 'cheap'`, so EVERY model outside a two-entry map — including the
 * expensive ones — was drawn beside a live ledger row with the cool "cheap" hue and an
 * aria-label saying "cheap". It "asserted a specific, checkable, wrong fact about real data and
 * looked exactly like the rest of the row".
 *
 * ⚠ MEASURED 2026-08-10 at `025cd08`, AND THIS IS WHY THIS FILE EXISTS: putting the `?? 'cheap'`
 * back left the WHOLE SUITE GREEN — 1028 apps/web tests and 350 packages/ui tests, all passing
 * with the defect restored. No test in apps/web named `ModelTier` or `modelTier` at all. The
 * repair was real and it was protected by nothing.
 *
 * ⚠ WHY NO EXISTING TEST COULD HAVE SEEN IT — the fixtures are uniform. Every model string in
 * every lens fixture is one of `claude-haiku-4-5`, `claude-sonnet-5`, `gpt-4o`, `gpt-4o-mini`,
 * and the only dot assertion in the suite (`Spend.test.tsx`, "both fixture models ARE
 * categorised, so both draw a dot") counts TWO dots over rows whose models are both in the map.
 * A default cannot be distinguished from a hit when every subject is a hit. The cases below are
 * therefore built on models the map does NOT hold, which is the only shape that can tell.
 *
 * ⚠ AND THE EXISTING SUITE IS BLIND IN EXACTLY ONE DIRECTION — measured, not assumed, and I
 * predicted it wrongly first. Making the lookup answer NOTHING for every model DOES red
 * `Spend.test.tsx`: its count falls 2 → 0. Making it answer "cheap" for EVERY model does not,
 * because the count it asserts is already satisfied. A dot going MISSING is visible to the
 * product's tests; a dot APPEARING where no tier was recorded is not — and the second is the
 * direction that ships a wrong claim about money. A count over an all-hit fixture is a
 * one-directional instrument, which is the general shape worth remembering here.
 *
 * ⚠ THE UNCATEGORISED MODELS HERE ARE REAL AND EXPENSIVE, not invented strings. `claude-opus-5`
 * and `claude-fable-5` are both seeded in talyvor-lens's own price catalog
 * (`internal/catalog/seed.go`) at $5/$25 and $10/$50 per 1M — against `claude-haiku-4-5` at
 * $1/$5. Those are exactly the rows the old default painted "cheap".
 */

/**
 * ⚠ HARDCODED, NOT DERIVED FROM `TIERS`. A guard that reads the map it is checking agrees with
 * every value the map could hold. These two literals are the curated set as of `025cd08`;
 * adding a third model must fail here and be decided, not absorbed.
 */
const CATEGORISED: [string, string][] = [
  ['claude-haiku-4-5', 'cheap'],
  ['claude-sonnet-5', 'capable'],
]

/** Priced by Lens, deliberately NOT categorised here. The old default called all of these cheap. */
const UNCATEGORISED = ['claude-opus-5', 'claude-fable-5', 'claude-opus-4-6', 'gpt-4o', 'gpt-4o-mini']

describe('a model tier is never guessed', () => {
  it('returns no tier for a model that has not been categorised', () => {
    for (const model of UNCATEGORISED) {
      expect(modelTier(model), `${model} must have NO tier, not a default`).toBeUndefined()
    }
  })

  // ⚠ THE INVERSE, AND IT IS NOT DECORATION. Without it, a lookup that returned undefined for
  // EVERYTHING would satisfy every case above — the absence assertions cannot tell "never
  // guesses" from "never answers", and the second breaks the feature silently.
  it('still returns the curated tier for a model that has been categorised', () => {
    for (const [model, tier] of CATEGORISED) expect(modelTier(model)).toBe(tier)
  })

  it('draws nothing at all for an uncategorised model — no dot, no label', () => {
    for (const model of UNCATEGORISED) {
      const { container, unmount } = render(<ModelTier model={model} />)
      expect(
        container.querySelectorAll('[role="img"]'),
        `${model} drew a tier dot it has no tier for`,
      ).toHaveLength(0)
      expect(container.textContent).toBe('')
      unmount()
    }
  })

  // The accessible NAME is the point, not the pixel: the shipped defect's real damage was a
  // screen reader announcing "cheap" beside an expensive model's spend.
  it('draws the dot for a categorised model and announces its own tier', () => {
    for (const [model, tier] of CATEGORISED) {
      const { unmount } = render(<ModelTier model={model} />)
      expect(screen.getByRole('img', { name: tier })).toBeInTheDocument()
      unmount()
    }
  })

  // ⚠ A MIXED SET IS THE SHAPE THE PRODUCT ACTUALLY RENDERS — Spend and Overview map a
  // by-model breakdown straight onto <ModelTier>, so a real workspace using both Haiku and Opus
  // draws this. A count taken over an all-categorised fixture cannot fail; this one can.
  it('over a mixed set, exactly the categorised models draw a dot', () => {
    const models = [...CATEGORISED.map(([m]) => m), ...UNCATEGORISED]
    const { container } = render(
      <>
        {models.map((m) => (
          <ModelTier key={m} model={m} />
        ))}
      </>,
    )
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(CATEGORISED.length)
    expect([...container.querySelectorAll('[role="img"]')].map((n) => n.getAttribute('aria-label'))).toEqual(
      CATEGORISED.map(([, tier]) => tier),
    )
  })
})
