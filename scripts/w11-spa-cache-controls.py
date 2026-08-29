#!/usr/bin/env python3
"""
w11-spa-cache-controls.py — the positive controls for apps/bff/spa_cache_test.go.

Every control names, BEFORE the run, the exact tests it expects to red and the exact tests it
expects to stay green. A control with no must-stay-green companion is not a control: a compile
error reds the whole package and reads as six catches.

⚠ A PANIC OR A COMPILE ERROR KILLS THE PACKAGE BINARY AND PRINTS NO PASS LINES, so this harness
runs with `-run` scoped to these five tests and `-v` (go test prints no PASS line without it) and
treats "no test results at all" as BROKEN rather than as a catch.

THE PAIR THAT SHAPED THE GUARD: `/` and `/version.json` leave spaHandler by DIFFERENT returns —
`/` resolves to the dist directory and goes out through the index fallback, `/version.json` is an
existing file and goes out through the FileServer branch. C2 and C3 mutate one branch each and
each must leave the other's test green. One test over both paths would have scored a half-applied
fix as complete.

Restore is from a byte copy taken before anything is written, not from git.
"""
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BFF = ROOT / "apps/bff"
LENS = BFF / "lens.go"

ENTRY = ["TestEntryPointMustRevalidate"]
VERSION = ["TestVersionJSONMustRevalidate"]
ROUTES = ["TestClientRoutesMustRevalidate"]
HASHED = ["TestHashedAssetsAreNotGivenAFreshnessRuleHere"]
INSTRUMENT = ["TestBundleInstrument"]
EVERYTHING = INSTRUMENT + ENTRY + VERSION + ROUTES + HASHED
RUN = "^(" + "|".join(EVERYTHING) + ")$"

DIRECT_BRANCH = """		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			if isUnhashedBundleFile(clean) {
				setMustRevalidate(w)
			}
			fs.ServeHTTP(w, r)
			return
		}
"""
DIRECT_NO_HEADER = """		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
"""
DIRECT_ALWAYS = """		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			setMustRevalidate(w)
			fs.ServeHTTP(w, r)
			return
		}
"""
# ⚠ gofmt ALIGNS THE TRAILING COMMENT ON THIS LINE with the ServeFile call below it, so the
# anchor carries the padding gofmt chose. Spelled from the formatted file, not from the edit.
FALLBACK = "		setMustRevalidate(w)        // the fallback is index.html, which every deploy replaces in place\n"


def greens(*red_lists):
    red = {n for lst in red_lists for n in lst}
    return [n for n in EVERYTHING if n not in red]


CONTROLS = [
    dict(
        name="C1 no freshness header anywhere — the handler exactly as it shipped at 98fe316",
        edits=[(DIRECT_BRANCH, DIRECT_NO_HEADER), (FALLBACK, "")],
        reds=ENTRY + VERSION + ROUTES,
        greens=greens(ENTRY, VERSION, ROUTES),
        why="the shipped defect. The instrument and the hashed-asset case must stay green — they "
            "are what says the bundle is still being served at all",
    ),
    dict(
        name="C2 only the FileServer branch loses the header (a fix applied to the fallback alone)",
        edits=[(DIRECT_BRANCH, DIRECT_NO_HEADER)],
        reds=VERSION,
        greens=greens(VERSION),
        why="THE ONE THAT JUSTIFIES SPLITTING THE TWO FILES. /version.json is the only case that "
            "may move; / and the client routes leave by the other return and must stay green",
    ),
    dict(
        name="C3 only the fallback loses the header (a fix applied to the file branch alone)",
        edits=[(FALLBACK, "")],
        reds=ENTRY + ROUTES,
        greens=greens(ENTRY, ROUTES),
        why="C2's inverse. /version.json must stay green here — if it reds, the two branches are "
            "not being measured separately and a half-applied fix would read as whole",
    ),
    dict(
        name="C4 the header is set to a YEAR of freshness instead of revalidation",
        edits=[('w.Header().Set("Cache-Control", "no-cache")',
                'w.Header().Set("Cache-Control", "max-age=31536000")')],
        reds=ENTRY + VERSION + ROUTES,
        greens=greens(ENTRY, VERSION, ROUTES),
        why="the assertion is on the VALUE, not on 'a Cache-Control exists'. Same red set as C1 "
            "by design — the messages are what distinguish them, and this mutation is strictly "
            "WORSE than the shipped defect rather than equal to it",
    ),
    dict(
        name="C5 INVERTED — the two unhashed names swapped in the map literal",
        edits=[('map[string]bool{"index.html": true, "version.json": true}',
                'map[string]bool{"version.json": true, "index.html": true}')],
        reds=[],
        greens=EVERYTHING,
        why="MUST STAY GREEN. Real bytes change and no behaviour does, so a campaign that reds "
            "here is reporting on its own edits rather than on the product",
    ),
    dict(
        name="C6 every file gets the header, content-hashed assets included",
        edits=[(DIRECT_BRANCH, DIRECT_ALWAYS)],
        reds=HASHED,
        greens=greens(HASHED),
        why="THE INVERSE, and the only thing that makes the hashed-asset case non-vacuous. "
            "Without this run, 'assets are not given a freshness rule here' is a sentence that "
            "passes for a handler which sets nothing at all AND for one that sets everything",
    ),
]


def run_target():
    p = subprocess.run(
        ["go", "test", "-run", RUN, "-v", "."],
        cwd=BFF, capture_output=True, text=True,
    )
    out = p.stdout + p.stderr
    failed, passed = set(), set()
    for line in out.splitlines():
        s = line.strip()
        m = re.match(r"^--- (PASS|FAIL): (\S+)", s)
        if m:
            (passed if m.group(1) == "PASS" else failed).add(m.group(2))
    msgs = [l.strip() for l in out.splitlines()
            if "Cache-Control =" in l or "did not serve" in l or "want it unset" in l]
    return failed, passed, msgs, out



