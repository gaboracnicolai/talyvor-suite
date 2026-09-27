import { focusRing } from './focus'

/**
 * THE INLINE LINK — the one shape every underlined link in prose takes, in the console and on the
 * front page alike (B18.26). Where it sits decides its colour and size; this decides the rest: the
 * underline and its offset, a 200ms colour move to ink on hover (the way the front page's stepper
 * moves), and the accent focus ring every other control carries.
 *
 * Before it there was no rule and no component, so each new screen copied its neighbour and the
 * product shipped five treatments at once — no hover, or a hover to ink, to muted, to accent, or of
 * the underline alone. apps/web/src/inlineLinkTreatment.test.ts holds every underlined link to this.
 */
export const inlineLink = `underline underline-offset-2 transition-colors duration-200 hover:text-ink ${focusRing}`
