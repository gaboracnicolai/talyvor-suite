// Area-local bits. Nothing here is shared — if one of these earns a second area,
// promotion into packages/ui is a separate PR (see the ownership contract).
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@talyvor/ui'

/** Neutral chip: hairline border, muted caption, NO dot and NO hue — for states that
 *  are facts, not lifecycle (fixture, private, locked, doc_status). Distinct from
 *  packages/ui Pill, whose statuses are the semantic colour set. */
export function Chip({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex h-5 shrink-0 items-center rounded-pill border border-rule bg-canvas px-2 font-figure text-eyebrow uppercase text-muted"
    >
      {children}
    </span>
  )
}

// FixtureChip and FixtureNote are GONE. Their own doctrine required it: the shared
// FixtureNotice carries a "REMOVAL CONDITION — the day no screen renders one, delete it; an
// unproducible marker is dead surface". No Docs screen renders fixture data any more, and the
// note's text ("the BFF serves only /api/docs/spaces today") had become false besides.

/**
 * spaceCrumbLabel — what to call a space in a breadcrumb when its name may not be known.
 *
 * ⚠ THE FALLBACK WAS THE ID, AND AN ID IS NOT A DESTINATION. Both screens name the space by finding
 * it in the spaces LIST, so a reader who arrives directly at a page URL — a reload, a shared link, a
 * new tab — sees the crumb before that list resolves, and a reader whose spaces read FAILS never
 * sees a name at all. The crumb then read `8f3c…` : a control that is pointing somewhere useful and
 * saying nothing about where.
 *
 * So an unknown name degrades to what the destination IS rather than to the id of the thing it
 * belongs to. Shared by both callers so the two cannot drift into describing the same crumb
 * differently.
 */
export function spaceCrumbLabel(name: string | undefined): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : 'Pages'
}

/**
 * BackButton — the explicit way out, beside the breadcrumb rather than instead of it.
 *
 * ⚠ WHY A BUTTON WHEN THE CRUMB LINKS ALREADY WORK. They do work — #73 proved they navigate and
 * arrive, and gave them a resting underline that IS in the shipped CSS (verified against the built
 * bundle, not the config). It did not help: the reporter deployed it, hard-refreshed, and still read
 * the screen as having no way back — three sessions of deliberately looking. A control that cannot
 * be found by someone actively hunting for it is not an affordance, whatever its computed style. A
 * breadcrumb is navigation for people who already know breadcrumbs are navigation.
 *
 * ⚠ `default`, NOT `primary`, AND THAT IS THE VARIANT THE BRIEF ASKED FOR. The requirement was a
 * visible boundary; `primary` is `border-transparent` and has none — it reads as a filled block —
 * while `default` is `bg-surface text-ink border-rule`, an actually bordered control. It also keeps
 * the page's hierarchy honest: Create page and Save are what you came to do, and going back should
 * not out-shout them.
 *
 * ⚠ A REAL <button>, not a Link wearing button styling. That distinction is the whole point here:
 * the crumb beside it is already the link, and already carries the link semantics worth having
 * (cmd-click, open in a new tab). What was missing was something unmistakably a control, so this is
 * one — and the two are complementary rather than a duplicate.
 *
 * The label is exactly "← Back" and carries nothing else. A destination in the label ("← Back to
 * Engineering") re-introduces the thing that failed: it makes the control's meaning depend on
 * reading it, and it goes stale against the space name the crumb already shows.
 */
export function BackButton({ to }: { to: string }) {
  const navigate = useNavigate()
  return (
    <Button variant="default" onClick={() => navigate(to)}>
      ← Back
    </Button>
  )
}

/** Breadcrumb trail: caption links, current leaf in ink. */
export function Crumbs({ trail }: { trail: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-caption font-normal text-muted">
      {trail.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 ? <span aria-hidden="true">›</span> : null}
          {c.to ? (
            // ⚠ UNDERLINED AT REST, not on hover. This was the only Link in the app without a
            // resting affordance: it rendered as muted text indistinguishable from the prose beside
            // it, so the way out of a page was invisible to anyone who had not already guessed it
            // was there. Worse, `hover:underline` is the one affordance a touch device cannot
            // produce at all — on a phone the control had no visible state ever. It was reported as
            // "there is no way back", and the links were working the whole time.
            <Link to={c.to} className="underline underline-offset-2 hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className="text-ink">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
