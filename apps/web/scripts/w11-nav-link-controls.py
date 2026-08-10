#!/usr/bin/env python3
"""Positive controls for ConsoleNavLinks.test.tsx (W1.1, tab-3f91).

Same harness shape as `w11-landmark-controls.py`: every anchor is counted BEFORE ANY byte is
written, a control may carry several edits across several files and they are applied in ONE write
per file, the tree is restored from SAVED BYTES with sha256 compared, a broken build scores
nothing, and the verdict is read from the PRINTED ASSERTION MESSAGE rather than from a test name.

⚠ TWO DEPARTURES FROM THAT HARNESS, BOTH DELIBERATE.

1. `executed()` SUMS every project's `Tests … (N)` line instead of reading the first. The parent
   harness documents its own limit — it reported packages/ui's 349 and called it the run — and a
   count that is wrong by 856 is the number the "did the build break" check is compared against.

2. EVERY control names a COMPANION that must stay green, and the companion is the same file for
   all of them: `LandmarkCoverage.test.tsx`. It sweeps all twelve gated addresses and both public
   documents, and it is blind BY CONSTRUCTION to whether a destination is a link or a button — it
   asks only whether text and controls sit inside a landmark region. So it proves each mutation
   broke the BEHAVIOUR under test and not the page, the shell, or the build.

⚠ C3 IS THE ONE THAT JUSTIFIES THE GUARD'S LAST DESCRIBE BLOCK. It leaves a real `<a href>` in
place and only takes the modified click back — markup that passes every tag-shaped and href-shaped
assertion in this file while delivering none of the capability the fix is about. If C3 is not
caught, the guard is a spelling checker.
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
NAVITEM = ROOT / "packages" / "ui" / "src" / "components" / "NavItem.tsx"
GUARD = WEB / "src" / "ConsoleNavLinks.test.tsx"
COMPANION = "LandmarkCoverage.test.tsx"

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
BROKEN = re.compile(r"Transform failed|SyntaxError|Failed to load|Cannot find module|error TS\d+")
FAILED_TEST = re.compile(r"×\s+(.*?)(?:\s+\d+ms)?$", re.M)
FAILED_FILE = re.compile(r"FAIL\s+(\S+\.test\.tsx?)", re.M)
MESSAGE = re.compile(r"→\s+(.*)$", re.M)
RAN = re.compile(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed[^(\n]*\((\d+)\)")

# The shipped call site, verbatim.
LINK_PROPS = "      href={href}\n      onClick={onClick}"
ROUTER_HOOKS = "  const href = useHref(to)\n  const onClick = useLinkClickHandler<HTMLAnchorElement>(to)"
IMPORT_HOOKS = "  useHref,\n  useLinkClickHandler,\n  useLocation,\n} from 'react-router-dom'"
ARIA_CURRENT = "      'aria-current': active ? ('page' as const) : undefined,"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_suite() -> tuple[int, str]:
    r = subprocess.run(["pnpm", "test"], cwd=ROOT, capture_output=True, text=True,
                       env={**os.environ, "CI": "1"})
    return r.returncode, ANSI.sub("", r.stdout + r.stderr)


def executed(out: str) -> int:
    """Every project's total, summed. One project's number is not the run's."""
    return sum(int(m[2]) for m in RAN.findall(out))


class Control:
    def __init__(self, key, title, edits, predicted, must_stay_green=False):
        self.key, self.title, self.edits = key, title, edits
        self.predicted, self.must_stay_green = predicted, must_stay_green

    @property
    def paths(self):
        return sorted({e[0] for e in self.edits}, key=str)


