import { TierDot, type Tier } from '@talyvor/ui'

// The routing-ramp dot beside a model name — and the one fixture claim in this app that rode
// on LIVE rows without any marker.
//
// It used to be `fixtureModelTiers[model] ?? 'cheap'`. The map holds two models, so EVERY
// other model that appeared in a real ledger row — including expensive ones — was drawn with
// the cool "cheap" hue and an aria-label saying "cheap". A fixture defaulting quietly is
// worse than a fixture showing: a visible sample number invites doubt, whereas this asserted
// a specific, checkable, wrong fact about real data and looked exactly like the rest of the
// row. Nothing marked it, and no test could catch it, because the default was indistinguishable
// from a hit.
//
// So the lookup now returns undefined for an unknown model and NOTHING is drawn. A missing
// dot reads as "no category recorded", which is true. Guessing reads as a measurement.
//
// This is a CURATED list, not a fixture standing in for a route. The honest scope is "models we
// have deliberately categorised, and no others".
//
// ⚠ THE PREMISE THIS FILE USED TO CARRY IS STALE, AND THE CORRECTION IS NOT A DECISION.
// It said "Lens exposes no per-model tier read, so there is nothing to be awaiting. The day it
// does, this file becomes a fetch." Measured 2026-08-10 against talyvor-lens: `GET
// /v1/api/catalog` exists (`internal/api/server.go`, "returns the full model catalog for the
// dashboard") and serves `catalog.All()` — every seeded model with InputPer1M / OutputPer1M.
// There is still no TIER field, so the letter of the sentence holds and the spirit does not:
// the raw material is served, and it is served TO THIS DASHBOARD.
//
// ⚠ WHAT IS NOT DECIDED HERE, DELIBERATELY. Turning price into 'cheap' vs 'capable' means
// choosing a boundary, and a threshold on a money surface is not a session's to pick. For scale:
// the catalog prices claude-haiku-4-5 at $1/$5 per 1M and claude-opus-5 at $5/$25 — so today
// EVERY Opus, the priciest thing a workspace can run, draws no dot at all. That is honest and
// it is also uninformative, and which of the two matters more is the open question.
// ModelTier.test.tsx pins the curated set, so a third model cannot be absorbed without it.
const TIERS: Record<string, Tier> = {
  'claude-haiku-4-5': 'cheap',
  'claude-sonnet-5': 'capable',
}

/** The tier for a model, or undefined when we have not categorised it. Never a guess. */
export function modelTier(model: string): Tier | undefined {
  return TIERS[model]
}

/** The dot for a model — absent entirely when the model's tier is unknown. */
export function ModelTier({ model }: { model: string }) {
  const tier = modelTier(model)
  return tier ? <TierDot tier={tier} /> : null
}
