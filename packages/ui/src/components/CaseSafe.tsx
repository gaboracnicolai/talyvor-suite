/**
 * CaseSafe — text that survives an inherited `text-transform`.
 *
 * `text-transform: uppercase` does not stylise every character; for some it substitutes a
 * DIFFERENT one. The case this product renders is the SI micro prefix: µ (U+00B5) uppercases to
 * Μ (U+039C GREEK CAPITAL MU), so `µLXC` paints as `MLXC` — micro read as mega, twelve orders of
 * magnitude out, on figures whose whole purpose is to be checkable against the ledger. Measured in
 * Chrome 151: the uppercase run is byte-identical in width to a run containing the real U+039C,
 * and `textContent` still says "µLXC", so no text assertion can see it.
 *
 * preset.ts §THE EYEBROW deliberately keeps `uppercase` OUT of the token and says the call site
 * must handle this. This is the call site's one shape, so there is one of it: put each replaced
 * character in a `normal-case` span, where the nearest declaration wins over the inherited one, and
 * leave the rest of the string to be uppercased as intended.
 *
 * ⚠ WHY NOT JUST WRITE `<span className="normal-case">µ</span>` AT EACH SITE. That is what
 * MuNumeral did, and it was the only site that did it — a hand-rolled protection in one component
 * while twenty other `uppercase` class lists took their text from props. The predicate here is
 * computed rather than a list of characters, so a label that grows a `ß` is protected without
 * anyone remembering this file exists.
 *
 * ⚠ apps/web/src/caseAudit.ts carries a SECOND, INDEPENDENT implementation of `replacesCharacter`,
 * on purpose and not by accident. A guard that asks the fix what counts as hazardous cannot notice
 * the fix's answer going wrong — narrow both together and the audit reports the product clean. The
 * two are held to ONE hand-written vocabulary by caseAudit.test.tsx, the same "one corpus, two
 * implementations" shape talyvor-code uses for its command guard: change either and it is red.
 */

/**
 * Does a casing transform REPLACE `ch` rather than re-case it?
 *
 * A clean re-casing maps to exactly one character and maps back. `a`→`A`→`a` round-trips, so
 * uppercasing it is the intended effect. `µ`→`Μ`→`μ` does not: the character that comes back is
 * U+03BC, not the U+00B5 that went in, which is the arithmetic way of saying a different character
 * is now on screen. `ß`→`SS` fails on length.
 *
 * ⚠ Characters the transform does not change at all are not replaced — digits, `$`, `%`, `≈`, and
 * an already-capital `Μ` all map to themselves. Without that first line every capital letter in
 * the product would be flagged.
 *
 * ⚠ IT TAKES NO TRANSFORM ARGUMENT, AND THAT IS A MEASUREMENT RATHER THAN A SIMPLIFICATION. The
 * first version's signature named all four of Tailwind's casing utilities, and this file is IN the
 * Tailwind content set — so the type union alone compiled the two the product does not use into the
 * shipped sheet as real rules that nothing renders (measured: 344 → 346 emitted names, +74 bytes —
 * W1.8's exact shape). They are not named here either, for the same reason and because a comment is
 * raw text to the extractor; apps/web/src/caseAudit.test.tsx names them, measures them and refuses
 * them, in a file the content globs exclude. Uppercasing is the only direction that can replace a
 * character and the only casing utility the product uses, so it is the only one modelled.
 */
export function replacesCharacter(ch: string): boolean {
  const mapped = ch.toUpperCase()
  if (mapped === ch) return false
  if (mapped.length !== 1) return true
  return mapped.toLowerCase() !== ch
}

/**
 * Split `text` into runs, marking which must not be transformed. Exported for the tests: the
 * splitting is where an off-by-one would silently drop a character out of a label, and asserting
 * the runs directly is cheaper and clearer than asserting rendered spans.
 */
export function caseSafeRuns(text: string): { text: string; protect: boolean }[] {
  const runs: { text: string; protect: boolean }[] = []
  for (const ch of Array.from(text)) {
    const protect = replacesCharacter(ch)
    const last = runs[runs.length - 1]
    if (last && last.protect === protect) last.text += ch
    else runs.push({ text: ch, protect })
  }
  return runs
}

/**
 * Render `children` so an inherited casing transform cannot substitute a character for another.
 * Returns the string unchanged when nothing needs protecting, so the overwhelmingly common case
 * adds no element to the tree.
 */
export function CaseSafe({ children }: { children: string }) {
  const runs = caseSafeRuns(children)
  if (!runs.some((r) => r.protect)) return <>{children}</>
  return (
    <>
      {runs.map((r, i) =>
        r.protect ? (
          <span key={i} className="normal-case">
            {r.text}
          </span>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  )
}
