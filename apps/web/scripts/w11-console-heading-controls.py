#!/usr/bin/env python3
"""Positive controls for the gated console's page heading (W1.1, tab-7b52).

Every control names the assertion it expects to speak BEFORE it runs; the verdict is read from the
PRINTED ASSERTION MESSAGE, never from a test name and never from a bare exit code.

  * the anchor is asserted UNIQUE before every write — a substitution matching nothing edits zero
    bytes and is byte-indistinguishable from a guard that works;
  * files are restored from SAVED BYTES, never `git checkout` — the tree carries the uncommitted
    fix — and sha256 is compared after every restore;
  * a BROKEN BUILD is detected explicitly and scores nothing: a transform/parse error makes vitest
    report a file-level failure that would otherwise read as a caught mutation. The run is also
    required to have EXECUTED a plausible number of tests, so a suite that collapsed early cannot
    be read as a control that fired;
  * the run target is BOTH PROJECTS (`pnpm test` at the root, what CI runs), so "which tests spoke"
    is measured rather than assumed and a control caught only by its own file cannot hide.
"""

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
ROOT = WEB.parent.parent
APP = WEB / "src" / "App.tsx"
GUARD = WEB / "src" / "ConsoleHeading.test.tsx"

HEADING_LINE = '          <h1 className="min-w-0 truncate text-head text-ink">{page}</h1>'


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_suite() -> tuple[int, str]:
    r = subprocess.run(["pnpm", "test"], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "CI": "1"})
    return r.returncode, ANSI.sub("", r.stdout + r.stderr)


BROKEN = re.compile(r"Transform failed|SyntaxError|Failed to load|Cannot find module|error TS\d+")
# ⚠ EVERY PATTERN IS PREFIX- AND COLOUR-TOLERANT, AND THAT IS NOT A DETAIL. The first version of
# this script anchored on `^` and parsed the RAW bytes; pnpm prefixes every line with
# "apps/web test: " and vitest wraps its counters in ANSI escapes, so NOTHING matched, the baseline
# reported "0 tests executed", and all five live controls scored NOT CAUGHT on a suite that was in
# fact firing correctly. A zero from an instrument that read nothing is indistinguishable from a
# zero that was measured — hence assert_read() below.
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
FAILED_TEST = re.compile(r"×\s+(.*?)(?:\s+\d+ms)?$", re.M)
MESSAGE = re.compile(r"→\s+(.*)$", re.M)
RAN = re.compile(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed[^(\n]*\((\d+)\)")


def executed(out: str) -> int:
    """Total tests the run collected, or 0 if the counter line was never printed."""
    m = RAN.search(out)
    return int(m.group(3)) if m else 0


class Control:
    def __init__(self, key, title, path, old, new, predicted, must_stay_green=False):
        self.key, self.title, self.path = key, title, path
        self.old, self.new, self.predicted = old, new, predicted
        self.must_stay_green = must_stay_green


CONTROLS = [
    Control(
        "C1", "revert the heading to the <div> it was — main's state",
        APP, HEADING_LINE,
        '          <div className="min-w-0 truncate text-head text-ink">{page}</div>',
        "rendered 0 heading elements",
    ),
    Control(
        "C2", "an EMPTY heading — the element exists and announces nothing",
        APP, HEADING_LINE,
        '          <h1 className="min-w-0 truncate text-head text-ink"></h1>',
        "does not name the page",
    ),
    Control(
        "C3", "a CONSTANT heading — one name on all twelve screens",
        APP, HEADING_LINE,
        '          <h1 className="min-w-0 truncate text-head text-ink">Talyvor</h1>',
        "does not name the page",
    ),
    Control(
        "C4", "a SECOND h1 in the same shell — two claims about what the page is",
        APP, HEADING_LINE,
        HEADING_LINE + '\n          <h1 className="sr-only">{page}</h1>',
        "<h1> elements, want exactly 1",
    ),
    Control(
        "C5", "drop a route from the PINNED table — the sweep silently stops covering it",
        GUARD, "  '/members': 'Members',\n", "",
        "the pinned heading names and the router disagree",
    ),
    Control(
        "C6", "INVERTED — the same element with its classes reordered; MUST STAY GREEN",
        APP, HEADING_LINE,
        '          <h1 className="truncate min-w-0 text-ink text-head">{page}</h1>',
        "", must_stay_green=True,
    ),
]


def main() -> int:
    saved = {p: p.read_bytes() for p in (APP, GUARD)}
    sums = {p: sha(p) for p in (APP, GUARD)}

    print("BASELINE — the fixed tree, both projects")
    rc, out = run_suite()
    baseline_tests = executed(out)
    if baseline_tests < 100:
        print(f"  the harness read {baseline_tests} tests out of a suite of hundreds — it is not "
              "parsing this runner's output, and every verdict below would be a zero from an "
              "instrument that read nothing. Fix the parser before reading any result.")
        print(out[-2000:])
        return 3
    if rc != 0:
        print("  the baseline is NOT green; every verdict below would be unreadable")
        print(out[-3000:])
        return 1
    print(f"  green, {baseline_tests} tests executed\n")

    results = []
    for c in CONTROLS:
        text = c.path.read_text()
        n = text.count(c.old)
        if n != 1:
            print(f"{c.key}: ANCHOR COUNT {n}, want 1 — NOT APPLIED, no verdict\n")
            results.append((c.key, "NOT APPLIED"))
            continue
        c.path.write_text(text.replace(c.old, c.new))
        try:
            rc, out = run_suite()
            msgs = [m.strip()[:150] for m in MESSAGE.findall(out)]
            tests = sorted(set(FAILED_TEST.findall(out)))
            ran = executed(out)
            print(f"{c.key} — {c.title}")
            print(f"   predicted: {c.predicted or '(none — must stay green)'}")
            if BROKEN.search(out) or ran < baseline_tests - 20:
                print(f"   BUILD/COLLECTION BROKEN (ran {ran} of {baseline_tests}) — scores NOTHING")
                results.append((c.key, "BUILD BROKEN"))
            elif c.must_stay_green:
                print(f"   exit={rc} ran={ran} failing={tests or '[]'}")
                ok = rc == 0
                print(f"   {'AS SPECIFIED (stayed green)' if ok else 'NOT AS SPECIFIED — it reds'}")
                results.append((c.key, "GREEN AS SPECIFIED" if ok else "NOT AS SPECIFIED"))
            else:
                hit = [x for x in msgs if c.predicted in x]
                for x in dict.fromkeys(msgs):
                    print(f"   spoke: {x}")
                print(f"   failing tests ({len(tests)}): {tests[:6]}{' …' if len(tests) > 6 else ''}")
                ok = rc != 0 and bool(hit)
                print(f"   {'CAUGHT by the PREDICTED assertion' if ok else 'NOT CAUGHT AS PREDICTED'}")
                results.append((c.key, "CAUGHT" if ok else "NOT AS PREDICTED"))
        finally:
            c.path.write_bytes(saved[c.path])
            if sha(c.path) != sums[c.path]:
                print(f"   ⚠ RESTORE MISMATCH on {c.path.name}")
                return 2
        print()

    print("SUMMARY")
    for k, v in results:
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
