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
  /** Two digits, in document order. It is a label, not a count — nothing derives it. */
  index: string
  /** The uppercase eyebrow: the question this region answers. */
  label: string
  /**
   * The screen's page-scale heading, on the ONE region that opens it. `text-title` is the top of
   * the console ramp (24px) — the marketing display steps stop at the gate (displayScale.test.ts),
   * so this is the largest type a console screen may write. It is an `h2`: the shell writes exactly
   * one `h1` per address (#126, #127), and a second would be a second claim about what the page is.
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
  const labelId = `region-${index}-label`
  const headingId = `region-${index}-heading`
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
        <h2 id={headingId} className="mt-6 max-w-3xl text-title text-ink">
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
