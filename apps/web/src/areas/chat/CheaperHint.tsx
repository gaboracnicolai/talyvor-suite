import { useQuery } from '@tanstack/react-query'

import { Button } from '@talyvor/ui'

import { ApiError } from '../../lib/api'
import type { ChatMessage, ChatModel } from './chatApi'
import { answerUsd, catalogModelFor, formatAnswerCost } from './price'

// B28.364 — a cheaper model, offered under an answer when one would likely have done, with one click to ask again on it.
// The model is the one Lens recommends for questions of that size on that provider (GET /api/routing/recommendation,
// Lens's /routing/recommendation), offered only when the picker offers it and it prices the answer's own tokens lower
// than the model that wrote it. talyvor-lens B28.105 builds on this read.

/** What Lens recommends, as the BFF projects it. basis "none" is no recommendation. */
export interface RoutingRecommendation {
  model: string
  provider: string
  basis: string
  confidence?: string
}

/** Lens's input-size cohorts (internal/mining inputBucket): the range it files a question of this many input tokens under. */
export function inputRange(tokens: number): 'small' | 'medium' | 'large' | 'xlarge' {
  return tokens < 500 ? 'small' : tokens < 2000 ? 'medium' : tokens < 8000 ? 'large' : 'xlarge'
}

export async function fetchRecommendation(provider: string, range: string): Promise<RoutingRecommendation> {
  const q = new URLSearchParams({ provider, input_range: range })
  const res = await fetch(`/api/routing/recommendation?${q.toString()}`, { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError(res.status, '/api/routing/recommendation')
  return (await res.json()) as RoutingRecommendation
}

export interface CheaperOffer {
  model: ChatModel
  /** The answer's tokens at the offered model's list price, and at the price of the model that wrote it. */
  usd: number
  was: number
}

/**
 * The model to offer under `answer`, or none: Lens recommended one on a basis it states, the picker offers it, it is
 * not the model that wrote the answer, and the answer's own tokens cost less on it.
 */
export function cheaperOffer(
  answer: ChatMessage,
  rec: RoutingRecommendation | undefined,
  offered: readonly ChatModel[],
): CheaperOffer | undefined {
  const cost = answer.cost
  if (cost === undefined || rec === undefined || (rec.basis !== 'quality_per_dollar' && rec.basis !== 'quality')) return undefined
  const model = catalogModelFor(rec.model, offered.filter((m) => m.provider === rec.provider && m.auto === undefined))
  if (model === undefined || model.display_name === cost.model) return undefined
  const usd = answerUsd(cost, model)
  if (usd === null || usd >= cost.usd) return undefined
  return { model, usd, was: cost.usd }
}

export function CheaperHint({
  answer,
  asked,
  offered,
  usdPerLXC,
  onReask,
}: {
  answer: ChatMessage
  /** The model the question was asked of. Auto is never offered a cheaper one: it already chose the cheapest. */
  asked: ChatModel
  offered: readonly ChatModel[]
  usdPerLXC: number | undefined
  onReask: (model: ChatModel) => void
}) {
  const eligible =
    answer.cost !== undefined && answer.source === undefined && answer.auto === undefined && asked.auto === undefined && answer.incomplete !== 'blank'
  const range = inputRange(answer.cost?.input_tokens ?? 0)
  const rec = useQuery({
    queryKey: ['routing-recommendation', asked.provider, range],
    queryFn: () => fetchRecommendation(asked.provider, range),
    enabled: eligible,
    retry: false,
    staleTime: 5 * 60_000,
  })
  const offer = eligible ? cheaperOffer(answer, rec.data, offered) : undefined
  if (offer === undefined) return null
  return (
    <aside
      aria-label="A cheaper model"
      data-testid="cheaper-hint"
      className="mt-3 flex flex-col gap-2 rounded-card border border-rule bg-raised px-4 py-3 wide:flex-row wide:items-center wide:justify-between"
    >
      <p className="text-caption text-muted">
        {offer.model.display_name} would likely do for a question like this:{' '}
        <span className="font-figure text-ink">{formatAnswerCost(offer.usd, usdPerLXC)}</span> instead of{' '}
        <span className="font-figure">{formatAnswerCost(offer.was, usdPerLXC)}</span>.
      </p>
      <Button type="button" className="h-12 w-full shrink-0 wide:h-8 wide:w-auto" onClick={() => onReask(offer.model)}>
        Re-ask with {offer.model.display_name}
      </Button>
    </aside>
  )
}
