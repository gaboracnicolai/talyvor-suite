#!/usr/bin/env python3
"""Positive controls for src/timerCleanup.test.tsx (suite W1.1.15b).

The guard exists because an uncancelled 1500ms timer in `Setup.tsx` fired into a torn-down jsdom
and reddened a CI run in which all 1741 tests PASSED. It has four cases, and every one of them is
green at the merge — so without this harness none of them has ever been observed to fail, which is
the same evidential position as having no guard.

Three of the controls target the guard's own repairs rather than the product, because each was a
place this guard had already been wrong once:

  · C3 — the POPULATION BOUNDARY. The first walk covered apps/web/src alone and reported a clean
    codebase; `RevealOnce.tsx` in packages/ui carried the identical defect, outside the walk.
  · C6 — the COMMENT STRIPPER. The first scan named `caseAudit.ts` on the strength of prose in a
    `//` comment. An over-eager stripper would hide real calls instead.
  · C7 — the FIRED-vs-PENDING distinction. The first instrument never retired a timer that had
    already run, so React's two 0ms timers counted as leaks forever.

Usage: python3 apps/web/scripts/w1115b-timer-controls.py [--only C3]
"""

import os
import subprocess
import sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = "src/timerCleanup.test.tsx"
SETUP = "src/areas/lens/Setup.tsx"
BILLING = "src/areas/lens/BillingReturn.tsx"
REVEAL = "../../packages/ui/src/components/RevealOnce.tsx"
TOUCHED = [GUARD, SETUP, BILLING, REVEAL]

TEST_CMD = ["npx", "vitest", "run", GUARD, "--reporter=basic"]

BEHAVIOURAL = "still pending after unmount"
SOURCE = "schedule a timer and never clear one"


def read(rel):
    with open(os.path.join(WEB, rel), encoding="utf-8") as fh:
        return fh.read()


def write(rel, text):
    with open(os.path.join(WEB, rel), "w", encoding="utf-8") as fh:
        fh.write(text)


def sub_once(rel, old, new):
    text = read(rel)
    if text.count(old) != 1:
        raise SystemExit(f"MUTATION ANCHOR NOT UNIQUE in {rel}: {text.count(old)} matches for {old!r}")
    write(rel, text.replace(old, new, 1))


def run_tests():
    p = subprocess.run(TEST_CMD, cwd=WEB, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


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
    "revert the Setup.tsx cleanup — the defect that reddened CI",
    [BEHAVIOURAL, SOURCE, "areas/lens/Setup.tsx"],
)
def c1():
    sub_once(SETUP, "  useEffect(() => () => window.clearTimeout(resetTimer.current), [])\n", "")


@control(
    "C2",
    "revert the RevealOnce cleanup — the instance the first census could not see",
    [SOURCE, "packages/ui/src/components/RevealOnce.tsx"],
)
def c2():
    sub_once(REVEAL, "  useEffect(() => () => window.clearTimeout(resetTimer.current), [])\n", "")


@control(
    "C3",
    "narrow the walk back to apps/web/src — the boundary that hid RevealOnce",
    ["the walk reached no packages/ui file"],
)
def c3():
    sub_once(GUARD, "const files = [...walk(SRC), ...walk(UI_SRC)]", "const files = [...walk(SRC)]")


@control(
    "C4",
    "blind the scan — the floor must fire rather than report a clean codebase",
    ["expected at least the THREE known timer sites"],
)
def c4():
    sub_once(
        GUARD,
        "const sets = src.match(/(?<![A-Za-z.])(?:window\\.)?set(?:Timeout|Interval)\\(/g) ?? []",
        "const sets = src.match(/zzz_no_such_call_zzz/g) ?? []",
    )


@control(
    "C5",
    "remove BillingReturn's cleanup — the site that is CORRECT today must be able to red",
    [SOURCE, "BillingReturn.tsx", "the model is gone"],
)
def c5():
    sub_once(BILLING, "    return () => clearTimeout(t)\n", "")


@control(
    "C8",
    "accept ANY clearTimeout as a cleanup — the weaker test this guard shipped first",
    ["cleanupRE recognises a RETURNED cleanup"],
)
def c8():
    # The exact regex the first version used, plus deleting Setup's unmount cleanup.
    #
    # ⚠ THE PREDICTION HERE WAS WRONG THE FIRST TIME AND THE CORRECTION IS THE POINT. I predicted
    # the POPULATION SCAN would red naming Setup.tsx. It does not — under the weak rule the
    # in-handler `window.clearTimeout(resetTimer.current)` satisfies the file, exactly as it did
    # when C1 and C2 both passed against a deleted cleanup. What reds is the guard's own
    # `cleanupRE` case, which asserts that line is NOT a cleanup. So the thing standing between
    # this repo and a silently-inert scan is the in-file control, not the scan — and that is only
    # knowable because the control was run and its prediction was checked rather than assumed.
    sub_once(
        GUARD,
        "const cleanupRE = /(?:return|=>)\\s*\\(\\s*\\)\\s*=>[^\\n]*clear(?:Timeout|Interval)\\(/",
        "const cleanupRE = /(?<![A-Za-z.])(?:window\\.)?clear(?:Timeout|Interval)\\(/",
    )
    sub_once(SETUP, "  useEffect(() => () => window.clearTimeout(resetTimer.current), [])\n", "")


@control(
    "C6",
    "make stripComments eat everything — an over-eager stripper hides real calls",
    ["stripComments keeps the scanner from accusing prose"],
)
def c6():
    sub_once(
        GUARD,
        "  return src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/(^|[^:])\\/\\/[^\\n]*/g, '$1')",
        "  return ''",
    )


@control(
    "C7",
    "stop retiring FIRED timers — React's 0ms timers must not be reported as leaks",
    [BEHAVIOURAL],
)
def c7():
    sub_once(
        GUARD,
        """      const held: { id?: unknown } = {}
      const wrapped = () => {
        scheduled.delete(held.id)
        ;(fn as () => void)()
      }
      held.id = realSet(wrapped, ms, ...rest)""",
        """      const held: { id?: unknown } = { id: realSet(fn as () => void, ms, ...rest) }""",
    )


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
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
    for cid, _, desc, detail in bad:
        print(f"  ✗ {cid} {desc}: {detail}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
