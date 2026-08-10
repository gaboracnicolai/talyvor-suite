#!/usr/bin/env python3
"""Positive controls for the ledger PAGE-CEILING guard (W1.1).

The guard under test is `apps/web/src/areas/lens/spendWindowCeiling.test.tsx`: it says that
a window figure summed from ONE ledger page must not be dressed as a total when the window
holds more rows than the page.

WHAT THIS HARNESS IS FOR. The guard went 12/12 RED before the fix and 12/12 green after,
which proves the file as a whole can fail — it does NOT prove each assertion is live, and it
does not prove the guard catches the specific ways this fix can be undone. Each control below
names, BEFORE the run:

  · the mutation, as a byte edit with its anchor asserted first;
  · the test that MUST red (the predicted catcher) — a wrong prediction is the only thing
    that can show a test is passing for the wrong reason;
  · a MUST-STAY-GREEN companion — a test that must NOT move, so "everything went red" is
    never mistaken for a working guard.

Verdicts are read from the set of failing test NAMES plus their assertion messages, never
from an exit code: a control that stops the project compiling fails with the same exit code
as one the guard caught, and a crash before an assertion looks identical to a catch.

Usage:  python3 apps/web/scripts/w11-window-ceiling-controls.py [--only C3]
Run from anywhere; paths are resolved from this file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
SRC = WEB / "src" / "areas" / "lens"
MATH = SRC / "spendMath.ts"
FLOOR = SRC / "WindowFloor.tsx"
SPEND = SRC / "Spend.tsx"
GUARD = "src/areas/lens/spendWindowCeiling.test.tsx"
REPORT = WEB / ".vitest-controls.json"

# Names are SCOPED — describe block + title — because two of this guard's tests share a
# title across two describes ("MARKS the debits figure…" and "MUST STAY GREEN…" each exist
# once for /spend and once for the landing screen). Keying on the title alone silently MERGED
# them, and C6's verdict was unreadable until this was fixed: the /spend case reddened, the
# Overview case did not, and one merged key had to answer for both.
D_PRED = "the predicate: did this page reach back past the window?"
D_SPEND = "/spend — a window total it cannot know is never dressed as one it can"
D_OVER = "the console landing screen — same seam, a THIRTY-day window on the same one page"

_MARK = "MARKS the debits figure as a floor when the window overflows the page"
_GREEN = "MUST STAY GREEN — under the ceiling the exact numeral stands, unqualified"

S_MARK = (D_SPEND, _MARK)
S_SPLIT = (D_SPEND, "the per-model split carries the same mark — its charge counts are floors too")
S_GREEN = (D_SPEND, _GREEN)
S_SAME = (D_SPEND, "the predicate is asked about the SAME page size the fetch used")
O_MARK = (D_OVER, _MARK)
O_GREEN = (D_OVER, _GREEN)
P_FULL = (D_PRED, "a FULL page whose oldest row is still inside the window has NOT covered it")
P_SHORT = (D_PRED, "a SHORT page proves the ledger was exhausted, so the window is covered")
P_PAST = (D_PRED, "a full page that reaches back PAST the cutoff has covered the window")
P_EMPTY = (D_PRED, "an empty page is covered, not truncated")
P_ORDER = (D_PRED, "finds the oldest row by VALUE, not by position — order is the upstream’s promise")
P_PIN = (D_PRED, "LEDGER_PAGE is the wire ceiling both servers clamp to")

ALL_PRED = [P_FULL, P_SHORT, P_PAST, P_EMPTY, P_ORDER, P_PIN]


def label(k) -> str:
    return f"{k[1]}   [{k[0][:34]}…]" if isinstance(k, tuple) else str(k)


class Control:
    def __init__(self, cid, what, edits, catches, stays_green, expect_caught=True, note=""):
        self.cid, self.what, self.edits = cid, what, edits
        self.catches, self.stays_green = catches, stays_green
        self.expect_caught, self.note = expect_caught, note


CONTROLS = [
    Control(
        "C1", "windowExceedsPage always returns false — the blinding mutation",
        [(MATH, "  if (rows.length < pageSize) return false", "  if (rows.length < pageSize) return false\n  return false")],
        catches=[P_FULL, S_MARK, S_SPLIT, O_MARK],
        stays_green=[S_GREEN, O_GREEN, S_SAME, P_SHORT, P_PAST, P_EMPTY, P_ORDER, P_PIN],
    ),
    Control(
        "C2", "windowExceedsPage always returns TRUE — the inverse a one-sided guard cannot see",
        [(MATH, "): boolean {\n  if (rows.length < pageSize) return false",
                "): boolean {\n  return true\n  if (rows.length < pageSize) return false")],
        catches=[P_SHORT, P_PAST, P_EMPTY, P_ORDER, S_GREEN, O_GREEN],
        stays_green=[P_FULL, P_PIN, S_MARK, S_SPLIT, O_MARK, S_SAME],
        note="⚠ THE FIRST DRAFT OF THIS CONTROL WAS NOT WHAT ITS NAME SAID. It flipped the "
             "EARLY RETURN (`rows.length < pageSize` → return true), which only reaches SHORT "
             "pages — so the two full-page cases never touched the mutated line and were "
             "predicted to red for no reason. A constant-true predicate is what proves this "
             "guard is not one-sided, and it has to actually be constant.",
    ),
    Control(
        "C3", "off by one: a FULL page is treated as short, so nothing is ever marked",
        [(MATH, "if (rows.length < pageSize) return false", "if (rows.length <= pageSize) return false")],
        catches=[P_FULL, S_MARK, S_SPLIT, O_MARK],
        stays_green=[S_GREEN, O_GREEN, S_SAME, P_SHORT, P_PAST, P_EMPTY, P_ORDER, P_PIN],
    ),
    Control(
        "C4", "the reach test inverted: `oldest >= cutoff` becomes `oldest < cutoff`",
        [(MATH, "  return oldest >= cutoff", "  return oldest < cutoff")],
        catches=[P_FULL, P_PAST, P_ORDER, S_MARK, S_SPLIT, O_MARK],
        stays_green=[S_GREEN, O_GREEN, S_SAME, P_SHORT, P_EMPTY, P_PIN],
    ),
    Control(
        "C5", "the oldest row read by POSITION instead of by value",
        [(MATH,
          "  let oldest = Infinity\n  for (const r of rows) {\n    const t = Date.parse(r.created_at)\n    if (Number.isFinite(t) && t < oldest) oldest = t\n  }",
          "  const oldest = Date.parse(rows[rows.length - 1].created_at)")],
        catches=[P_ORDER],
        stays_green=[P_FULL, P_SHORT, P_PAST, P_EMPTY, P_PIN, S_MARK, S_SPLIT, S_GREEN, S_SAME, O_MARK, O_GREEN],
        note="The mutation this guard had to be REWRITTEN to see. Every other fixture here "
             "arrives newest-first, where `min` and `last` are the same answer — the rotated "
             "case exists only so this control has something to fail.",
    ),
    Control(
        "C6", "the fetch and the predicate DRIFT: /spend asks for 100 rows, the predicate still says 200",
        [(SPEND, "queryFn: () => api.lxcLedger(LEDGER_PAGE, 0),", "queryFn: () => api.lxcLedger(100, 0),")],
        catches=[S_SAME, S_MARK, S_SPLIT, S_GREEN],
        stays_green=[O_MARK, O_GREEN, P_FULL, P_SHORT, P_PAST, P_EMPTY, P_ORDER, P_PIN],
        note="S_GREEN reds through its NUMERAL assertion, not its mark assertion: a narrowed "
             "fetch returns 100 of the 150 rows, so the figure it pins stops being the total. "
             "Predicting it green was wrong. OVERVIEW's two cases are the real must-stay-green "
             "— untouched screen, untouched verdict — and they are what says this control is "
             "scoped to the file it edits.",
    ),
    Control(
        "C7", "LEDGER_PAGE set to a number neither server will serve",
        [(MATH, "export const LEDGER_PAGE = 200", "export const LEDGER_PAGE = 500")],
        catches=[P_PIN, S_SAME, S_MARK, S_SPLIT, O_MARK],
        stays_green=[S_GREEN, O_GREEN, P_FULL, P_SHORT, P_PAST, P_EMPTY, P_ORDER],
        note="The pin is a hardcoded 200, not a read-back of the constant — a guard that "
             "compares a constant to itself passes for every value. The predicate cases stay "
             "green because they pass their own page size, which is the point of the parameter.",
    ),
    Control(
        "C8", "WindowFigure marks EVERY figure as a floor, ignoring the prop",
        [(FLOOR, "{floor ? <span className=\"text-caption text-muted\">at least</span> : null}",
                 "<span className=\"text-caption text-muted\">at least</span>")],
        catches=[S_GREEN, O_GREEN],
        stays_green=[S_MARK, S_SPLIT, O_MARK, S_SAME] + ALL_PRED,
    ),
    Control(
        "C9", "WindowFigure never marks anything — the presentation blinded, the predicate intact",
        [(FLOOR, "{floor ? <span className=\"text-caption text-muted\">at least</span> : null}", "{null}")],
        catches=[S_MARK, O_MARK],
        stays_green=[S_SPLIT, S_GREEN, O_GREEN, S_SAME] + ALL_PRED,
        note="S_SPLIT must STAY GREEN: its `at least` comes from the Row hint, not from "
             "WindowFigure. If it red here the two marks would be one mark, and the split's "
             "charge counts — which are floors by the same argument — would be untested.",
    ),
    Control(
        "C10", "the sentence explaining the floor is removed",
        [(FLOOR, "  return (\n    <div data-testid={testId} className=\"px-gutter py-3 text-caption text-muted\">",
                 "  if (days || pageSize || testId) return null\n  return (\n    <div data-testid={testId} className=\"px-gutter py-3 text-caption text-muted\">")],
        catches=[S_MARK],
        stays_green=[S_SPLIT, S_GREEN, O_MARK, O_GREEN, S_SAME] + ALL_PRED,
        note="ONLY the /spend case asserts the note's testId; the Overview case asserts the "
             "numeral's mark. Naming that asymmetry before the run is what makes O_MARK "
             "staying green a result rather than a relief.",
    ),
    Control(
        "C11", "the note's WORDING changed — real bytes, no behaviour",
        [(FLOOR, "The last {days} days hold more than", "These {days} days hold more than")],
        catches=[],
        stays_green=[S_MARK, S_SPLIT, S_GREEN, O_MARK, O_GREEN, S_SAME] + ALL_PRED,
        expect_caught=False,
        note="MUST NOT be caught. The guard tests what the screen CLAIMS, not how it is "
             "phrased; a guard that reds on a copy edit is a guard someone deletes.",
    ),
]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_suite() -> tuple[set[str], dict[str, str]]:
    """Run the whole web project; return (failing test names, name -> first message)."""
    REPORT.unlink(missing_ok=True)
    subprocess.run(
        ["npx", "vitest", "run", "--reporter=json", f"--outputFile={REPORT.name}"],
        cwd=WEB, capture_output=True, text=True,
    )
    if not REPORT.exists():
        return {("", "<<NO REPORT — the project did not produce results>>")}, {}
    data = json.loads(REPORT.read_text())
    failing, messages = set(), {}
    for res in data.get("testResults", []):
        for a in res.get("assertionResults", []):
            if a.get("status") == "failed":
                anc = a.get("ancestorTitles") or []
                key = (anc[-1] if anc else "", a.get("title", ""))
                failing.add(key)
                msgs = a.get("failureMessages") or []
                messages[key] = (msgs[0].splitlines()[0] if msgs else "")[:160]
    return failing, messages


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    args = ap.parse_args()

    touched = [MATH, FLOOR, SPEND]
    before = {p: sha(p) for p in touched}

    print("BASELINE — the whole web project must be green before any control means anything.")
    base_fail, _ = run_suite()
    if base_fail:
        print("  REFUSING TO RUN: the tree is not green to begin with:")
        for n in sorted(base_fail):
            print("   ·", label(n))
        return 2
    print("  green.\n")

    results = []
    for c in CONTROLS:
        if args.only and c.cid != args.only:
            continue
        originals = {p: p.read_text() for p in touched}
        try:
            # ASSERT EVERY ANCHOR BEFORE ANY WRITE. A control that applies half of itself
            # reports a working guard as blind.
            planned = []
            for path, old, new in c.edits:
                text = originals[path]
                n = text.count(old)
                if n != 1:
                    raise AssertionError(f"{c.cid}: anchor appears {n}x in {path.name}: {old[:60]!r}")
                planned.append((path, text.replace(old, new, 1)))
            for path, text in planned:
                path.write_text(text)
            # And prove the write LANDED — an edit that changed no bytes is not a control.
            for path in {p for p, _, _ in c.edits}:
                if sha(path) == before[path]:
                    raise AssertionError(f"{c.cid}: {path.name} unchanged after the edit")

            failing, messages = run_suite()
            caught = sorted((n for n in c.catches if n in failing), key=label)
            missed = sorted((n for n in c.catches if n not in failing), key=label)
            broke = sorted((n for n in c.stays_green if n in failing), key=label)
            other = sorted(failing - set(c.catches) - set(c.stays_green), key=label)

            if c.expect_caught:
                ok = not missed and not broke
                verdict = "CAUGHT as predicted" if ok else "NOT AS PREDICTED"
            else:
                ok = not failing
                verdict = "NOT CAUGHT as required" if ok else "CAUGHT — but must not be"

            results.append((c.cid, ok, verdict))
            print(f"{c.cid}  {c.what}")
            print(f"     verdict: {verdict}")
            if caught:
                print("     predicted catchers that fired:")
                for n in caught:
                    print(f"       · {label(n)}\n         → {messages.get(n, '')}")
            if missed:
                print("     PREDICTED BUT SILENT:")
                for n in missed:
                    print(f"       · {label(n)}")
            if broke:
                print("     MUST-STAY-GREEN THAT MOVED (the control is too broad, or the guard is):")
                for n in broke:
                    print(f"       · {label(n)} → {messages.get(n, '')}")
            if other:
                print("     also red, outside the prediction:")
                for n in other:
                    print(f"       · {label(n)} → {messages.get(n, '')}")
            if c.note:
                print(f"     note: {c.note}")
            print()
        finally:
            for p, text in originals.items():
                p.write_text(text)
            for p in touched:
                assert sha(p) == before[p], f"RESTORE FAILED for {p}"

    REPORT.unlink(missing_ok=True)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"── {passed}/{len(results)} controls behaved as predicted ──")
    for cid, ok, verdict in results:
        print(f"   {cid}  {'ok ' if ok else 'XX '} {verdict}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
