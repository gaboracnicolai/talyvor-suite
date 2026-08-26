#!/usr/bin/env python3
"""
POSITIVE CONTROLS for W1.1.7's three-headline rule — tab-q4vn.

WHY. The rebuild put a page-scale claim on the Track list, which is a THIRD place the screen's
three states (loading / empty / fault) can collapse into each other, and the loudest one. The three
assertions added to IssueList.test.tsx passed on their first run, which this queue treats as
suspect until each has been seen to fail on its own.

⚠ C1 IS THE ONE THAT MATTERS. It replaces `answered && rows.length === 0` with the obvious
`rows.length === 0` — the predicate anyone would write first. That is TRUE while the read is in
flight and TRUE when the read FAILED, so a broken tracker announces itself as an empty one in the
largest type on the screen. If C1 does not go red, the test is decoration.

Convention as w11-display-sweep-controls.py: anchor count asserted before the write, bytes verified
changed, a MUST-RED target AND a MUST-STAY-GREEN companion, byte-identical sha256-verified restore.
"""

import hashlib
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web"
LIST = REPO / "apps/web/src/areas/track/IssueList.tsx"

T_POPULATED = ("src/areas/track/IssueList.test.tsx", "a populated tracker says what it is")
T_EMPTY = ("src/areas/track/IssueList.test.tsx", "an EMPTY tracker says so")
T_FAULT = ("src/areas/track/IssueList.test.tsx", "a FAULT is not an empty tracker")
T_ROWS = ("src/areas/track/IssueList.test.tsx", "the issue list a tester actually uses")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(target) -> bool:
    f, name = target
    return subprocess.run(["npx", "vitest", "run", f, "-t", name],
                          cwd=WEB, capture_output=True, text=True).returncode == 0


def control(cid, desc, old, new, must_red, must_green, expect_count=1):
    src = LIST.read_text(encoding="utf-8")
    n = src.count(old)
    if n != expect_count:
        print(f"  {cid}  ✗ ANCHOR DEAD — IssueList.tsx holds it {n}×, expected {expect_count}")
        return False
    before = sha(LIST)
    LIST.write_text(src.replace(old, new, expect_count), encoding="utf-8")
    if sha(LIST) == before:
        print(f"  {cid}  ✗ THE WRITE CHANGED NOTHING")
        return False
    try:
        red = not run(must_red)
        green = run(must_green)
    finally:
        LIST.write_text(src, encoding="utf-8")
        assert sha(LIST) == before, f"{cid}: RESTORE FAILED"
    verdict, ok = (
        ("CAUGHT", True) if red and green
        else ("SUSPECT (companion also red — breaks the screen, does not probe)", False) if red
        else ("NOT CAUGHT ⚠ THE TEST IS BLIND TO THIS", False)
    )
    print(f"  {cid}  {verdict}\n      {desc}")
    print(f"      must-red   {must_red[1]!r} → {'RED' if red else 'GREEN'}")
    print(f"      must-green {must_green[1]!r} → {'GREEN' if green else 'RED'}")
    return ok


def main():
    print("W1.1.7 — THREE-HEADLINE POSITIVE CONTROLS (tab-q4vn)\n")
    r = []

    r.append(control(
        "C1", "⚠ the obvious predicate — `rows.length === 0` without `answered`, so a FAULT "
              "announces itself as an empty tracker in the largest type on the screen",
        "  const empty = answered && rows.length === 0",
        "  const empty = rows.length === 0",
        must_red=T_FAULT, must_green=T_POPULATED,
    ))

    r.append(control(
        "C2", "the fault headline is collapsed into the empty one — the exact laundering this "
              "screen's oldest comment forbids",
        "const HEADLINE_FAULT = 'Track can’t be reached, so nothing can be listed.'",
        "const HEADLINE_FAULT = 'Nothing is being tracked in this workspace yet.'",
        must_red=T_FAULT, must_green=T_EMPTY,
    ))

    r.append(control(
        "C3", "the empty state loses its next action — back to naming the absence only",
        "              Write the first issue",
        "              Nothing here yet",
        must_red=T_EMPTY, must_green=T_FAULT,
    ))

    r.append(control(
        "C4", "the action stops PERFORMING — the button is there and focuses nothing, which is "
              "the 'above' instruction wearing a button",
        "              onClick={() => titleRef.current?.focus()}",
        "              onClick={() => undefined}",
        must_red=T_EMPTY, must_green=T_POPULATED,
    ))

    r.append(control(
        "C5", "the page-scale heading reverts to the console ramp — W1.1.0's step comes off this "
              "screen and nothing else notices",
        '        heading={heading}',
        '        heading={undefined}',
        must_red=T_POPULATED, must_green=T_ROWS,
    ))

    print()
    caught = sum(1 for x in r if x)
    print(f"{caught}/{len(r)} controls CAUGHT")
    print("IssueList.tsx restored and sha256-verified inside each control")
    return 0 if caught == len(r) else 1


if __name__ == "__main__":
    sys.exit(main())
