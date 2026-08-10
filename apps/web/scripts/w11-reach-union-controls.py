#!/usr/bin/env python3
"""POSITIVE CONTROLS for reading BOTH projects' reach shards.

The dangerous failure of a reach instrument is not a wrong answer, it is an EMPTY one: a hook
installed after react-dom, a globalSetup that stopped providing the directory, a flush that never
ran. Every one of those leaves the tests GREEN and makes `registered - committed` empty, which is
the guard's own passing state. So each control below breaks one of them and names, in advance, the
instrument that must speak.

⚠ EVERY REACH CONTROL RE-RUNS BOTH PROJECTS' VITEST BEFORE THE CHECKER. The shards are the
instrument's input; reading last run's would answer a question about a tree that no longer exists,
which is the stale-shard trap reach-global-setup.ts was written for.

Usage:  python3 scripts/w11-reach-union-controls.py
"""
import filecmp
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps/web"
UI = ROOT / "packages/ui"

SETUP = UI / "src/__tests__/setup.ts"
CONFIG = UI / "vitest.config.ts"
REACH = WEB / "scripts/check-audit-reach.mjs"
INDEX = UI / "src/components/index.ts"
MARK = UI / "src/components/Mark.tsx"


def sh(argv, cwd):
    p = subprocess.run(argv, cwd=cwd, capture_output=True, text=True)
    return p.returncode, f"{p.stdout}{p.stderr}"


def reach_check():
    """Both suites, then the checker — the checker's input is written by the suites."""
    for cwd in (UI, WEB):
        code, out = sh(["npx", "vitest", "run"], cwd)
        if code != 0:
            return code, f"[{cwd.name} vitest reddened before the checker ran]\n{out}"
    return sh(["node", "scripts/check-audit-reach.mjs"], WEB)


def ui_suite():
    return sh(["npx", "vitest", "run"], UI)


class Control:
    def __init__(self, name, what, edits, expect, green, inverted=False):
        self.name, self.what, self.edits = name, what, edits
        self.expect, self.green, self.inverted = expect, green, inverted


# The ordering trap, reproduced exactly: something that pulls React in ABOVE the hook install.
PULL_REACT_FIRST = (
    SETUP,
    "// ⚠ reachAudit MUST BE FIRST, ABOVE EVERY OTHER IMPORT IN THIS FILE.",
    "import '../index'\n// ⚠ reachAudit MUST BE FIRST, ABOVE EVERY OTHER IMPORT IN THIS FILE.",
)

# The floor asked of the UNION instead of the source — the arrangement this merge argues against.
FLOOR_ON_UNION = (
    REACH,
    "  for (const name of source.mustCommit) {\n    if (!here.committed.has(name)) {",
    "  for (const name of source.mustCommit) {\n    if (!committed.has(name) && !here.committed.has(name)) {",
)

# The ui floor narrowed to a component apps/web also commits — see R4.
UI_FLOOR_SHARED_ONLY = (
    REACH,
    "    mustCommit: ['packages/ui#Button', 'packages/ui#HoldBar', 'packages/ui#FixtureNotice'],",
    "    mustCommit: ['packages/ui#Button'],",
)

CONTROLS = [
    Control(
        "R1 packages/ui's DevTools hook installed after react-dom",
        "one import of '../index' above the hook — the documented ordering trap, which leaves the "
        "suite GREEN and records nothing",
        [PULL_REACT_FIRST],
        "was registered by packages/ui but never recorded as committed",
        ui_suite,
    ),
    Control(
        "R2 the flush deleted",
        "flushReach(inject('reachDir')) removed — workers record and never write",
        [(SETUP, "  flushReach(inject('reachDir'))\n", "")],
        "packages/ui/.reach does not exist",
        ui_suite,
    ),
    Control(
        "R3 packages/ui's globalSetup unwired",
        "the directory is never provided and never cleared",
        [(CONFIG, "    globalSetup: ['./src/__tests__/reach-global-setup.ts'],\n", "")],
        None,  # predicted: packages/ui's own suite reds — see verdict()
        None,
    ),
    # ⚠ R4 WAS WRONG TWICE, AND WHAT IT TOOK TO MAKE IT TRUE IS THE RESULT WORTH KEEPING.
    #
    # v1 asserted that with packages/ui's half dead AND the floor asked of the union, the checker
    # would PASS. It does not: emptying the classification table left HoldBar and FixtureNotice
    # uncovered, so UNAUDITED fires. v2 asserted the FLOOR line would then be absent. It is not:
    # packages/ui's floor names HoldBar and FixtureNotice, which apps/web NEVER commits, so even
    # on the union no live half can vouch for them.
    #
    # THAT is the thing to write down: the ui half is unfakeable because its floor literals are
    # components only this project renders, NOT because the loop is per-source. The per-source
    # loop matters for the literals both projects share — Button — and this control isolates
    # exactly that by narrowing the ui floor to Button alone. With the floor on the union the
    # checker then blames the PRODUCT ("HoldBar is exported and NO test renders it", false — a
    # test does) and never names the instrument that recorded nothing.
    Control(
        "R4 the ui-only floor literals are what make the ui half unfakeable",
        "R1's blinding, the floor asked of the union, and the ui floor narrowed to a component "
        "BOTH projects commit — the arrangement in which a live half vouches for a dead one",
        [PULL_REACT_FIRST, FLOOR_ON_UNION, UI_FLOOR_SHARED_ONLY],
        None,  # see verdict(): asserts UNAUDITED present AND the FLOOR line absent
        ui_suite,
        inverted=True,
    ),
    Control(
        "R5 the STALE direction still fires on the union",
        "HoldBar re-listed as unreached — the union must see the render that made it stale",
        [
            (
                REACH,
                "const UNREACHED = {}",
                "const UNREACHED = { 'packages/ui#HoldBar': 'a reason that stopped being true' }",
            )
        ],
        "STALE      packages/ui#HoldBar is listed in UNREACHED but a test now renders it",
        ui_suite,
    ),
    Control(
        "R6 a genuinely unreached component still fails, with the table empty",
        "a new export nothing renders — the guard's primary direction, which an empty UNREACHED "
        "table could otherwise hide",
        [
            (MARK, "export function Mark(", "export function ProbeOnly() {\n  return null\n}\n\nexport function Mark("),
            (INDEX, "export { Mark } from './Mark'", "export { Mark, ProbeOnly } from './Mark'"),
        ],
        "UNAUDITED  packages/ui#ProbeOnly is exported and NO",
        ui_suite,
    ),
]


