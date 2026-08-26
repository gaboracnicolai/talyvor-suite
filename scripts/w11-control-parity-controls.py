#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE CONTROL-PARITY GUARD (controlParity.test.ts), W1.1 /
`w11-control-parity`.

WHAT IS BEING CONTROLLED. Five hand-rolled text fields duplicate `Input.tsx`'s class list and
omit its interaction contract. The handed-over count was THREE (it came from the `placeholder=`
sweep, which cannot see a textarea with no placeholder); re-measuring found FIVE. The guard
DERIVES the contract from the component rather than listing it, so the interesting failures are
(a) the derivation going empty or over-wide, and (b) the exemption table rotting.

⚠ C4 IS THE ONE THAT MATTERS. The whole design rests on the contract being DERIVED. C4 makes the
component gain a new state property and requires every twin to fail until it is carried — if that
ever reads NOT CAUGHT, the guard has quietly become a hardcoded list and the next property added
to Input.tsx will be missed in silence, which is the exact failure this file exists to prevent.

⚠ VERDICT LOGIC inherited from `w11-selection-controls.py` (`a6e66ff`) and re-validated: C7 is a
deliberate no-op that must come back NOT CAUGHT.

EACH CONTROL: every anchor asserted BEFORE any write · the red must NAME its defect, searched only
after vitest's "Failed Tests" banner · a COMPANION that must stay green · every file restored
sha256-identical.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path("/Users/ng/talyvor-suite")
WEB = ROOT / "apps/web"

GUARD = "apps/web/src/controlParity.test.ts"
INPUT = "packages/ui/src/components/Input.tsx"
ISSUELIST = "apps/web/src/areas/track/IssueList.tsx"
PAGEVIEW = "apps/web/src/areas/docs/PageView.tsx"

TOUCHED = {GUARD, INPUT, ISSUELIST, PAGEVIEW}

DIVERGES = "a hand-rolled text field diverges from Input.tsx"
NOTHING = "no raw <input>/<textarea> was found at all"
NOCONTRACT = "no interaction contract was derived from the component"
STALE = "exempted, but no longer writes a raw control"
COMPANION = "reads a tag past an arrow function in an attribute"

CONTRACT = "transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 "

# ⚠ RE-ANCHORED AT W1.1.21, AND THE CAUSE IS WORTH KEEPING. IssueList.tsx now holds TWO raw
# controls — the full-width filter input and a smaller per-row one — and BOTH carry the contract,
# so the guard is satisfied and nothing regressed. But these controls splice with an expected count
# of exactly ONE, so the second occurrence made them unable to arm. Nothing failed; they went
# silent. ⚠ THE FIX IS NOT `count=2`: the point of both is that ONE control diverges while its twin
# stays correct, which is the case a guard that compares whole class lists or merely counts will
# pass. Mutating both at once would test the easy direction.
ISSUELIST_PRE = "text-body text-ink placeholder:text-faint "
ISSUELIST_CONTRACT = ISSUELIST_PRE + CONTRACT
ISSUELIST_HOVER = ISSUELIST_PRE + "transition-colors duration-200 hover:border-rule-strong "


@dataclass
class Control:
    name: str
    what: str
    says: str
    companion: str
    edits: list[tuple[str, list[tuple[str, int, str]]]]
    expect_caught: bool = True
    observed: str = field(default="")


