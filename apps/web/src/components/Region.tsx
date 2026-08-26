import { useId } from 'react'

import { cn } from '@talyvor/ui'

// THE REGION MARKING — the public site's section shape, in the console's type scale.
//
// It landed with W1.1.1 (the Overview rebuild) inside that one screen and moved here the moment a
// second screen wanted it, because two copies of a marking are how a language stops being one:
// `areas/marketing/Landing.tsx` §SectionLabel is the site's version and this is the console's, and
// there should not be a third.
//
// What it is, and why each part:
//   · a 2px accent TICK — colour lands on a tick, never on text. The palette rests on that.
//   · a mono INDEX. It is a numeral, so it is on the figure face like every other numeral in the
//     product (figureAudit runs on every render in this app and would say so).
//   · the EYEBROW, carrying `uppercase` in the same class list as the token — eyebrowAudit's
//     source rule, which exists because a transform inherited from an ancestor is invisible to a
//     reader of the call site. (⚠ The sentence that stood here read "the one uppercase eyebrow this
//     system has", and caseCallSites.test.ts classified it as a CENSUS of `uppercase` call sites —
//     correctly, by its own rule: a cardinal beside that class name is exactly the shape of the
//     claim it exists to check. It was prose about a style, so it is written not to state one.)
//
// ⚠ THE SECTION IS A NAMED LANDMARK, which is the half that is not decoration. A console screen
// used to be one `main` holding an undifferentiated run of panels, so a reader moving by region got
// exactly one stop on it. `aria-labelledby` points at the HEADING where a region has one — where a
// section has a heading, that is its name, and a landmark named "Workspace" beside a heading saying
// something else would be two answers to one question — and at the eyebrow where it does not.
export interface RegionProps {
  /**
   * Two digits, in document order. It is a label, not a count — nothing derives it, and since
   * W1.1.13 nothing CONSUMES it either: it is rendered and that is all.
   *
   * ⚠ THAT SECOND HALF USED TO BE FALSE IN A WAY THIS DOCSTRING WAS SILENT ABOUT, and the silence
   * was the defect. The sentence above said "nothing derives it", which was true and was about the
   * wrong direction — the index DID feed `aria-labelledby`, so it was load-bearing for
   * accessibility while reading as decoration. See `landmarkIds.test.tsx`.
   */
  index: string
  /** The uppercase eyebrow: the question this region answers. */
  label: string
  /**
   * The screen's page-scale heading, on the ONE region that opens it.
   *
   * ⚠ THIS RENDERS `text-page`, AND THE SENTENCE THAT STOOD HERE IS THE REASON IT NOW EXISTS. It
   * read: "`text-title` is the top of the console ramp (24px) … so this is the largest type a
   * console screen may write." That was TRUE and it was the defect W1.1.0 names — the console's
   * largest type was 24px while the public page opens at up to 58px, which is most of why a
   * rebuilt screen and the front door never read as one product. `page` is the console's own
   * fluid step (preset.ts §THE CONSOLE'S ONE DISPLAY STEP), floored at exactly `title`'s 24px so
   * nothing regresses at narrow widths and ceilinged at `display-2`'s 38px so it never out-shouts
   * the site. The marketing steps still stop at the gate; displayScale.test.ts is unchanged in
   * what it refuses.
   *
   * It is an `h2`: the shell writes exactly one `h1` per address (#126, #127), and a second would
   * be a second claim about what the page is.
   */
  heading?: string
  /** Extra classes for the CONTENT block, not the section. Absent children render no block at
   *  all — an empty one is 24px of space with nothing in it. */
  className?: string
  /** Extra classes for the SECTION — padding overrides for the region that opens a screen. */
  sectionClassName?: string
  children: React.ReactNode
}

export function Region({ index, label, heading, className, sectionClassName, children }: RegionProps) {
  // ⚠ THE ID IS GENERATED, NOT DERIVED FROM `index` — W1.1.13. It was `region-${index}-label`, so
  // two regions given the same index took the same DOM id; `getElementById` returns the FIRST and
  // the second section's accessible name silently became the first section's label. A screen
  // reader listed two sections called "What you have" and the visible page was identical. It was
  // found by a positive control (W1.1.3's C4), not by reading, and it was LATENT — every index in
  // the product is unique today. Six screen rebuilds are still OPEN and all of them are told to
  // use this component, which is why the repair is "unique by construction" rather than "check the
  // indices are unique": the second is a rule someone has to keep, and the first is not.
  //
  // ⚠ THE COLONS ARE STRIPPED, AND THAT IS NOT COSMETIC. React 18.3.1's `useId()` emits `:r0:`,
  // and `querySelector('#:r0:-label')` throws `SyntaxError: is not a valid selector` — measured.
  // Tests and guards reach for elements that way, so a raw id turns a clean assertion into a crash
  // somewhere unrelated. Stripping the delimiters keeps React's uniqueness (they are leading and
  // trailing, and the varying part is between them) — and `landmarkIds.test.tsx` asserts document
  // -wide id uniqueness across every address, so that is CHECKED rather than assumed: if React's
  // format ever changed such that stripping could collide, the sweep reds.
  const uid = useId().replace(/:/g, '')
  const labelId = `region-${uid}-label`
  const headingId = `region-${uid}-heading`
  return (
    <section
      aria-labelledby={heading ? headingId : labelId}
      className={cn('border-b border-rule px-gutter py-10 last:border-b-0 wide:py-12', sectionClassName)}
    >
      <div className="flex items-center gap-2.5" data-testid="region-label">
        <span className="h-3 w-0.5 bg-accent" aria-hidden="true" />
        <span className="font-figure text-caption text-faint" data-testid="region-index">
          {index}
        </span>
        <span id={labelId} className="font-figure text-eyebrow uppercase text-muted">
          {label}
        </span>
      </div>
      {heading ? (
        <h2 id={headingId} className="mt-6 max-w-3xl text-page text-ink">
          {heading}
        </h2>
      ) : null}
      {/* ⚠ THE MEASURE IS NARROWER THAN THE SECTION, which is the public page's shape (its
          `max-w-5xl` sections hold `max-w-3xl` and `max-w-2xl` blocks) and here it is also a READING
          decision, measured in Chrome at 1280 with the sidebar: a settings row stretched across the
          full column puts its label and its figure ~800px apart, and the eye travels that gap on
          every row. The left edges of every region still line up, so the air on the right reads as
          air rather than as a broken grid. */}
      {children ? <div className={cn('mt-6 max-w-3xl', className)}>{children}</div> : null}
    </section>
  )
}

/** The wrapper every rebuilt console screen opens with — one measure, one place. */
export function RegionScreen({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl">{children}</div>
}