CONTROLS = [
    Control(
        "C1", "MAIN'S SHAPE RESTORED — the destination stops carrying an href",
        [(APP, LINK_PROPS, "      onClick={onClick}")],
        "carry no href",
    ),
    Control(
        "C2", "AN href THAT IS NOT THE DESTINATION — every row points at '#'",
        [(APP, "      href={href}\n", '      href="#"\n')],
        "the sidebar's links do not address the destinations it offers",
    ),
    Control(
        "C3", "THE MODIFIED CLICK STOLEN BACK — a real <a href> that navigates on EVERY click. "
              "Passes every tag and href assertion; this is what the capability block is for",
        [(APP, IMPORT_HOOKS, "  useHref,\n  useLocation,\n  useNavigate,\n} from 'react-router-dom'"),
         (APP, ROUTER_HOOKS,
          "  const href = useHref(to)\n  const navigate = useNavigate()\n"
          "  const onClick = (e: React.MouseEvent) => {\n"
          "    e.preventDefault()\n    navigate(to)\n  }")],
        "a meta-clicked destination navigated the CURRENT tab",
    ),
    Control(
        "C4", "A DESTINATION DELETED — is the count a floor, or decoration?",
        [(APP, "        {item('/ledger', 'Ledger')}\n", "")],
        "focusable destinations, not 12",
    ),
    Control(
        "C5", "aria-current DROPPED — the selected row becomes a tick and nothing else",
        [(NAVITEM, ARIA_CURRENT, "      'aria-current': undefined,")],
        "aria-current moved off the destination",
    ),
    # ⚠ C6 AND C7 ARE THE SAME REGRESSION AT TWO COUNTS, AND THEY HAVE DIFFERENT CATCHERS.
    # C6 was ONE control predicting "carry no href" and it was NOT CAUGHT AS PREDICTED: adding a
    # thirteenth row moves the count, the vacuity floor is the FIRST expect in the case, and it
    # throws before the href-less assertion is ever evaluated. The prediction was wrong, not the
    # guard. So the two failure modes are now separated and each names its own catcher.
    Control(
        "C6", "AN EXISTING DESTINATION DOWNGRADED TO A <button>, COUNT HELD AT 12 — this is the "
              "one the href-less assertion has to catch, with the floor unable to speak",
        [(APP, "        {item('/members', 'Members')}\n",
          "        <NavItem onClick={() => undefined}>Members</NavItem>\n")],
        "carry no href",
    ),
    Control(
        "C7", "A THIRTEENTH DESTINATION ADDED AS A <button> — the count floor is the catcher here, "
              "and it fires before the href-less assertion runs",
        [(APP, "        {item('/members', 'Members')}\n",
          "        {item('/members', 'Members')}\n"
          "        <NavItem onClick={() => undefined}>Reports</NavItem>\n")],
        "focusable destinations, not 12",
    ),
]

ALL_PATHS = sorted({e[0] for c in CONTROLS for e in c.edits}, key=str)


def main() -> int:
    saved = {p: p.read_bytes() for p in ALL_PATHS}
    sums = {p: sha(p) for p in ALL_PATHS}

    print("BASELINE — the fixed tree, both projects")
    rc, out = run_suite()
    baseline_tests = executed(out)
    if baseline_tests < 1000:
        print(f"  the harness read {baseline_tests} tests out of a suite of over a thousand — it "
              "is not parsing this runner's output. Fix the parser before reading any result.")
        print(out[-2000:])
        return 3
    if rc != 0:
        print("  the baseline is NOT green; every verdict below would be unreadable")
        print(out[-3000:])
        return 1
    print(f"  green, {baseline_tests} tests executed across both projects\n")

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
            files = sorted({Path(f).name for f in FAILED_FILE.findall(out)})
            ran = executed(out)
            companion_green = COMPANION not in files
            print(f"{c.key} — {c.title}")
            print(f"   predicted: {c.predicted or '(none — must stay green)'}")
            if BROKEN.search(out) or ran < baseline_tests - 25:
                print(f"   BUILD/COLLECTION BROKEN (ran {ran} of {baseline_tests}) — scores NOTHING")
                results.append((c.key, "BUILD BROKEN"))
            elif c.must_stay_green:
                ok = rc == 0
                print(f"   exit={rc} ran={ran} failing={tests or '[]'}")
                results.append((c.key, "GREEN AS SPECIFIED" if ok else "NOT AS SPECIFIED"))
            else:
                hit = [x for x in msgs if c.predicted in x]
                for x in list(dict.fromkeys(msgs))[:5]:
                    print(f"   spoke: {x}")
                print(f"   failing files: {files}")
                verdict = "GREEN" if companion_green else (
                    "RED — this mutation broke the page, not the behaviour under test; "
                    "any catch below means nothing")
                print(f"   companion {COMPANION}: {verdict}")
                ok = rc != 0 and bool(hit) and companion_green
                print(f"   {'CAUGHT by the PREDICTED assertion, companion green' if ok else 'NOT CAUGHT AS PREDICTED'}")
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
