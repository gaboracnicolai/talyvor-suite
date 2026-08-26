#!/usr/bin/env python3
"""
W1.1.12 — A ROW'S HINT WAS CLIPPED: positive controls (tab-m3r8).

Each control MUTATES the shipped component and predicts which named test goes RED. A guard that
stays green under its own mutation is not a guard, whatever it asserted a moment ago.

⚠ WHY THESE MATTER MORE THAN USUAL HERE. The defect being fixed is a guard that COULD NOT BE RED
about the thing it was for: `ClaimsAudit.test.tsx` and `Held.test.tsx` assert a sentence is
present, read `textContent` under jsdom, and were green while 112px of that sentence was cut on
screen. A replacement guard written carelessly would inherit exactly that property, so every
assertion in `rowHintWraps.test.tsx` is mutated here and required to fail.

⚠ AND THE LAYOUT HALF IS CONTROLLED IN A BROWSER, NOT HERE — because it cannot be controlled here.
Clipping is `scrollWidth > clientWidth` and jsdom reports 0 for both. The layout control is the
census itself, run before and after the change on the BUILT artifact:

    before   1280: 2 clipped   1440: 2 clipped   390: 19 clipped
    after    1280: 0 clipped   1440: 0 clipped   390:  6 clipped   (all six short LABELS)

    ~/talyvor-queue/w1112-truncate-census-m3r8.mjs   (the populated fixture server)
    ~/talyvor-queue/w1112-truncate-driver-m3r8.mjs   (the driver)

Verdicts come from vitest's JSON per-test status, never the process exit code — a suite that fails
to collect exits non-zero and would score every control as CAUGHT while asserting nothing.

Usage: python3 scripts/w1112-row-hint-controls-m3r8.py
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UI = REPO / "packages/ui"
ROW = UI / "src/components/Row.tsx"
TEST = "src/__tests__/rowHintWraps.test.tsx"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def failures():
    """Failing test names, or None if the runner never reached an assertion."""
    report = UI / ".vitest-rowhint-report.json"
    report.unlink(missing_ok=True)
    subprocess.run(
        ["npx", "vitest", "run", TEST, "--reporter=json", f"--outputFile={report}"],
        cwd=UI, capture_output=True, text=True,
    )
    if not report.exists():
        return None
    try:
        data = json.loads(report.read_text())
    except json.JSONDecodeError:
        return None
    finally:
        report.unlink(missing_ok=True)
    results = [a for f in data.get("testResults", []) for a in f.get("assertionResults", [])]
    if not results:
        return None
    return [a.get("fullName", "") for a in results if a.get("status") == "failed"]


HINT_LINE = '{hint ? <div className="text-caption font-normal text-muted">{hint}</div> : null}'
LABEL_LINE = '<div className="truncate text-body text-ink">{label}</div>'

CONTROLS = [
    ("C1 the hint clips again — the defect restored", ROW,
     HINT_LINE,
     '{hint ? <div className="truncate text-caption font-normal text-muted">{hint}</div> : null}',
     "the hint carries no clipping class",
     "⚠ THE WHOLE FINDING. This is the state the product was in: two disclosures cut at 1280 AND "
     "1440, one of them the half two guards exist to preserve, the other the only statement that "
     "an API key is shown once. Both of those guards stayed GREEN through it."),

    ("C2 the label stops clipping — the blanket removal the item forbids", ROW,
     LABEL_LINE,
     '<div className="text-body text-ink">{label}</div>',
     "the label still clips",
     "The rule is a SPLIT, so both halves are asserted. Without this, 'hints wrap' is satisfied "
     "by a component that clips NOTHING — trading a silent clip for a silent reflow, which is "
     "what the item explicitly warns against."),

    ("C3 the hint stops rendering at all", ROW,
     HINT_LINE,
     "{null}",
     "a hint is rendered at all",
     "The floor. With no hint element the rule above is a statement about nothing, and "
     "`getByText` throwing is a less legible failure than a named one."),

    ("C4 NEGATIVE CONTROL — a comment-only edit", ROW,
     "// The settings row: label left, control right, 38px tall, hairline divider.",
     "// The settings row (a comment changed by the negative control).",
     None,
     "Nothing may red. A harness that reds on any edit is measuring the edit, not the product."),
]


def main() -> int:
    print("=" * 78)
    print("W1.1.12 — A ROW'S HINT WAS CLIPPED: positive controls")
    print("=" * 78)

    base = failures()
    if base is None:
        print("FATAL: the runner never reached an assertion on the clean tree")
        return 1
    if base:
        print(f"FATAL: the clean tree is not green: {base}")
        return 1
    print("clean tree: rowHintWraps GREEN\n")

    passed = 0
    for name, path, anchor, repl, expect, why in CONTROLS:
        src = path.read_text(encoding="utf-8")
        before = sha(path)
        n = src.count(anchor)
        if n != 1:
            print(f"✗ {name}\n   ANCHOR DEAD — {path.name} holds it {n}×, expected 1. "
                  f"This control probes NOTHING.\n")
            continue
        path.write_text(src.replace(anchor, repl), encoding="utf-8")
        try:
            fails = failures()
            if fails is None:
                ok, detail = False, "INVALID — the runner never reached an assertion"
            elif expect is None:
                ok = len(fails) == 0
                detail = "nothing red (as predicted)" if ok else f"RED: {fails}"
            else:
                hit = [f for f in fails if expect in f]
                ok = len(hit) >= 1
                detail = (f"caught by: {hit[0][:86]}" if hit
                          else f"NOT CAUGHT. red instead: {fails or '(nothing)'}")
            print(f"{'✓' if ok else '✗'} {name}\n   {why}\n   → {detail}\n")
            passed += 1 if ok else 0
        finally:
            path.write_text(src, encoding="utf-8")
            assert sha(path) == before, f"restore of {path} did not match its original sha256"

    print("every touched file restored to its original sha256")
    print("=" * 78)
    print(f"{passed}/{len(CONTROLS)} controls behaved as predicted")
    print("=" * 78)
    return 0 if passed == len(CONTROLS) else 1


sys.exit(main())
