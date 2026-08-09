#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE STATE-TRANSITION GUARD (motion.test.tsx), W1.1 / `w11-state-transitions`.

WHAT IS BEING CONTROLLED. `5d65b3e` enforced one direction of the motion lock — a `transition-*`
must state its duration. The other direction was open: a class list could change colour on hover
with NO transition at all and nothing asked. Measured at `9a18533`: SEVEN sites across six class
lists in both packages. The new guard reads BOTH the property a state utility changes AND what
each transition covers OUT OF THE GENERATED SHEET, so "does transition-colors cover a transform"
is answered by Tailwind rather than by me.

⚠ C3 IS THE ONE THAT MATTERS. A guard that merely checks "is there a transition on this element"
would pass a colour change wearing `transition-transform`. C3 makes exactly that edit. If C3 ever
reads NOT CAUGHT the guard has degraded to presence-checking and is worth very little.

⚠ THE VERDICT LOGIC IS INHERITED from `scripts/w11-selection-controls.py` (`a6e66ff`) via
`w11-press-controls.py` (`9a18533`), and is RE-VALIDATED rather than trusted: C8 is a deliberate
no-op that changes real bytes and no behaviour, and must come back NOT CAUGHT.

EACH CONTROL: every anchor count asserted BEFORE any write · the red must SAY the thing it is
supposed to say, searched only after vitest's "Failed Tests" banner · a COMPANION that must stay
green, so "the guard caught it" is distinguishable from "the file stopped compiling" · every file
restored and its sha256 compared.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path("/Users/ng/talyvor-suite")
WEB = ROOT / "apps/web"

GUARD = "apps/web/src/motion.test.tsx"
APP = "apps/web/src/App.tsx"
SELECT = "packages/ui/src/components/Select.tsx"

TOUCHED = {GUARD, APP, SELECT}

SNAPS = "a state change snaps"
FLOOR = "no state-driven visual change was found in either package"
UNKNOWN = "state-variant token the sheet has no rule for"
STALE = "classified as deliberately not tweened, but no longer a gap"
DURATION_COMPANION = "no class list carries a transition without one"
PRESS_COMPANION = "Button presses"


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
        name="C1 regress-a-fixed-site",
        what="take the transition back off App.tsx's legal link — the plainest regression",
        says=SNAPS,
        companion=DURATION_COMPANION,
        edits=[(APP, [(
            '"underline transition-colors duration-200 hover:text-muted"', 2,
            '"underline hover:text-muted"',
        )])],
    ),
    Control(
        name="C2 regress-the-seventh-site",
        what="⚠ THE ONE THE HANDED-DOWN SCOPE MISSED. `a6e66ff` measured SIX sites that 'change "
             "colour on hover'; Select's highlight is driven by data-[highlighted], not hover, so "
             "a hover-shaped measurement could not see it. This guard keys on the VARIANT being a "
             "state, not on the word hover",
        says=SNAPS,
        companion=PRESS_COMPANION,
        edits=[(SELECT, [(
            "'text-body text-ink outline-none transition-colors duration-200 data-[highlighted]:bg-canvas',", 1,
            "'text-body text-ink outline-none data-[highlighted]:bg-canvas',",
        )])],
    ),
    Control(
        name="C3 wrong-property-transition",
        what="⚠ THE CONTROL THAT DEFINES THE GUARD. Give the colour change a transition that does "
             "not cover colour (transition-transform). A presence-checking guard passes this; a "
             "property-aware one cannot",
        says=SNAPS,
        companion=DURATION_COMPANION,
        edits=[(APP, [(
            '"underline transition-colors duration-200 hover:text-muted"', 2,
            '"underline transition-transform duration-200 hover:text-muted"',
        )])],
    ),
    Control(
        name="C4 blind-the-sweep",
        what="drop every property before it can be judged — the sweep returns nothing and the "
             "floor must refuse to read that as clean",
        says=FLOOR,
        companion=PRESS_COMPANION,
        edits=[(GUARD, [(
            "          if (!TWEENABLE.has(prop)) continue", 1,
            "          if (true) continue",
        )])],
    ),
    Control(
        name="C5 drop-a-classification",
        what="remove disabled:opacity-50 from NOT_TWEENED — an exception that stops being written "
             "down must resurface as a finding rather than vanish",
        says=SNAPS,
        companion=PRESS_COMPANION,
        edits=[(GUARD, [(
            "  'disabled:opacity-50':\n"
            "    'disabled is a terminal state reached by the app, not a pointer gesture the reader is aiming at. Every design-system control snaps here and they agree with each other',\n",
            1, "",
        )])],
    ),
    Control(
        name="C6 stale-classification",
        what="excuse something that is not a gap — the table must not be allowed to outlive the "
             "code it excuses (the direction a curated list normally rots in)",
        says=STALE,
        companion=PRESS_COMPANION,
        edits=[(GUARD, [(
            "const NOT_TWEENED: Record<string, string> = {\n", 1,
            "const NOT_TWEENED: Record<string, string> = {\n"
            "  'hover:text-muted':\n"
            "    'a deliberately stale entry planted by the control harness, long enough to clear the reason-length floor',\n",
        )])],
    ),
    Control(
        name="C7 break-the-selector-reader",
        what="stop unescaping `\\:` in selectors, so every state class resolves to a name the "
             "sheet does not have. The properties map goes quiet and the invisible-token floor is "
             "the only thing that can see it",
        says=UNKNOWN,
        companion=PRESS_COMPANION,
        edits=[(GUARD, [(
            "    if (c === '\\\\') {\n"
            "      i++\n"
            "      if (i < selector.length) out += selector[i]\n"
            "      continue\n"
            "    }", 1,
            "    if (c === '\\\\') {\n"
            "      continue\n"
            "    }",
        )])],
    ),
    Control(
        name="C8 no-op (MUST NOT be caught)",
        what="reword a comment: real bytes change, no behaviour does. If this reads CAUGHT the "
             "harness is scoring noise and every verdict above it is worthless",
        says=SNAPS,
        companion=PRESS_COMPANION,
        expect_caught=False,
        edits=[(GUARD, [(
            "// ── the other half of the lock: a state change must have a transition AT ALL ─────────────",
            1,
            "// ── the lock's other half: a state change must carry a transition AT ALL ─────────────────",
        )])],
    ),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_suite() -> tuple[bool, str]:
    p = subprocess.run(
        ["npx", "vitest", "run", "src/motion.test.tsx", "--reporter=default"],
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
