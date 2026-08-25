#!/usr/bin/env python3
"""
POSITIVE CONTROLS for src/pinnedClock.test.ts — the wall-clock sweep. tab-q4vn.

THE DEFECT UNDER CONTROL. `lxcSplitCoverage.test.tsx:136` rendered `<Overview />` with no `now`, so
it summed a 30-day window against the WALL CLOCK over fixtures dated 2026-07-21. It passed until
2026-08-20 and failed from 2026-08-21 with no commit in between; main's last CI run was
2026-08-19, so `gh run list` reported ci=success for a tree that had since gone red.

⚠ C3 IS THE ONE THAT MATTERS. The component set is DERIVED from source signatures, and the usual
death of a derived sweep is the seam moving so the set empties and the sweep reports "no
violations" over nothing. C3 renames the default out of `Overview` and demands the FLOOR speak.

Convention as w11-display-sweep-controls.py: anchor count asserted before any write, bytes verified
changed, a MUST-RED target AND a MUST-STAY-GREEN companion (both red = SUSPECT, not CAUGHT), and a
byte-identical sha256-verified restore.
"""

import hashlib
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web"

LXC = REPO / "apps/web/src/areas/lens/lxcSplitCoverage.test.tsx"
HELD = REPO / "apps/web/src/areas/lens/Held.test.tsx"
OVERVIEW = REPO / "apps/web/src/areas/lens/Overview.tsx"

T_SWEEP = ("src/pinnedClock.test.ts", "every render pins its clock")
T_FLOOR_COMPONENTS = ("src/pinnedClock.test.ts", "finds the clock-taking components by signature")
T_FLOOR_RENDERS = ("src/pinnedClock.test.ts", "finds renders of them in the test tree")
T_PREDICATE = ("src/pinnedClock.test.ts", "tells a pinned render from an unpinned one")
T_HELD = ("src/areas/lens/Held.test.tsx", "")
T_LXC = ("src/areas/lens/lxcSplitCoverage.test.tsx", "")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(target) -> bool:
    f, name = target
    cmd = ["npx", "vitest", "run", f] + (["-t", name] if name else [])
    return subprocess.run(cmd, cwd=WEB, capture_output=True, text=True).returncode == 0


def control(cid, desc, path, old, new, must_red, must_green, expect_count=1):
    src = path.read_text(encoding="utf-8")
    n = src.count(old)
    if n != expect_count:
        print(f"  {cid}  ✗ ANCHOR DEAD — {path.relative_to(REPO)} holds the anchor {n}×, expected {expect_count}")
        return False
    before = sha(path)
    path.write_text(src.replace(old, new, expect_count), encoding="utf-8")
    if sha(path) == before:
        print(f"  {cid}  ✗ THE WRITE CHANGED NOTHING")
        return False
    try:
        red = not run(must_red)
        green = run(must_green)
    finally:
        path.write_text(src, encoding="utf-8")
        assert sha(path) == before, f"{cid}: RESTORE FAILED on {path}"
    verdict, ok = (
        ("CAUGHT", True) if red and green
        else ("SUSPECT (companion also red — breaks the build, does not probe)", False) if red
        else ("NOT CAUGHT ⚠ THE GUARD IS BLIND TO THIS", False)
    )
    print(f"  {cid}  {verdict}\n      {desc}")
    print(f"      must-red   {must_red[1] or must_red[0]!r} → {'RED' if red else 'GREEN'}")
    print(f"      must-green {must_green[1] or must_green[0]!r} → {'GREEN' if green else 'RED'}")
    return ok


def main():
    print("W1.1.0 sidecar — PINNED CLOCK POSITIVE CONTROLS (tab-q4vn)\n")
    r = []

    r.append(control(
        "C1", "the detonated bomb is re-armed — lxcSplitCoverage renders Overview unpinned again",
        LXC, "<Overview now={NOW} />", "<Overview />",
        must_red=T_SWEEP, must_green=T_HELD,
    ))

    r.append(control(
        "C2", "the LATENT bomb is re-armed — Held renders Overview unpinned again",
        HELD, "<Overview now={NOW} />", "<Overview />",
        must_red=T_SWEEP, must_green=T_LXC,
    ))

    r.append(control(
        "C3", "⚠ VACUITY — the signature moves, so the DERIVED component set empties. The floor must "
              "speak; a silent empty sweep would report 'every render pins its clock' over nothing.",
        OVERVIEW, "export function Overview({ now = new Date() }", "export function Overview({ now = undefined as unknown as Date }",
        must_red=T_FLOOR_COMPONENTS, must_green=T_PREDICATE,
    ))

    print()
    caught = sum(1 for x in r if x)
    print(f"{caught}/{len(r)} controls CAUGHT")
    print("all mutated files restored and sha256-verified inside each control")
    return 0 if caught == len(r) else 1


if __name__ == "__main__":
    sys.exit(main())