CONTROLS: list[Control] = [
    Control(
        name="C1 regress-an-input",
        what="take the contract back off the create-issue title field",
        says=DIVERGES,
        companion=COMPANION,
        edits=[(ISSUELIST, [(ISSUELIST_CONTRACT, 1, ISSUELIST_PRE)])],
    ),
    Control(
        name="C2 regress-a-textarea",
        what="⚠ ONE OF THE TWO THE HANDED-OVER COUNT MISSED. PageView's textarea carries no "
             "placeholder, so the sweep that found 'three twins' could not see it",
        says=DIVERGES,
        companion=COMPANION,
        edits=[(PAGEVIEW, [(CONTRACT, 1, "")])],
    ),
    Control(
        name="C3 partial-regression",
        what="drop only the hover half and keep the transition — a guard comparing whole class "
             "lists, or merely counting, passes this",
        says=DIVERGES,
        companion=COMPANION,
        edits=[(ISSUELIST, [(ISSUELIST_HOVER, 1, ISSUELIST_PRE + "transition-colors duration-200 ")])],
    ),
    Control(
        name="C4 component-gains-a-property",
        what="⚠ THE CONTROL THAT DEFINES THE GUARD. Give Input.tsx a new state property. Every "
             "twin must fail until it carries it. A hardcoded contract passes this and would "
             "silently miss every future addition",
        says=DIVERGES,
        companion=COMPANION,
        edits=[(INPUT, [(
            "        'disabled:cursor-not-allowed disabled:opacity-50',", 1,
            "        'disabled:cursor-not-allowed disabled:opacity-50 hover:bg-canvas',",
        )])],
    ),
    Control(
        name="C5 blind-the-scanner",
        what="make rawControls find nothing — the floor must refuse to read an empty sweep as a "
             "clean product",
        says=NOTHING,
        companion=COMPANION,
        edits=[(GUARD, [("    for (const m of src.matchAll(/<(input|textarea)\\b/g)) {", 1,
                         "    for (const m of src.matchAll(/<(nothingatall)\\b/g)) {")])],
    ),
    Control(
        name="C6 empty-the-contract",
        what="make the derivation return nothing — every twin then trivially satisfies it, which "
             "is the quiet way a derived guard stops guarding",
        says=NOCONTRACT,
        companion=COMPANION,
        edits=[(GUARD, [("  return declared.filter((t) => {", 1,
                         "  return [].filter((t: string) => {")])],
    ),
    Control(
        name="C7 no-op (MUST NOT be caught)",
        what="reword a comment: real bytes change, no behaviour does. If this reads CAUGHT the "
             "harness is scoring noise and every verdict above it is worthless",
        says=DIVERGES,
        companion=COMPANION,
        expect_caught=False,
        edits=[(GUARD, [(
            "// ════════════════════════════════════════════════════════════════════════════════════════",
            1,
            "// ─────────────────────────────────────────────────────────────────────────────────────────",
        )])],
    ),
    Control(
        name="C8 stale-exemption",
        what="exempt a file that writes no raw control — the exemption table must not outlive the "
             "code it excuses",
        says=STALE,
        companion=COMPANION,
        edits=[(GUARD, [(
            "const NOT_A_TEXT_FIELD: Record<string, string> = {\n", 1,
            "const NOT_A_TEXT_FIELD: Record<string, string> = {\n"
            "  'apps/web/src/main.tsx':\n"
            "    'a deliberately stale entry planted by the control harness, long enough to clear the reason floor',\n",
        )])],
    ),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_suite() -> tuple[bool, str]:
    p = subprocess.run(
        ["npx", "vitest", "run", "src/controlParity.test.ts", "--reporter=default"],
        cwd=WEB, capture_output=True, text=True,
    )
    return p.returncode == 0, p.stdout + p.stderr


def main() -> int:
    originals = {p: (ROOT / p).read_text() for p in TOUCHED}
    hashes = {p: sha(ROOT / p) for p in TOUCHED}

    ok, base = run_suite()
    if not ok:
        print("BASELINE IS NOT GREEN — a control run means nothing from here.")
        print(base[-3000:])
        return 2
    print("baseline: GREEN\n")

    correct = 0
    for c in CONTROLS:
        planned: list[tuple[str, str]] = []
        try:
            for path, edits in c.edits:
                text = originals[path]
                for old, want, new in edits:
                    got = text.count(old)
                    if got != want:
                        raise AssertionError(
                            f"anchor count {got}, expected {want} in {path}: {old[:70]!r}")
                    text = text.replace(old, new, 1)
                planned.append((path, text))
        except AssertionError as e:
            print(f"{c.name}  ANCHOR FAILED — {e}")
            return 3

        for path, text in planned:
            (ROOT / path).write_text(text)
        try:
            ok, out = run_suite()
        finally:
            for path in TOUCHED:
                (ROOT / path).write_text(originals[path])
            for path in TOUCHED:
                if sha(ROOT / path) != hashes[path]:
                    print(f"{c.name}: RESTORE FAILED for {path}")
                    return 4

        marker = "Failed Tests"
        reds = out.split(marker, 1)[1] if marker in out else ""
        says = c.says in reds
        companion_red = c.companion in reds
        caught = (not ok) and says and not companion_red
        verdict = "CAUGHT" if caught else "NOT CAUGHT"
        as_expected = caught == c.expect_caught
        if as_expected:
            correct += 1
        c.observed = verdict
        flag = "ok" if as_expected else "⚠ UNEXPECTED"
        print(f"{c.name:32s} {verdict:10s} expected={'CAUGHT' if c.expect_caught else 'NOT CAUGHT':10s} {flag}")
        print(f"      red={not ok}  says({c.says!r})={says}  companion-green={not companion_red}")
        print(f"      {c.what}")

    print(f"\n{correct}/{len(CONTROLS)} behaved as expected")
    return 0 if correct == len(CONTROLS) else 1


if __name__ == "__main__":
    sys.exit(main())
