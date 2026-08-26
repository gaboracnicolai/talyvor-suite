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

/**
 * PriceNote — what a metered control costs, said WHERE THE READER MEETS IT, before the click.
 *
 * ── WHY IT EXISTS, MEASURED RATHER THAN REVIEWED ────────────────────────────
 *
 * All five metered Docs surfaces carried a cost sentence and every one of them rendered it in the
 * ANSWERED branch only. MEASURED at main `252efbfa`, each card mounted and its whole body text
 * read before any click — none of the five contained the word "metered":
 *
 *   PageSummary          "Summarises the page as saved, by Docs through Lens."
 *   PageTranslation      "Name a language first — …would translate this page into English and
 *                         still charge for it."          ← the only one that names a charge at all
 *   PageTitleSuggestion  "Reads the page as saved, by Docs through Lens. It does not rename …"
 *   AskAI                "Answered from the pages you can open, by Docs through Lens."
 *   SearchDocs           "Across the pages you can open, in this workspace."
 *
 * "by Docs through Lens" is a routing statement, not a price. So the reader learned the call was
 * metered strictly AFTER buying it.
 *
 * ⚠ THE RULE WAS ALREADY WRITTEN DOWN, ONE DIRECTORY OVER, AND THIS AREA DID NOT HAVE IT.
 * areas/track/meteredCostCensus.test.tsx asserts its four surfaces at MOUNT and says why:
 * "THE STATE ASSERTED IS THE ONE WHERE THE READER MEETS THE CONTROL — mount, before the spend …
 * A cost sentence a reader can only reach AFTER paying is a receipt, not a price." Track obeys it
 * on all four. Docs obeyed it on none, and its own census could not see that: every assertion in
 * areas/docs/meteredCostCensus.test.tsx calls `drive()` and awaits the answer before it looks.
 *
 * ── WHY ONE COMPONENT AND NOT FIVE SENTENCES ────────────────────────────────
 *
 * The receipt sentences were hand-written per card and the payer clause drifted — #240 measured a
 * flipped payer on SearchDocs going green across 1617 tests. Five more hand-written sentences is
 * five more chances at the same defect, so the PRICE is one rule with a payer switch and the
 * call sites choose only the verb.
 *
 * ⚠ THE LEAD IS CHILDREN, NOT A STRING PROP, DELIBERATELY. Passed as `verb="Summarising this
 * page"` it is a quoted string of space-separated lowercase words, which deadClasses.test.ts's
 * literal scanner reads as a Tailwind class list — the trap SearchDocs' DroppedNote records.
 * Prose belongs in the document.
 *
 * ⚠ ONE NOTE PER CARD, NOT TWO. The first attempt added a second paragraph beside the button and
 * left the receipt where it was — and thirteen existing tests went red, which is what they are
 * for. `<code>{tag}</code>` appeared TWICE in one small card, so every `getByText(tag)` in the
 * per-card tests and in the census threw on multiple matches. The tag is a join key and a card
 * has one; the honest shape is one note whose TENSE moves, which is exactly what SearchDocs'
 * CostNote in this directory already does with its `semantic` prop. The opening clause is the
 * card's, the rest is this rule's, so the payer clause cannot drift across five files.
 *
 * ⚠ THE RECEIPT WORDING IS UNCHANGED, BYTE FOR BYTE. `This summary was` + this sentence is the
 * text that shipped; the four per-card tests that pin it were not touched to make this pass.
 */
