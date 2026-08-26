#!/usr/bin/env python3
"""W1.1.18 positive controls — the money-NAME rule, in both directions.

W1.1.18's own terms: "it needs its own positive controls in BOTH directions — formatUSD,
formatCents, lensCostForLXC must still be caught, setFocusDraft-shaped names must not — plus a
control for (2), because a tightened name pattern leaves the fake-JSX-wrapper reader untouched and
that one can only ever ADD sites."

⚠ THE DIRECTION THAT MATTERS MOST IS THE NARROWING ONE. This rule guards the product thesis (money
renders on the figure face), and the file's own sentence about the other pattern applies here:
"narrowing the pattern until these disappear is how a detector stops finding the real ones too." So
the cases below that MATTER are the ones proving the rule still catches real money after the repair.

Every mutation is restored and sha256-verified.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
WEB = ROOT / "apps" / "web"
FF = WEB / "src" / "figureFace.test.ts"


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run():
    r = subprocess.run(
        ["pnpm", "--filter", "@talyvor/web", "exec", "vitest", "run", "src/figureFace.test.ts"],
        cwd=ROOT, capture_output=True, text=True,
    )
    return r.returncode, r.stdout + r.stderr


CASES = [
    # ── the NARROWING direction: the rule must still catch real money ──
    ("M1", "the repair is narrowed back to a WORD boundary — `formatUSD` stops matching, which is "
           "the exact call the rule exists for",
     [("const MONEY_SEGMENT = /^(usd|cents|cost|price)s?$/i",
       "const MONEY_SEGMENT = /^(cents|cost|price)s?$/i")],
     "money names the rule no longer catches"),

    ("M2", "the segmenter stops splitting acronyms, so `formatUSD` becomes one segment and is missed",
     [("    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+|[0-9]+/g) ?? [])",
       "    .flatMap((part) => [part])")],
     "money names the rule no longer catches"),

    ("M3", "the plural is dropped, so `formatCosts` is missed",
     [("const MONEY_SEGMENT = /^(usd|cents|cost|price)s?$/i",
       "const MONEY_SEGMENT = /^(usd|cents|cost|price)$/i")],
     "money names the rule no longer catches"),

    # ── the WIDENING direction: the defect this item was filed for ──
    ("M4", "THE ORIGINAL DEFECT: the rule goes back to a substring test on the bare identifier",
     [("  return segments(ident).some((seg) => MONEY_SEGMENT.test(seg))",
       "  return /usd|cents|cost|price/i.test(ident)")],
     "not money, but matched"),

    ("M5", "the segment test becomes a CONTAINS test, so `setFocusDraft`'s `Focus` segment... does "
           "not match, but `statusDot`'s `status` contains no term either — the one that breaks is "
           "a segment merely holding a term",
     [("const MONEY_SEGMENT = /^(usd|cents|cost|price)s?$/i",
       "const MONEY_SEGMENT = /(usd|cents|cost|price)s?/i")],
     "not money, but matched"),

    # ── the predicate going constant, which both hand lists would half-accept ──
    ("M6", "the predicate answers TRUE for everything — the MONEY list still passes, and only the "
           "discrimination check disagrees",
     [("  return segments(ident).some((seg) => MONEY_SEGMENT.test(seg))", "  return true")],
     "not money, but matched"),

    ("M7", "the predicate answers FALSE for everything — the NOT_MONEY list still passes",
     [("  return segments(ident).some((seg) => MONEY_SEGMENT.test(seg))", "  return false")],
     "money names the rule no longer catches"),

    # ── the population census's own floors ──
    ("M8", "VACUITY: the source census reads a pattern that matches no file",
     [("    for (const f of allSources(/\\.tsx?$/)) {", "    for (const f of allSources(/\\.nonexistent$/)) {")],
     "the identifier census found nothing to classify"),

    # ── the pinned limit (blindness 2) ──
    ("M9", "the fake-JSX-wrapper limit is 'fixed' by skipping a `<` preceded by an identifier "
           "character — which is the repair W1.1.18 warns against, and this control is what keeps "
           "the pin honest if anyone tries it",
     [("    if (!after || !/[A-Za-z/]/.test(after)) continue",
       "    if (!after || !/[A-Za-z/]/.test(after)) continue\n    if (i > 0 && /[A-Za-z0-9_$)\\]]/.test(src[i - 1]) && after !== '/') continue")],
     "the generic no longer opens a fake tag"),
]


def main():
    before = sha(FF)
    code, out = run()
    if code != 0:
        print("BASELINE NOT GREEN:\n" + out[-2500:])
        return 1
    print("baseline: figureFace GREEN\n")

    caught, missed = [], []
    for cid, why, edits, marker in CASES:
        original = FF.read_text()
        if not all(original.count(o) == 1 for o, _ in edits):
            print(f"{cid} ANCHOR MISS: sites occur {[original.count(o) for o, _ in edits]}, want all 1 "
                  f"— the control never ran. ({why})")
            missed.append(cid)
            continue
        try:
            mutated = original
            for o, n in edits:
                mutated = mutated.replace(o, n, 1)
            FF.write_text(mutated)
            code, out = run()
            if code == 0:
                print(f"{cid} NOT CAUGHT — {why}: still GREEN.")
                missed.append(cid)
            elif marker not in out:
                print(f"{cid} WRONG GUARD — {why}: red, but the expected message never appeared.")
                missed.append(cid)
            else:
                print(f"{cid} CAUGHT — {why}")
                caught.append(cid)
        finally:
            FF.write_text(original)
            if sha(FF) != before:
                print(f"{cid} RESTORE FAILED — STOPPING.")
                return 2

    code, _ = run()
    if sha(FF) != before:
        print("RESTORE DRIFT")
        return 2
    print(f"\nrestored: sha256 matches; re-run {'GREEN' if code == 0 else 'RED'}")
    print(f"CONTROLS: {len(caught)}/{len(CASES)} CAUGHT" + (f"; MISSED {missed}" if missed else ""))
    return 0 if not missed and code == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
