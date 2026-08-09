#!/usr/bin/env python3
"""
POSITIVE CONTROLS for __tests__/selection.test.ts — the selection-plane guard.

The offender rule here is SILENT when the product is correct, which is the state a broken
guard is indistinguishable from. So every control puts a specific defect back and requires
the guard to go red FOR THAT REASON, not merely to go red.

Each control, following the shape `78822bb` / `fe36452` settled on:

  · every anchor's occurrence count is ASSERTED BEFORE any edit is written — `dc0bd07`
    found two controls that had silently not run, and the count is the only way to know;
  · edits inside one file are applied SEQUENTIALLY to the evolving text, never both
    computed from the original — a control that applies half of itself reports a working
    guard as blind;
  · the red must NAME ITS OWN DEFECT: a substring that only this defect produces must
    appear in the output, so a cascade from some unrelated breakage cannot be written down
    as this guard's catch;
  · every control names a COMPANION test that must STAY GREEN, so a control that merely
    breaks the file is not scored as a catch;
  · every file is restored and its sha256 compared to the original.

Run from the repo root:  python3 scripts/w11-selection-controls.py
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "packages" / "ui"
THEME = "packages/ui/src/theme.css"
GUARD = "packages/ui/src/__tests__/selection.test.ts"
TOKENS = "packages/ui/src/tokens.ts"


@dataclass
class Control:
    name: str
    what: str
    # (path, [(old, expected_count, new), ...]) — applied in order, on the evolving text
    edits: list[tuple[str, list[tuple[str, int, str]]]]
    # a substring that ONLY this defect produces
    says: str
    # a test title that must still PASS while the control is applied
    companion: str
    observed: str = field(default="", init=False)


CONTROLS: list[Control] = [
    Control(
        name="C1",
        what="delete the ::selection rule entirely — the state main is in",
        edits=[(THEME, [("::selection {\n  background-color: var(--accent);\n  color: var(--accent-ink);\n}\n", 1, "")])],
        says="declares no ::selection",
        companion="the classification is total",
    ),
    Control(
        name="C2",
        what="use --accent-tint, the plausible answer measured wrong (1.22:1 vs the canvas)",
        edits=[(THEME, [("background-color: var(--accent);", 1, "background-color: var(--accent-tint);"),
                        ("  color: var(--accent-ink);\n}", 1, "  color: var(--ink);\n}")])],
        says="the highlight is separable from canvas",
        companion="the classification is total",
    ),
    Control(
        name="C3",
        what="keep the plane, put the SELECTED TEXT on --faint — AA body fails",
        edits=[(THEME, [("color: var(--accent-ink);", 1, "color: var(--faint);")])],
        says="selected text meets AA body",
        companion="the classification is total",
    ),
    Control(
        name="C4",
        what="the tempting half-fix: declare the background and leave the foreground alone",
        edits=[(THEME, [("  color: var(--accent-ink);\n", 1, "")])],
        says="names BOTH halves",
        companion="the classification is total",
    ),
    Control(
        name="C5",
        what="write the accent as a literal hex instead of the token — the palette stops carrying",
        edits=[(THEME, [("background-color: var(--accent);", 1, "background-color: #0F7A6C;")])],
        says="names BOTH halves",
        companion="the classification is total",
    ),
    Control(
        name="C6",
        what="ship the vendor-prefixed selector only — Chrome paints nothing",
        edits=[(THEME, [("::selection {", 1, "::-moz-selection {")])],
        says="declares no ::selection",
        companion="the classification is total",
    ),
    Control(
        name="C7",
        what="stop scoring the dark theme — the guard narrows and says nothing",
        edits=[(GUARD, [("const THEMES = ['light', 'dark'] as const", 1, "const THEMES = ['light'] as const")])],
        says="every theme in tokens.ts is scored here",
        companion="theme.css declares a ::selection rule at all",
    ),
    Control(
        name="C8",
        what="drift the dark accent to a value that fails separability — the guard must read tokens.ts, not a copy",
        edits=[(TOKENS, [("accent: '#3AD6C0'", 1, "accent: '#0B1524'")])],
        says="the highlight is separable from canvas",
        companion="theme.css declares a ::selection rule at all",
    ),
    Control(
        name="C9",
        what="BLIND THE PARSER and delete the rule together — only the floor can see this",
        edits=[
            (THEME, [("::selection {\n  background-color: var(--accent);\n  color: var(--accent-ink);\n}\n", 1, "")]),
            (GUARD, [("  const rule = /(^|\\})\\s*::selection\\s*\\{([^}]*)\\}/m.exec(css)\n  if (!rule) return null\n", 1,
                      "  return { plane: 'accent', ink: 'accent-ink' }\n  const rule = /(^|\\})\\s*::selection\\s*\\{([^}]*)\\}/m.exec(css)\n  if (!rule) return null\n")]),
        ],
        says="the shipped rule really names the tokens",
        companion="the classification is total",
    ),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_suite() -> tuple[bool, str]:
    """Run the two files that matter: the guard and the instrument it borrows."""
    p = subprocess.run(
        ["npx", "vitest", "run", "src/__tests__/selection.test.ts", "src/__tests__/contrast.test.ts",
         "--reporter=default"],
        cwd=UI, capture_output=True, text=True,
    )
    return p.returncode == 0, p.stdout + p.stderr


def main() -> int:
    originals = {p: (ROOT / p).read_text() for p in {THEME, GUARD, TOKENS}}
    hashes = {p: sha(ROOT / p) for p in originals}

    ok, base = run_suite()
    if not ok:
        print("BASELINE IS NOT GREEN — a control run means nothing from here.")
        print(base[-3000:])
        return 2
    print("baseline: GREEN\n")

    caught = 0
    for c in CONTROLS:
        # ⚠ EVERY anchor asserted BEFORE any write. A half-applied control is a no-op
        # reported as evidence.
        planned: list[tuple[str, str]] = []
        try:
            for path, edits in c.edits:
                text = originals[path]
                for old, want, new in edits:
                    got = text.count(old)
                    if got != want:
                        raise AssertionError(f"{c.name}: anchor count {got}, expected {want} in {path}: {old[:60]!r}")
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
            for path in originals:
                (ROOT / path).write_text(originals[path])
            for path in originals:
                if sha(ROOT / path) != hashes[path]:
                    print(f"{c.name}: RESTORE FAILED for {path}")
                    return 4

        # ⚠ SEARCH ONLY THE FAILED-TESTS SECTION, and this correction is the point.
        # vitest's default reporter prints EVERY test title in a file once that file fails —
        # the ✓ lines as well as the × ones (`78822bb` hit the mirror image of this and
        # condemned three working controls). So `c.says in out` matches the title of a test
        # that PASSED, and every control below would have scored CAUGHT for the wrong reason.
        # The block after the "Failed Tests" banner contains failing titles and their
        # assertion messages and nothing else.
        marker = "Failed Tests"
        reds = out.split(marker, 1)[1] if marker in out else ""
        says = c.says in reds
        # ⚠ a control that merely breaks the file is not a catch — the companion must survive
        companion_red = c.companion in reds
        verdict = "CAUGHT" if (not ok and says and not companion_red) else "NOT CAUGHT"
        if verdict == "CAUGHT":
            caught += 1
        c.observed = verdict
        print(f"{c.name}  {verdict:10s}  red={not ok}  says({c.says!r})={says}  companion-still-green={not companion_red}")
        print(f"      {c.what}")

    print(f"\n{caught}/{len(CONTROLS)} CAUGHT")
    return 0 if caught == len(CONTROLS) else 1


if __name__ == "__main__":
    sys.exit(main())