export function MeteredNote({
  tag,
  payer,
  children,
}: {
  tag: string
  /** WHO THE CHARGE LANDS ON. Not an editorial choice — it is a property of the upstream call
   *  site: `Engine.run` binds a page only when it is passed a non-empty pageID, and `docs-search`
   *  never goes through `run` at all. See meteredCostCensus.test.tsx's payer column. */
  payer: 'page' | 'workspace'
  /** The opening clause, and the ONLY thing that moves between the price and the receipt: the
   *  card passes the future form before its call has landed and the past form after. Prose as JSX
   *  rather than a string prop — a quoted run of lowercase words is what deadClasses.test.ts's
   *  literal scanner reads as a Tailwind class list (see SearchDocs' DroppedNote). */
  children: React.ReactNode
}) {
  return (
    <p className="text-caption text-faint">
      {children} a metered Lens call billed to this workspace under <code>{tag}</code>.{' '}
      {payer === 'page' ? (
        <>Docs attributes it to this page, so it moves this page’s own AI cost.</>
      ) : (
        <>Docs attributes it to no single page, so it does not appear in any page’s AI cost.</>
      )}
    </p>
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
 * spaceTitle — the same rule as `spaceCrumbLabel`, for the TITLE rather than the crumb.
 *
 * ⚠ IT EXISTS BECAUSE THE CRUMB'S RULE WAS APPLIED TO THE CRUMB AND NOWHERE ELSE. Two lines below
 * the crumb, `SpaceView` wrote `space?.name ?? spaceId` as the card header — the exact fallback the
 * docstring above calls "a control that is pointing somewhere useful and saying nothing about where"
 * — reached on the same ordinary arrivals: a reload, a shared link, a new tab, a failing spaces read.
 * W1.1.9a put that string in `text-page`, the largest type the console has, which is what made a
 * quiet inconsistency worth a function.
 *
 * ⚠ IT DEGRADES DIFFERENTLY FROM THE CRUMB, AND THE DIFFERENCE IS THE POINT. A crumb names a
 * DESTINATION, so an unknown space becomes "Pages" — what you will find there. A title names the
 * thing you are looking at, and "Pages" would be a lie about that; "This space" says exactly what is
 * known (you are inside one) and claims nothing that is not. ⚠ THE ID IS NOT DISCARDED: the caller
 * still renders it as an identifier, in mono at caption size, where a machine string belongs.
 *
 * ⚠ THE OTHER SCREEN WITH A TITLE ANSWERED THE SAME QUESTION DIFFERENTLY, AND `pageTitle` BELOW IS
 * THAT ANSWER. This paragraph used to say PageView "has no raw-id title today", which was true and
 * was about the wrong failure: it had a raw-BLANK one. See `pageTitle`.
 */
export function spaceTitle(name: string | undefined): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : 'This space'
}

/**
 * pageTitle — the same rule again, one level down, for the thing a page reader is looking at.
 *
 * ⚠ THE FALLBACK WAS `??`, AND `??` IS BLIND TO THE CASE THAT ACTUALLY HAPPENS. `PageView` wrote
 * `page.data?.title ?? 'Page'`, which catches null and undefined — the two values this read cannot
 * produce once it has answered — and NOT the empty string, which it can. MEASURED in the DOM at
 * `/docs/spaces/:spaceId/pages/:pageId` before W1.1.9b: a page whose title column held `""`
 * rendered a heading element with no text in it, and one holding `"   "` rendered three spaces.
 *
 * ⚠ WHY THAT WAS WORTH A FUNCTION RATHER THAN AN `||`. W1.1.9b promotes that element to the
 * console's one page-scale heading, which `Region` also points `aria-labelledby` at — so the blank
 * would have become the SECTION'S ACCESSIBLE NAME as well: a landmark called nothing, wearing the
 * largest type the console has. The same widening is what made `spaceTitle` worth writing.
 *
 * ⚠ BOTH INPUTS ARE REACHABLE, MEASURED AGAINST talyvor-docs `0139a38` RATHER THAN ASSUMED.
 * `internal/page/store.go#Create` defaults only the EXACTLY-empty title, so a title of spaces is
 * stored verbatim; and `updatableFields` allowlists the KEY `title` while checking no value, so the
 * PATCH this app itself makes (`docsApi.updatePage`) can store the empty string. Neither is a
 * hypothetical about a schema — they are two different holes in one upstream, and the screen only
 * has to survive them.
 *
 * ⚠ IT DEGRADES TO THE UPSTREAM'S OWN WORD, NOT TO AN INVENTED ONE. `spaceTitle` had to choose a
 * phrase ("This space") because Docs has no name for a nameless space. Here it does: `Create`
 * writes the literal `Untitled` into exactly this column for exactly this state, so a page that
 * arrives blank is called what Docs would have called it. Choosing a different word would be this
 * screen inventing a second vocabulary for a state the store already names.
 */
export function pageTitle(name: string | undefined): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : 'Untitled'
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
 * The label is exactly "‹ Back" and carries nothing else. A destination in the label ("‹ Back to
 * Engineering") re-introduces the thing that failed: it makes the control's meaning depend on
 * reading it, and it goes stale against the space name the crumb already shows.
 */
export function BackButton({ to }: { to: string }) {
  const navigate = useNavigate()
  return (
    <Button variant="default" onClick={() => navigate(to)}>
      ‹ Back
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
            <Link to={c.to} className="underline underline-offset-2 transition-colors duration-200 hover:text-ink">
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
