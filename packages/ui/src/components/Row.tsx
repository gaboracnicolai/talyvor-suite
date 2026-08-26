import { cn } from '../lib/cn'

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left-hand label. */
  label: React.ReactNode
  /** Optional secondary description under the label. */
  hint?: React.ReactNode
  /** Right-hand control. */
  children?: React.ReactNode
}

// The settings row: label left, control right, 38px tall, hairline divider. The
// label is ink, the hint is muted — never a hue.
//
// ⚠⚠ THE HINT WRAPS AND THE LABEL CLIPS, AND THAT SPLIT IS THE WHOLE OF W1.1.12. Both carried
// `truncate` — nowrap, overflow hidden, ellipsis — and a CENSUS IN REAL CHROME on the BUILT
// artifact, over ten console addresses against a POPULATED fixture, found **168 rendered
// `.truncate` elements** and exactly **TWO that clip at desktop width**. Both are hints:
//
//   /      112px cut at 1280, 104px at 1440 — "settles on its own after a holding period —
//          during which it can still be revoked"
//   /keys  136px cut at 1280 AND 1440 — "Minted server-side with the proxy scope; the key is
//          shown once, then only its identifier remains"
//
// ⚠ A SOURCE GREP ANSWERS A DIFFERENT QUESTION AND ANSWERS IT LOW: 13 sites in source, 168
// elements on screen, because this component is shared by 24 files. The clip is a property of
// LAYOUT, and only a browser knows it.
//
// ⚠ WHAT IS CUT IS THE HALF TWO GUARDS EXIST TO KEEP. `ClaimsAudit.test.tsx` and `Held.test.tsx`
// both assert "can still be revoked" is present — that clause was ADDED because the copy used to
// describe only settlement and omit the revocation. Both read `textContent` under jsdom, which
// has no layout, so both were green on a sentence no reader could finish. ⚠ AND THE `/keys` one
// is worse: NOTHING pins it and no second voice repeats it, so "the key is shown once" — the
// disclosure that this secret is unrecoverable — was cut with nothing else saying it anywhere.
//
// ⚠ THE LABEL KEEPS `truncate` DELIBERATELY, AND NOT BLANKET-REMOVING IT IS THE ITEM'S OWN
// INSTRUCTION: it is load-bearing where a long value would break the row's grid, and removing it
// everywhere trades a silent clip for a silent reflow. The measurement supports the split rather
// than merely permitting it — every desktop clip in the product was a HINT, none was a label.
// A hint is prose (this file's own prop doc calls it "secondary description"); prose that cannot
// be finished is not shorter, it is wrong. A label sits beside a control in a fixed row.
//
// ⚠ AND WRAPPING ADDS HEIGHT RATHER THAN BREAKING THE GRID: the row is `min-h-row`, a FLOOR, so a
// two-line hint grows the row and the control stays on its axis. Measured after the change — no
// horizontal overflow at 1280/1440/390, and the count of clipped elements at desktop went 2 → 0.
export function Row({ label, hint, children, className, ...props }: RowProps) {
  return (
    <div
      className={cn(
        'flex min-h-row items-center justify-between gap-gutter px-gutter py-2',
        'border-b border-rule last:border-b-0',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <div className="truncate text-body text-ink">{label}</div>
        {hint ? <div className="text-caption font-normal text-muted">{hint}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}
