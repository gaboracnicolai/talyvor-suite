#!/usr/bin/env python3
"""Positive controls for the heading at the addresses BELOW the console (W1.1, tab-9a3c).

Structure and parser adapted from `w11-console-heading-controls.py` (tab-7b52). The ANSI/prefix
tolerance and the `assert_read` floor are ITS measurements, not this run's: they were paid for by a
run in which five live controls scored NOT CAUGHT against a suite that was firing perfectly. What is
NEW here, and is this file's own, is that a control may carry SEVERAL edits and they are applied in
ONE write after EVERY anchor has been counted — a harness that writes twice to one file erases its
first edit and then reports a working guard as blind.

Every control names the assertion it expects to speak BEFORE it runs; the verdict is read from the
PRINTED ASSERTION MESSAGE, never from a test name and never from a bare exit code.

  * every anchor is asserted UNIQUE before any write — a substitution matching nothing edits zero
    bytes and is byte-indistinguishable from a guard that works;
  * files are restored from SAVED BYTES, never `git checkout` — the tree carries the uncommitted
    fix — and sha256 is compared after every restore;
  * a BROKEN BUILD is detected explicitly and scores nothing: a transform error makes vitest report
    a file-level failure that would otherwise read as a caught mutation;
  * the run target is BOTH PROJECTS (`pnpm test` at the root, what CI runs), so "which tests spoke"
    is measured rather than assumed and a control caught only by its own file cannot hide.

⚠ LIMIT, INHERITED AND RE-STATED: `executed()` reads the FIRST `Tests … (N)` line of a two-project
run, which is packages/ui's count, not the combined figure. The collapse check is relative to that
same number, so it detects a collapse of THAT project's suite.
"""

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
ROOT = WEB.parent.parent
DETAIL = WEB / "src" / "areas" / "track" / "IssueDetail.tsx"
ENTRY = WEB / "src" / "areas" / "auth" / "Entry.tsx"
GUARD = WEB / "src" / "ConsoleDeepHeading.test.tsx"

HEADING = '          <h2 className="text-title text-ink">{it.title}</h2>'
FAIL_BRANCH = '        <p className="text-body text-muted">That issue could not be read.</p>'
SERVE_ISSUE = "    if (path === '/api/track/issues/iss-1') return json(ISSUE)"

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
        self.key, self.title = key, title
        # [(path, old, new), …] — several may share a path; they are written ONCE, together.
        self.edits = edits
        self.predicted, self.must_stay_green = predicted, must_stay_green

    @property
    def paths(self):
        return sorted({e[0] for e in self.edits}, key=str)


CONTROLS = [
    Control(
        "C1", "REVERT — the issue title back to the <h1> main ships; two h1s at one address",
        [(DETAIL, HEADING, '          <h1 className="text-title text-ink">{it.title}</h1>')],
        "<h1> elements, want exactly 1",
    ),
    Control(
        "C2", "the heading REMOVED — same text, same size, no heading element at all",
        [(DETAIL, HEADING, '          <div className="text-title text-ink">{it.title}</div>')],
        "Unable to find an accessible element with the role \"heading\"",
    ),
    Control(
        "C3", "an <h1> on a branch NO ADDRESS IN THIS FILE RENDERS — the read-failure card",
        [(DETAIL, FAIL_BRANCH,
          FAIL_BRANCH + '\n        <h1 className="text-title text-ink">Issue</h1>')],
        "a page served inside the console shell renders its own <h1>",
    ),
    Control(
        "C4", "BLIND THE FIXTURE — 404 the issue read, so the page draws its failure card",
        [(GUARD, SERVE_ISSUE,
          "    if (path === '/api/track/issues/iss-1') return new Response('null', { status: 404 })")],
        # ⚠ THIS PREDICTION WAS WRONG ONCE AND THE RUN IS WHY THE GUARD CHANGED. The premise case
        # fired, but it fired through Testing Library's "Unable to find an element with the text",
        # because `await findAllByText` throws before any expect() runs — so the sentence the case
        # was written to print was unreachable. The guard now swallows the lookup and asserts on the
        # count, which is what makes this string the one that speaks.
        "the BFF fake did not serve /track/issues/iss-1",
    ),
    Control(
        "C5", "empty the census's CONTROL DIRECTORY — all three auth h1s become h2s",
        [(ENTRY, '      <h1 className="text-title text-ink">You’re signed in</h1>',
          '      <h2 className="text-title text-ink">You’re signed in</h2>'),
         (ENTRY, '          <h1 className="text-title text-ink">Create your Talyvor workspace</h1>',
          '          <h2 className="text-title text-ink">Create your Talyvor workspace</h2>'),
         (ENTRY, '      <h1 className="text-title text-ink">Sign in to Talyvor</h1>',
          '      <h2 className="text-title text-ink">Sign in to Talyvor</h2>')],
        "the census found no <h1> under areas/auth",
    ),
    Control(
        "C6", "INVERTED — the same h2 with its classes reordered; MUST STAY GREEN",
        [(DETAIL, HEADING, '          <h2 className="text-ink text-title">{it.title}</h2>')],
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
        # EVERY anchor is counted BEFORE ANY byte is written. Two edits to one file applied as two
        # write_text() calls off the same saved text lose the first one, and the harness then scores
        # a half-applied control as a verdict about the guard.
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
                # The bytes on disk did not move. Whatever the suite says next is a fact about the
                # unmutated tree, so it is not a verdict about this control.
                print(f"{c.key}: {inert} UNCHANGED after the write — NOT APPLIED\n")
                results.append((c.key, "NOT APPLIED"))
                continue
            rc, out = run_suite()
            msgs = [m.strip()[:160] for m in MESSAGE.findall(out)]
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
                print(f"   failing tests ({len(tests)}): {tests[:8]}{' …' if len(tests) > 8 else ''}")
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
