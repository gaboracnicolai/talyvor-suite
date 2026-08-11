#!/usr/bin/env python3
"""Positive controls for the ledger timestamp's figure-face classification (W1.1).

The change under test is one table entry: `areas/lens/format.ts#formatWhen` (and its namesake)
moved from an EXEMPTION to `true`. A classification is not a behaviour, so the only way to know
it bought anything is to break the thing it now claims to protect and watch which assertion
speaks — and to break it AGAIN with the old exemption restored, which is the control that says
the closure is the classification rather than something else in the file.

Run from the repo root:  python3 scripts/w11-clock-figure-face-controls.py
"""

import hashlib
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "apps/web"
LEDGER = ROOT / "apps/web/src/areas/lens/Ledger.tsx"
FACE = ROOT / "apps/web/src/figureFace.test.ts"

CASE_FACE = "every formatter classified as a figure renders on the figure face"
CASE_MONEY = "none of it renders in the sans"
CASE_TOTAL = "every exported format* is classified, and nothing is classified that does not exist"

# The ledger's timestamp cell, on and off the face.
TD_ON = '<td className="whitespace-nowrap px-gutter py-2 font-figure text-body text-muted">{formatWhen(r.created_at)}</td>'
TD_OFF = '<td className="whitespace-nowrap px-gutter py-2 text-body text-muted">{formatWhen(r.created_at)}</td>'

# The classification as it shipped before this merge, restored verbatim for the blinding control.
#
# ⚠ BOTH ENTRIES, AND THE FIRST VERSION OF D2 REVERTED ONLY ONE — it predicted NOT CAUGHT and was
# CAUGHT. The face check's figure set is the NAME half of every `true` entry, so ONE entry saying
# `formatWhen` is a figure enforces the name for BOTH modules. That is why the hole needed both
# entries to be exemptions, and why a half-applied blinding measures nothing: it leaves the guard
# armed and reads its red as the product's.
CLASSIFIED = "  'apps/web/src/areas/lens/format.ts#formatWhen': true,"
EXEMPT = (
    "  'apps/web/src/areas/lens/format.ts#formatWhen':\n"
    "    'a timestamp rendered as prose (\"3 minutes ago\", \"12 Aug\"), not a column of digits',"
)
TRACK_CLASSIFIED = "  'apps/web/src/areas/track/format.ts#formatWhen': true,"
TRACK_EXEMPT = (
    "  'apps/web/src/areas/track/format.ts#formatWhen':\n"
    "    'a timestamp, as lens\\'s is — a second formatWhen, same shape and same answer',"
)


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_web() -> tuple[int, str]:
    r = subprocess.run(["npx", "vitest", "run", "--reporter=default"],
                       cwd=WEB, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def failing_cases(out: str) -> list[str]:
    """Test NAMES, never a bare count — a crash and a catch look identical in an exit code."""
    return [s.strip() for s in out.splitlines()
            if s.strip().startswith("×") or s.strip().startswith("FAIL")]


def control(label: str, edits: list[tuple[pathlib.Path, str, str]], predicted: str | None,
            must_stay_green: str | None = None) -> bool:
    """predicted=None means the control is EXPECTED to be NOT CAUGHT (a blinding control)."""
    originals = {p: p.read_text() for p, _, _ in edits}
    before = {p: sha(p) for p in originals}
    print(f"\n=== {label}")
    print(f"    PREDICTED : {predicted if predicted else 'NOT CAUGHT (blinding control)'}")
    for p, old, _ in edits:
        print(f"    file      : {p.relative_to(ROOT)}")
        if old not in originals[p]:
            print(f"    !! ANCHOR ABSENT — control cannot apply; this is NOT a NOT-CAUGHT result")
            return False
    ok = False
    try:
        # ⚠ ACCUMULATE PER FILE, NEVER WRITE FROM `originals` TWICE. Two edits to one file applied
        # as two writes from the pristine text leave only the second — the control then applies
        # half of itself and reports a working guard as blind. D2 edits figureFace.test.ts twice.
        working = dict(originals)
        for p, old, new in edits:
            mutated = working[p].replace(old, new, 1)
            if mutated == working[p]:
                print("    !! MUTATION INERT")
                return False
            working[p] = mutated
        for p, text in working.items():
            p.write_text(text)
        code, out = run_web()
        fails = failing_cases(out)
        caught = code != 0
        print(f"    verdict   : {'CAUGHT' if caught else 'NOT CAUGHT'} (exit {code})")
        for f in fails:
            print(f"      red: {f}")
        if predicted is None:
            ok = not caught
            print(f"    prediction: {'CONFIRMED (nothing saw it)' if ok else '*** WRONG — something caught it ***'}")
        elif caught:
            hit = any(predicted in f for f in fails)
            print(f"    prediction: {'CONFIRMED' if hit else '*** WRONG — a different assertion spoke ***'}")
            ok = hit
        if must_stay_green is not None:
            green = not any(must_stay_green in f for f in fails)
            print(f"    stay-green: {must_stay_green!r} -> {'green' if green else '*** ALSO RED ***'}")
            ok = ok and green
    finally:
        for p, original in originals.items():
            p.write_text(original)
            if sha(p) != before[p]:
                sys.exit(f"restore failed for {p} — tree is dirty")
        print("    restored  : ok (sha256 match on every file)")
    return ok


def main() -> int:
    print("D0 — no mutation: the tree as committed must be green.")
    code, out = run_web()
    print(f"    verdict   : exit {code}")
    if code != 0:
        for f in failing_cases(out):
            print(f"      red: {f}")
        return 1

    results = {}

    # D1 — THE DEFECT. The ledger's timestamp column falls into the body sans, beside a MuNumeral
    # that stays on the face. Measured NOT CAUGHT at 4bbf6d0 (1072/1072 green) with the old
    # exemption in place; the money rule must stay silent, because `formatWhen` is not money-named
    # and a red there would mean something else entirely spoke.
    results["D1 ledger timestamp column drops off the face"] = control(
        "D1  font-figure removed from Ledger.tsx's timestamp <td>",
        [(LEDGER, TD_ON, TD_OFF)],
        predicted=CASE_FACE, must_stay_green=CASE_MONEY,
    )

    # D2 — THE BLINDING CONTROL, and the one that makes D1 mean what it says. Same mutation, with
    # BOTH shipped exemption strings put back — the pre-merge state exactly. If this is CAUGHT,
    # the closure was never the classification and D1's CAUGHT was somebody else's work.
    results["D2 same defect, both old exemptions restored -> nothing sees it"] = control(
        "D2  D1's mutation with the pre-merge exemption text back in BOTH entries",
        [(LEDGER, TD_ON, TD_OFF), (FACE, CLASSIFIED, EXEMPT), (FACE, TRACK_CLASSIFIED, TRACK_EXEMPT)],
        predicted=None, must_stay_green=CASE_TOTAL,
    )

    # D3 — the table must stay TOTAL. Deleting an entry to make a face check pass is the move the
    # file's own header forbids; this says a different assertion catches that, so D1's catcher is
    # not doing two jobs.
    results["D3 an entry deleted rather than answered"] = control(
        "D3  the lens formatWhen entry removed from FORMATTERS entirely",
        [(FACE, CLASSIFIED + "\n", "")],
        predicted=CASE_TOTAL, must_stay_green=CASE_MONEY,
    )

    print("\n──────── SUMMARY ────────")
    for k, v in results.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
