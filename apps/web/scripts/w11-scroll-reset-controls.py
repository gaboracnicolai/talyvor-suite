#!/usr/bin/env python3
"""
w11-scroll-reset-controls.py — the positive controls for src/scrollReset.test.tsx.

Every control names, BEFORE the run, the exact tests it expects to red and the exact tests it
expects to stay green. A control with no must-stay-green companion is not a control: a syntax
error reds everything and reads as seven catches.

TWO CONTROLS ARE THE REASON THE GUARD HAS THE SHAPE IT HAS:
  · C2 moves the reset from above `<Routes>` into `AppShell`. Every gated address stays green
    and ONLY the /terms → /privacy case reds — that case exists because the public pages are
    siblings of the auth gate, not children of it, and a sweep over the console alone cannot
    see them.
  · C3 deletes the POP exemption. Only the two pop cases may move. The browser's own
    restoration is the half of this that already worked, and a guard that scored a
    scroll-on-every-navigation as correct would have shipped a regression to buy a fix.

C7 IS EXPECTED TO BE INERT AND IS KEPT AS A RECORDED LIMIT, not deleted: `useLayoutEffect` →
`useEffect` is a real behavioural difference (a frame in which the new page is painted at the
old offset) that jsdom cannot see. It is reported separately from the score.

Restore is from a byte copy taken before anything is written, not from git — a control campaign
is evidence only if the tree it started from is provably the tree it ends on.
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
APP = WEB / "src/App.tsx"
TARGET = "src/scrollReset.test.tsx"

PUSH_D = "a push navigation puts the reader at the top of the page they asked for > "
POP_D = "a pop navigation is left to the browser, which restores the offset itself > "
INSTR_D = "the instrument, before it is pointed at the product > "

# The twelve gated addresses, exactly as App.tsx's CONSOLE_ROUTES spells them once the splat is
# stripped — the same derivation the test does, so a thirteenth page appears in both or neither.
GATED_ADDRESSES = [
    "/", "/ledger", "/billing", "/billing/success", "/billing/cancel", "/keys",
    "/setup", "/spend", "/members", "/settings", "/track", "/docs",
]
GATED = [
    PUSH_D + f"{a} → {'/ledger' if a == '/' else '/'}: the top of the document is requested"
    for a in GATED_ADDRESSES
]
PUBLIC = [PUSH_D + "/terms → /privacy, outside the auth gate entirely: the top is requested"]
POP_BACK = [POP_D + "going back does not request the top — measured in Chrome, the browser restores it"]
POP_MOUNT = [POP_D + "a first load is a pop: arriving at a deep address does not scroll the fresh document"]
INSTRUMENT = [
    INSTR_D + "sees a request for the top of the document, with its arguments",
    INSTR_D + "records nothing when nothing asks to scroll",
    INSTR_D + "CANNOT see scroll position: jsdom leaves window.scrollY at 0 whatever is asked of it",
]
ALL_PUSH = GATED + PUBLIC
EVERYTHING = INSTRUMENT + ALL_PUSH + POP_BACK + POP_MOUNT


def greens(*red_lists):
    red = {n for lst in red_lists for n in lst}
    return [n for n in EVERYTHING if n not in red]


MOUNT_IN_APP = """        {/* ABOVE `<Routes>`, NOT INSIDE THE CONSOLE'S SHELL. The legal pages, the two front
            doors and the marketing landing are siblings of the gate, not children of it — a
            reset mounted in `AppShell` would be correct on all twelve gated addresses and
            absent from every page a stranger sees. */}
        <ScrollToTopOnPush />
