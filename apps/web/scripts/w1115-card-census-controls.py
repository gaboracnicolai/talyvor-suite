#!/usr/bin/env python3
"""Positive controls for the CARD_HEADER_CENSUS guard in CardHeaderHeading.test.tsx (suite W1.1.15).

The guard replaces a REMEMBERED number with a MEASURED one: a per-address census constant that a
test compares against the real `<App/>` at every CONSOLE_ROUTES address. The number it replaces
("MEASURED: 20 card headers") was wrong the day it was written — the same instrument run at
`b17a6ac`, the commit that wrote it, reads 24 — and then drifted again when #251 added a fourth
card header to /spend. So the thing under control here is not the count, it is whether the
comparison can fail at all, and in which direction.

  · the CENSUS side   (C1, C2)  — a stale row and a real product change must BOTH red, and must
                                  name the address, so "the note is wrong" and "the screen
                                  changed" arrive as the same actionable message
  · COMPLETENESS      (C3, C4)  — a route with no row, and a row with no route. A census whose
                                  population silently shrinks is the failure this repo keeps
                                  finding; a total that still "reads right" over fewer pages is
                                  exactly that shape
  · the INSTRUMENT    (C5)      — blind the selector: BOTH the census and the independent floor
                                  must red. If only one does, they are not independent
  · the FLOOR         (C6)      — it is a separate assertion and must survive a census that is
                                  merely wrong, and fire when the sweep finds (almost) nothing

C0 is the must-stay-green: the tree exactly as it will be merged.

⚠ The floor `toBeGreaterThan(15)` is NOT changed by this work and NOT mutated except by blinding
the selector — a threshold is not a session's to move.

Usage: python3 apps/web/scripts/w1115-card-census-controls.py [--only C3]
"""

import os
import subprocess
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(WEB))
GUARD = "src/CardHeaderHeading.test.tsx"
APP = "src/App.tsx"
SPEND = "src/areas/lens/Spend.tsx"
TOUCHED = [GUARD, APP, SPEND]

TEST_CMD = ["npx", "vitest", "run", GUARD, "--reporter=basic"]

CENSUS_TEST = "the census is the number"
FLOOR_TEST = "the sweep actually reaches card headers"


def read(rel):
    with open(os.path.join(WEB, rel), encoding="utf-8") as fh:
        return fh.read()


def write(rel, text):
    with open(os.path.join(WEB, rel), "w", encoding="utf-8") as fh:
        fh.write(text)


def sub_once(rel, old, new):
    """Replace exactly once, or abort. A mutation that matched nothing yields a control that
    'passed' while changing no code — measured, this harness's sibling for W1.1.14 hit exactly
    that when a repair made two sites read alike."""
    text = read(rel)
    if text.count(old) != 1:
        raise SystemExit(f"MUTATION ANCHOR NOT UNIQUE in {rel}: {text.count(old)} matches for {old!r}")
    write(rel, text.replace(old, new, 1))


def run_tests():
    proc = subprocess.run(TEST_CMD, cwd=WEB, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


CONTROLS = []


def control(cid, desc, expect, green=False):
    def deco(fn):
        CONTROLS.append((cid, desc, fn, expect, green))
        return fn

    return deco


@control("C0", "no mutation — the tree as it will be merged", [], green=True)
def c0():
    pass


@control(
    "C1",
    "restore the STALE row: declare /spend as 3, the number the note carried",
    [
        "/spend renders 4 card headers; CARD_HEADER_CENSUS says 3",
        CENSUS_TEST,
    ],
)
def c1():
    sub_once(GUARD, "  '/spend': 4,", "  '/spend': 3,")


@control(
    "C2",
    "change the PRODUCT instead: remove FeatureSpendCard from /spend",
    [
        "/spend renders 3 card headers; CARD_HEADER_CENSUS says 4",
        CENSUS_TEST,
    ],
)
def c2():
    sub_once(SPEND, "<FeatureSpendCard days={days} />", "<></>")


@control(
    "C3",
    "a census row that CONSOLE_ROUTES has no address for",
    [
        "describe different address sets",
        CENSUS_TEST,
    ],
)
def c3():
    sub_once(GUARD, "  '/docs': 1,", "  '/docs': 1,\n  '/no-such-address': 3,")


@control(
    "C4",
    "an address with NO census row — the population silently shrinking",
    [
        "describe different address sets",
        CENSUS_TEST,
    ],
)
def c4():
    sub_once(GUARD, "  '/members': 1,\n", "")


@control(
    "C5",
    "blind the selector — the census AND the independent floor must both red",
    [
        CENSUS_TEST,
        "the card-header selector matched (almost) nothing",
    ],
)
def c5():
    sub_once(
        GUARD,
        "return Array.from(root.querySelectorAll('div.border-b.border-rule > .text-head'))",
        "return Array.from(root.querySelectorAll('div.zz-no-such-class > .zz-no-such-child'))",
    )


@control(
    "C6",
    "the floor survives a census that is merely WRONG — C1's mutation must not red the floor",
    [],
)
def c6():
    # Same mutation as C1. The expectation is checked specially below: the census test must fail
    # and the FLOOR test must not, or the two instruments are the same instrument twice.
    sub_once(GUARD, "  '/spend': 4,", "  '/spend': 3,")


def floor_failed(out):
    return "the card-header selector matched (almost) nothing" in out


def main():
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    originals = {rel: read(rel) for rel in TOUCHED}
    results = []
    try:
        for cid, desc, mutate, expect, green in CONTROLS:
            if only and cid != only:
                continue
            for rel, text in originals.items():
                write(rel, text)
            mutate()
            code, out = run_tests()
            if green:
                ok = code == 0
                detail = "GREEN" if ok else "NOT GREEN — baseline broken, every red below is untrustworthy"
            elif cid == "C6":
                census_red = "CARD_HEADER_CENSUS says 3" in out
                ok = code != 0 and census_red and not floor_failed(out)
                if not census_red:
                    detail = "the census did not red — C6 cannot say anything about the floor"
                elif floor_failed(out):
                    detail = "THE FLOOR ALSO RED — it is not independent of the census after all"
                else:
                    detail = "census red, floor still green — the two instruments are independent"
            else:
                missing = [e for e in expect if e not in out]
                ok = code != 0 and not missing
                if code == 0:
                    detail = "DID NOT FAIL — the assertion this control targets cannot fail"
                elif missing:
                    detail = "failed for the WRONG REASON; missing: " + " | ".join(repr(m) for m in missing)
                else:
                    detail = "red, for the predicted reason"
            results.append((cid, ok, desc, detail))
            print(f"[{'ok ' if ok else 'BAD'}] {cid}: {desc}\n        {detail}", flush=True)
    finally:
        for rel, text in originals.items():
            write(rel, text)

    bad = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(bad)}/{len(results)} controls behaved as predicted")
    if bad:
        for cid, _, desc, detail in bad:
            print(f"  ✗ {cid} {desc}: {detail}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
