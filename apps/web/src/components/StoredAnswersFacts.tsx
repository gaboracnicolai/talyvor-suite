// StoredAnswersFacts.tsx — B21.4: the four things every page that talks about sharing or storage
// says, in the same words, from this one place: the sharing notice (through SharingFacts), Setup,
// Features, Privacy and Terms. Decided by Nicolai on 28 Sep 2026 (B21.3): switching sharing off
// stops NEW sharing only, and a stored answer is kept until it is deleted.
//
// scripts/build-release.sh fails the build when a sentence these replaced is still in the bundle,
// or when these are not (apps/web/scripts/check-retired-sentences.mjs).

import { inlineLink } from '@talyvor/ui'

export const SHARING_OFF_FACT =
  'Switching sharing off stops new answers being shared. Answers you shared before stay available to others, and keep earning, until you delete them in Features.'

export const KEPT_UNTIL_DELETED_FACT = 'Stored answers are kept until you delete them; they do not expire.'

export const QUESTION_STORED_FACT =
  'The latest question is stored with each reusable answer, private and shared, so that two questions can be compared; OpenAI computes each question’s embedding, and Anthropic checks pairs of questions.'

export const LOGGING_NONE_FACT = 'Under logging “none”, nothing of a question or answer is stored.'

// B27.22 — how shared answers work, in Nicolai's words, for someone who has not signed up yet: under
// the sign-up form and on Terms and Privacy. Sharing is on by default; the link lands on the switch
// itself, Features' Answer sharing row.
export const SHARED_ANSWERS_FACT = 'Answers you get may be reused to answer the same question for other companies.'
export const SHARING_SWITCH_HREF = '/features#answer-sharing'

export function SharedAnswersFact({ className = 'text-body text-muted' }: { className?: string }) {
  return (
    <p className={className} data-testid="shared-answers-fact">
      {SHARED_ANSWERS_FACT} You can switch sharing off at any time in{' '}
      <a href={SHARING_SWITCH_HREF} className={inlineLink}>
        Features
      </a>
      .
    </p>
  )
}

export const STORED_ANSWERS_FACTS = [SHARING_OFF_FACT, KEPT_UNTIL_DELETED_FACT, QUESTION_STORED_FACT, LOGGING_NONE_FACT]

export function StoredAnswersFacts({ className = 'text-body text-muted' }: { className?: string }) {
  return (
    <ul className={`flex list-disc flex-col gap-1 pl-5 ${className}`} data-testid="stored-answers-facts">
      {STORED_ANSWERS_FACTS.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  )
}