"""

CONTROLS = [
    dict(
        name="C1 the reset is not mounted at all — the product exactly as it shipped at 088d711",
        edits=[(MOUNT_IN_APP, "")],
        reds=ALL_PUSH + POP_BACK,
        greens=greens(ALL_PUSH, POP_BACK),
        why="the shipped defect. POP_BACK reds through its FLOOR ('the push that sets this case "
            "up did not scroll'), which is the floor doing its job: without it that case would "
            "pass for a product that never scrolls at all",
    ),
    dict(
        name="C2 the reset is mounted INSIDE AppShell, behind the auth gate",
        edits=[
            (MOUNT_IN_APP, ""),
            ("    <Shell\n      sidebar={<Sidebar />}", "    <>\n    <ScrollToTopOnPush />\n    <Shell\n      sidebar={<Sidebar />}"),
            ("    </Shell>\n  )\n}", "    </Shell>\n    </>\n  )\n}"),
        ],
        reds=PUBLIC,
        greens=greens(PUBLIC),
        why="THE ONE THAT JUSTIFIES THE PUBLIC CASE. All twelve gated addresses must stay green "
            "— a campaign that reds them here is measuring the mount point rather than the seam",
    ),
    dict(
        name="C3 the POP exemption is deleted — every navigation jumps to the top",
        edits=[("    if (navigationType === 'POP') return\n", "")],
        reds=POP_BACK + POP_MOUNT,
        greens=greens(POP_BACK, POP_MOUNT),
        why="the regression the obvious fix ships. Back and forward restore the offset in Chrome "
            "today; only these two cases may move, and every push case must stay green",
    ),
    dict(
        name="C4 it scrolls, but not to the top (0, 1)",
        edits=[("window.scrollTo(0, 0)", "window.scrollTo(0, 1)")],
        reds=ALL_PUSH + POP_BACK,
        greens=greens(ALL_PUSH, POP_BACK),
        why="the assertion is on the ARGUMENTS, not on 'scrollTo was called'. Same red set as C1 "
            "by design — read the messages: these say `[[0,1]]`, C1's say `[]`",
    ),
    dict(
        name="C5 INVERTED — the effect's dependencies reordered, same two values",
        edits=[("}, [pathname, navigationType])", "}, [navigationType, pathname])")],
        reds=[],
        greens=EVERYTHING,
        why="MUST STAY GREEN. Real bytes change and no behaviour does, so a campaign that reds "
            "here is reporting on its own edits rather than on the product",
    ),
    dict(
        name="C6 the predicate is inverted — it scrolls ONLY on a pop",
        edits=[("if (navigationType === 'POP') return", "if (navigationType !== 'POP') return")],
        reds=ALL_PUSH + POP_BACK + POP_MOUNT,
        greens=greens(ALL_PUSH, POP_BACK, POP_MOUNT),
        why="C3's inverse, and the reason the two directions are not one assertion. It reds one "
            "case MORE than C1 (the mount case), which is what distinguishes 'wired backwards' "
            "from 'not wired'",
    ),
    dict(
        name="C7 useLayoutEffect → useEffect (EXPECTED INERT — a recorded limit)",
        edits=[("useLayoutEffect(() => {", "useEffect(() => {"),
               ("import { useLayoutEffect } from 'react'", "import { useEffect } from 'react'")],
        reds=[],
        greens=EVERYTHING,
        inert=True,
        why="a REAL behavioural change — the new page can be painted once at the old offset "
            "before the reset lands — that jsdom has no paint to observe. Kept so the limit is "
            "written down rather than discovered later as a surprise",
    ),
]


def run_target():
    p = subprocess.run(
        ["npx", "vitest", "run", TARGET, "--reporter=verbose"],
        cwd=WEB, capture_output=True, text=True,
    )
    out = p.stdout + p.stderr
    failed, passed = set(), set()
    for line in out.splitlines():
        s = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
        m = re.match(r"^[×✗]\s+(?:src/\S+\s+>\s+)?(.+?)(?:\s+\d+ms)?$", s)
        if m:
            failed.add(m.group(1).strip())
            continue
        m = re.match(r"^[✓√]\s+(?:src/\S+\s+>\s+)?(.+?)(?:\s+\d+ms)?$", s)
        if m:
            passed.add(m.group(1).strip())
    msgs = [re.sub(r"\x1b\[[0-9;]*m", "", l).strip()
            for l in out.splitlines() if "AssertionError" in l]
    return failed, passed, msgs, out


def apply_edits(text, edits):
    for old, new in edits:
        text = text.replace(old, new, 1)
    return text


def main():
    tmp = Path(tempfile.mkdtemp(prefix="w11-scroll-ctl-"))
    pristine = tmp / APP.name
    shutil.copy2(APP, pristine)
    src0 = APP.read_text()

    # ASSERT EVERY ANCHOR BEFORE ANY WRITE. A control with two edits in one file can apply half
    # of itself; every anchor of every control is checked against the pristine text first, and
    # each control's edits are applied to ONE buffer and written ONCE.
    for c in CONTROLS:
        for old, _ in c["edits"]:
            if src0.count(old) != 1:
                print(f"ABORT: {c['name']} — anchor appears {src0.count(old)} times, not once:\n"
                      f"       {old[:80]!r}")
                return 2

    # And every prediction must name a case this file actually has, or a typo reads as a catch.
    print("BASELINE (no mutation) — every case must be green")
    failed, passed, _, out = run_target()
    if failed or not passed:
        print(f"ABORT: baseline is not clean. failed={sorted(failed)}")
        print(out[-3000:])
        return 2
    unknown = [n for n in EVERYTHING if n not in passed]
    if unknown or len(passed) != len(EVERYTHING):
        print(f"ABORT: the predictions do not match the cases that ran.\n"
              f"       named here but did not run: {unknown}\n"
              f"       ran but not named here: {sorted(passed - set(EVERYTHING))}")
        return 2
    print(f"  {len(passed)} green, 0 red — and all {len(EVERYTHING)} are named in this file\n")

    score = caught = inert_as_predicted = 0
    for c in CONTROLS:
        src = APP.read_text()
        APP.write_text(apply_edits(src, c["edits"]))
        assert APP.read_text() != src, "control did not change the file"
        failed, passed, msgs, out = run_target()
        if not failed and not passed:
            verdict = "BROKEN — the run produced no test results (a crash is not a catch)"
        else:
            want_red = set(c["reds"]) & failed
            want_green_broken = set(c["greens"]) & failed
            ok = len(want_red) == len(c["reds"]) and not want_green_broken
            if ok and c.get("inert"):
                verdict = "INERT AS PREDICTED — a limit of this instrument, recorded not scored"
            elif ok and not c["reds"]:
                verdict = "STAYED GREEN AS PREDICTED"
            elif ok:
                verdict = "CAUGHT by the predicted case"
            else:
                verdict = "NOT AS PREDICTED"
                verdict += f"\n      predicted red, did not red: {sorted(set(c['reds']) - want_red)}"
                verdict += f"\n      predicted green, went red: {sorted(want_green_broken)}"
        print(f"{c['name']}\n   {c['why']}\n   -> {verdict}")
        print(f"      red={len(failed)} green={len(passed)}")
        for m in msgs[:2]:
            print(f"      msg: {m[:190]}")
        print()
        if verdict.startswith("INERT AS PREDICTED"):
            inert_as_predicted += 1
        elif verdict.startswith(("CAUGHT", "STAYED GREEN")):
            score += 1
            if c["reds"]:
                caught += 1
        shutil.copy2(pristine, APP)
        assert APP.read_text() == pristine.read_text(), "restore failed"

    assert APP.read_text() == src0, "App.tsx not restored to the tree this campaign started from"
    failed, passed, _, _ = run_target()
    print(f"RESTORED — {len(passed)} green, {len(failed)} red (must be 0 red)")
    scored = len(CONTROLS) - inert_as_predicted
    print(f"\n{score}/{scored} controls behaved exactly as predicted "
          f"({caught} reddened a named case, {score - caught} were must-stay-green)")
    print(f"{inert_as_predicted} recorded as INERT, predicted inert before the run")
    return 0 if score == scored and not failed else 1


if __name__ == "__main__":
    sys.exit(main())
