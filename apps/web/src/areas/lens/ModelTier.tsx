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
// This is a CURATED list, not a fixture standing in for a route: Lens exposes no per-model
// tier read, so there is nothing to be awaiting. The day it does, this file becomes a fetch.
// Until then the honest scope is "models we have deliberately categorised, and no others".
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
