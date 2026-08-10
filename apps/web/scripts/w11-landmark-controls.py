#!/usr/bin/env python3
"""Positive controls for landmark coverage on the signed-out surfaces (W1.1, tab-9a3c).

Same harness as `w11-deep-heading-controls.py` (this tab, one merge earlier): every anchor is
counted BEFORE ANY byte is written, a control may carry several edits ACROSS SEVERAL FILES and they
are applied in one write per file, the tree is restored from SAVED BYTES with sha256 compared, a
broken build scores nothing, and the verdict is read from the PRINTED ASSERTION MESSAGE.

⚠ LIMIT, RE-STATED: `executed()` reads the FIRST `Tests … (N)` line of a two-project run, which is
packages/ui's count, not the combined figure.
"""

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
ROOT = WEB.parent.parent
GATE = WEB / "src" / "components" / "AuthGate.tsx"
ENTRY = WEB / "src" / "areas" / "auth" / "Entry.tsx"
PRIVACY = WEB / "src" / "routes" / "Privacy.tsx"
TERMS = WEB / "src" / "routes" / "Terms.tsx"
APP = WEB / "src" / "App.tsx"
GUARD = WEB / "src" / "LandmarkCoverage.test.tsx"

GATE_OPEN = '    <main className="flex min-h-screen items-center justify-center bg-canvas px-gutter">'
ENTRY_OPEN = ('      <main className="flex flex-1 items-start justify-center px-gutter pb-16 pt-4 '
              'wide:items-center wide:pt-0">')
LEGAL_OPEN = '    <main className="mx-auto w-full max-w-3xl px-gutter py-10">'

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
BROKEN = re.compile(r"Transform failed|SyntaxError|Failed to load|Cannot find module|error TS\d+")
FAILED_TEST = re.compile(r"×\s+(.*?)(?:\s+\d+ms)?$", re.M)
MESSAGE = re.compile(r"→\s+(.*)$", re.M)
RAN = re.compile(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed[^(\n]*\((\d+)\)")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_suite() -> tuple[int, str]:
    r = subprocess.run(["pnpm", "test"], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "CI": "1"})
    return r.returncode, ANSI.sub("", r.stdout + r.stderr)


def executed(out: str) -> int:
    m = RAN.search(out)
    return int(m.group(3)) if m else 0


class Control:
    def __init__(self, key, title, edits, predicted, must_stay_green=False):
        self.key, self.title, self.edits = key, title, edits
        self.predicted, self.must_stay_green = predicted, must_stay_green

    @property
    def paths(self):
        return sorted({e[0] for e in self.edits}, key=str)


CONTROLS = [
    Control(
        "C1", "REVERT the refused-session card — the state every gated address renders signed out",
        [(GATE, GATE_OPEN, GATE_OPEN.replace("<main", "<div")),
         (GATE, "\n    </main>", "\n    </div>")],
        "characters in NO landmark region",
    ),
    Control(
        "C2", "REVERT the two front doors — /signin and /signup",
        [(ENTRY, ENTRY_OPEN, ENTRY_OPEN.replace("<main", "<div")),
         (ENTRY, "\n      </main>", "\n      </div>")],
        "/signin has 215 of 227 characters of text in NO landmark region",
    ),
    Control(
        "C3", "REVERT both policy documents — two files, four edits, ONE write each",
        [(PRIVACY, LEGAL_OPEN, LEGAL_OPEN.replace("<main", "<div")),
         (PRIVACY, "\n    </main>", "\n    </div>"),
         (TERMS, LEGAL_OPEN, LEGAL_OPEN.replace("<main", "<div")),
         (TERMS, "\n    </main>", "\n    </div>")],
        "/privacy has 6447 of 6552 characters of text in NO landmark region",
    ),
    Control(
        "C4", "RAISE THE VACUITY FLOOR — is the 'did this page render at all' check armed?",
        [(GUARD, "const FLOOR = 100", "const FLOOR = 100000")],
        "which is less than this page has",
    ),
    Control(
        "C5", "ADD A SIXTH PUBLIC ROUTE to App.tsx — a surface nobody named in the sweep",
        [(APP, '          <Route path="/terms" element={<Terms />} />',
          '          <Route path="/terms" element={<Terms />} />\n'
          '          <Route path="/status" element={<Terms />} />')],
        "App.tsx declares a public route this file does not sweep",
    ),
    Control(
        "C6", "INVERTED — the card as <div role=\"main\">; the ROLE is the landmark. MUST STAY GREEN",
        [(GATE, GATE_OPEN, GATE_OPEN.replace('<main className=', '<div role="main" className=')),
         (GATE, "\n    </main>", "\n    </div>")],
        "", must_stay_green=True,
    ),
]

ALL_PATHS = sorted({e[0] for c in CONTROLS for e in c.edits}, key=str)


def main() -> int:
    saved = {p: p.read_bytes() for p in ALL_PATHS}
    sums = {p: sha(p) for p in ALL_PATHS}

    print("BASELINE — the fixed tree, both projects")
    rc, out = run_suite()
    baseline_tests = executed(out)
    if baseline_tests < 100:
        print(f"  the harness read {baseline_tests} tests out of a suite of hundreds — it is not "
              "parsing this runner's output. Fix the parser before reading any result.")
        print(out[-2000:])
        return 3
    if rc != 0:
        print("  the baseline is NOT green; every verdict below would be unreadable")
        print(out[-3000:])
        return 1
    print(f"  green, {baseline_tests} tests executed\n")

    results = []
    for c in CONTROLS:
        texts = {p: p.read_text() for p in c.paths}
        counts = [(path, texts[path].count(old)) for path, old, _ in c.edits]
        if any(n != 1 for _, n in counts):
            print(f"{c.key}: ANCHOR COUNTS {[n for _, n in counts]}, want all 1 — NOT APPLIED\n")
            results.append((c.key, "NOT APPLIED"))
            continue
        for path, old, new in c.edits:
            texts[path] = texts[path].replace(old, new)
        for path, text in texts.items():
            path.write_text(text)
        try:
            inert = [p.name for p in c.paths if sha(p) == sums[p]]
            if inert:
                print(f"{c.key}: {inert} UNCHANGED after the write — NOT APPLIED\n")
                results.append((c.key, "NOT APPLIED"))
                continue
            rc, out = run_suite()
            msgs = [m.strip()[:170] for m in MESSAGE.findall(out)]
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
                for x in list(dict.fromkeys(msgs))[:6]:
                    print(f"   spoke: {x}")
                print(f"   failing tests ({len(tests)}): {tests[:6]}{' …' if len(tests) > 6 else ''}")
                ok = rc != 0 and bool(hit)
                print(f"   {'CAUGHT by the PREDICTED assertion' if ok else 'NOT CAUGHT AS PREDICTED'}")
                results.append((c.key, "CAUGHT" if ok else "NOT AS PREDICTED"))
        finally:
            for path in c.paths:
                path.write_bytes(saved[path])
                if sha(path) != sums[path]:
                    print(f"   ⚠ RESTORE MISMATCH on {path.name}")
                    return 2
        print()

    print("SUMMARY")
    for k, v in results:
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