def apply_edits(edits, backups):
    for path, old, _new in edits:
        n = path.read_text().count(old)
        if n != 1:
            return f"anchor appears {n}x in {path.relative_to(ROOT)} (expected 1)"
    for path, old, new in edits:
        if path not in backups:
            backups[path] = Path(tempfile.mkdtemp()) / path.name
            shutil.copy2(path, backups[path])
        before = path.read_bytes()
        path.write_text(path.read_text().replace(old, new, 1))
        if path.read_bytes() == before:
            return f"bytes on disk unchanged for {path.relative_to(ROOT)}"
    return None


def verdict(c):
    backups = {}
    try:
        problem = apply_edits(c.edits, backups)
        if problem:
            return "INVALID", problem

        if c.name.startswith("R3"):
            code, out = ui_suite()
            if code == 0:
                return "NOT CAUGHT", "packages/ui's suite stayed green with no shard directory"
            return "CAUGHT", f"packages/ui vitest reddened: {out.strip().splitlines()[-1][:160]}"

        code, out = reach_check()
        if c.inverted:
            blamed_product = "UNAUDITED  packages/ui#HoldBar is exported" in out
            named_instrument = "never recorded as committed" in out
            if code != 0 and blamed_product and not named_instrument:
                gcode, gout = c.green()
                if gcode != 0:
                    return "INVALID", f"must-stay-green companion reddened:\n{gout[-600:]}"
                return "CAUGHT", (
                    "with the floor on the union the checker blamed the PRODUCT (HoldBar is "
                    "exported and no test renders it — false) and never named the instrument "
                    "that recorded nothing. Per-source floors restore the true diagnosis."
                )
            return "NOT CAUGHT", (
                f"blamed_product={blamed_product} named_instrument={named_instrument} "
                f"exit={code}\n{out[-600:]}"
            )

        if code == 0:
            return "NOT CAUGHT", f"the reach checker stayed green:\n{out[-600:]}"
        if c.expect not in out:
            return "WRONG CATCH", f"predicted: {c.expect}\ngot:\n{out[-900:]}"
        if c.green is not None:
            gcode, gout = c.green()
            if gcode != 0:
                return "INVALID", f"must-stay-green companion reddened:\n{gout[-600:]}"
        return "CAUGHT", f"reach checker named it: {c.expect}"
    finally:
        for path, backup in backups.items():
            shutil.copy2(backup, path)
            if not filecmp.cmp(backup, path, shallow=False):
                print(f"!! RESTORE FAILED for {path}", file=sys.stderr)


def main():
    before = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True
    ).stdout
    print(f"tree before: {len(before.splitlines())} modified path(s)\n")
    results = []
    only = sys.argv[1] if len(sys.argv) > 1 else ''
    for c in CONTROLS:
        if only and not c.name.startswith(only):
            continue
        print(f"── {c.name}\n   {c.what}")
        v, why = verdict(c)
        print(f"   => {v}: {why}\n")
        results.append((c.name, v))
    after = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True
    ).stdout
    print("── summary")
    for name, v in results:
        print(f"   {v:<11} {name}")
    caught = sum(1 for _, v in results if v == "CAUGHT")
    print(f"\n   {caught}/{len(results)} CAUGHT")
    print(f"   tree after: {len(after.splitlines())} modified path(s) (must equal before)")
    return 0 if caught == len(results) and after == before else 1


if __name__ == "__main__":
    sys.exit(main())