def restore_on_signal(snapshot):
    """Put every snapshotted file back, then die of the signal we were sent.

    A `finally` DOES NOT RUN ON SIGTERM — and until this edit this campaign had no `finally`
    either: it restored `lens.go` on the HAPPY PATH ONLY, so ANY exception inside the control loop
    left a mutated apps/bff/lens.go in the working tree. That is the WORSE half of the shape
    scripts/check-restore-signal-handlers.py watches (rule R6), not the lesser one.

    Measured in talyvor-suite (W1.7, 78c69c8): a 2-minute timeout killed a control mid-mutation and
    left a GATE REMOVED in the tree, with a green suite and a `git status` showing only files the
    session had edited on purpose.

    Re-raising with SIG_DFL keeps the exit status honest. SIGKILL still strands.
    """
    def handler(signum, _frame):
        for path, blob in snapshot.items():
            try:
                path.write_bytes(blob)
            except OSError:
                pass
        sys.stderr.write("\n!! signal %d — restored %d mutated file(s) before exiting\n"
                         % (signum, len(snapshot)))
        signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)

    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(s, handler)


def apply_edits(text, edits):
    for old, new in edits:
        text = text.replace(old, new, 1)
    return text


def main():
    tmp = Path(tempfile.mkdtemp(prefix="w11-spa-cache-ctl-"))
    pristine = tmp / LENS.name
    shutil.copy2(LENS, pristine)
    src0 = LENS.read_text()
    # The `finally` below is the normal path; this is the one a SIGTERM takes. Installed as soon
    # as the pristine bytes exist, which is the first moment a restore is possible.
    restore_on_signal({LENS: src0.encode("utf-8")})

    # ASSERT EVERY ANCHOR BEFORE ANY WRITE. A control with two edits in one file can apply half
    # of itself; every anchor of every control is checked against the pristine text first, and
    # each control's edits are applied to ONE buffer and written ONCE.
    for c in CONTROLS:
        for old, _ in c["edits"]:
            if src0.count(old) != 1:
                print(f"ABORT: {c['name']} — anchor appears {src0.count(old)} times, not once:\n"
                      f"       {old[:90]!r}")
                return 2

    print("BASELINE (no mutation) — every case must be green")
    failed, passed, _, out = run_target()
    if failed or not passed:
        print(f"ABORT: baseline is not clean. failed={sorted(failed)}")
        print(out[-3000:])
        return 2
    if sorted(passed) != sorted(EVERYTHING):
        print(f"ABORT: the predictions do not match the tests that ran.\n"
              f"       named here but did not run: {sorted(set(EVERYTHING) - passed)}\n"
              f"       ran but not named here:     {sorted(passed - set(EVERYTHING))}")
        return 2
    print(f"  {len(passed)} green, 0 red — and all {len(EVERYTHING)} are named in this file\n")

    score = caught = 0
    # ⚠ THE LOOP RESTORED ON THE HAPPY PATH ONLY. Every `shutil.copy2(pristine, LENS)`
    # below sits AFTER the work, so an exception — a timeout, a failed assert, a
    # KeyboardInterrupt — left apps/bff/lens.go MUTATED in the working tree with nothing
    # saying so. The `finally` is the fix for that; the signal handler above is the fix
    # for the case a `finally` cannot reach (rule R6 in check-restore-signal-handlers.py).
    try:
        for c in CONTROLS:
            src = LENS.read_text()
            LENS.write_text(apply_edits(src, c["edits"]))
            assert LENS.read_text() != src, "control did not change the file"
            failed, passed, msgs, out = run_target()
            if not failed and not passed:
                verdict = ("BROKEN — the run produced no test results. A compile error or a panic "
                           "kills the package binary and prints no PASS lines; that is not a catch")
            else:
                want_red = set(c["reds"]) & failed
                want_green_broken = set(c["greens"]) & failed
                ok = len(want_red) == len(c["reds"]) and not want_green_broken
                if ok and not c["reds"]:
                    verdict = "STAYED GREEN AS PREDICTED"
                elif ok:
                    verdict = "CAUGHT by the predicted case"
                else:
                    verdict = "NOT AS PREDICTED"
                    verdict += f"\n      predicted red, did not red: {sorted(set(c['reds']) - want_red)}"
                    verdict += f"\n      predicted green, went red: {sorted(want_green_broken)}"
            print(f"{c['name']}\n   {c['why']}\n   -> {verdict}")
            print(f"      red={sorted(failed)} green={len(passed)}")
            for m in msgs[:2]:
                print(f"      msg: {m[:190]}")
            print()
            if verdict.startswith(("CAUGHT", "STAYED GREEN")):
                score += 1
                if c["reds"]:
                    caught += 1
            shutil.copy2(pristine, LENS)
            assert LENS.read_text() == pristine.read_text(), "restore failed"
    finally:
        shutil.copy2(pristine, LENS)


    assert LENS.read_text() == src0, "lens.go not restored to the tree this campaign started from"
    failed, passed, _, _ = run_target()
    print(f"RESTORED — {len(passed)} green, {len(failed)} red (must be 0 red)")
    print(f"\n{score}/{len(CONTROLS)} controls behaved exactly as predicted "
          f"({caught} reddened a named case, {score - caught} were must-stay-green)")
    return 0 if score == len(CONTROLS) and not failed else 1


if __name__ == "__main__":
    sys.exit(main())
