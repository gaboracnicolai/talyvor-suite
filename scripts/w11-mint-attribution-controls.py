#!/usr/bin/env python3
"""Positive-control harness for the mint-attribution guard (#w11, tab-3c58).

CONTRACT, stated before any control runs:
  · REFUSES to run on a dirty tree. A mutation that survives a crash is invisible
    otherwise, and one did survive a prior campaign in this repo (SIGPIPE from `head`
    killed the shell before its EXIT trap).
  · Backs originals up with cp into a temp dir and restores in a `finally`, then
    re-checks sha256 against the pre-run digests. A crash between mutate and restore
    is what leaves a blinded guard in the tree.
  · Every control names the test it PREDICTS will catch it. The verdict is read from
    the FAILING TEST NAMES, never from a count: a crash and a real catch look identical
    in a pass/fail tally.
  · Every catcher control is paired with a must-stay-green so a control that merely
    breaks the build cannot read as a caught mutation.

Run: python3 scripts/w11-mint-attribution-controls.py
"""
import hashlib
import json
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "apps/web"
GUARD = "src/areas/lens/mintAttribution.test.tsx"

SPEND = ROOT / "apps/web/src/areas/lens/Spend.tsx"
OVERVIEW = ROOT / "apps/web/src/areas/lens/Overview.tsx"
TEST = ROOT / "apps/web/src/areas/lens/mintAttribution.test.tsx"
TRACK_FORMAT = ROOT / "apps/web/src/areas/track/format.ts"

FILES = [SPEND, OVERVIEW, TEST, TRACK_FORMAT]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def clean_tree():
    out = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                         capture_output=True, text=True).stdout.strip()
    return out == "", out


def run_vitest(paths):
    """Run vitest on `paths` and return the set of FAILING test names (full titles)."""
    report = WEB / ".w11-control-report.json"
    if report.exists():
        report.unlink()
    subprocess.run(
        ["npx", "vitest", "run", *paths, "--reporter=json", f"--outputFile={report.name}"],
        cwd=WEB, capture_output=True, text=True,
    )
    if not report.exists():
        # A vitest that never wrote a report did not measure anything. An empty
        # failure set here would read exactly like "nothing failed".
        return None
    data = json.loads(report.read_text())
    report.unlink()
    failing = set()
    for f in data.get("testResults", []):
        for a in f.get("assertionResults", []):
            if a.get("status") == "failed":
                failing.add(a.get("fullName", "?"))
    return failing


def edit(path, old, new, count=1):
    t = path.read_text()
    n = t.count(old)
    assert n == count, f"anchor {old!r} appears {n}x in {path.name}, expected {count}"
    path.write_text(t.replace(old, new))


# (name, what it does, the test it must red, and what must stay green)
CONTROLS = []


def control(name):
    def deco(fn):
        CONTROLS.append((name, fn))
        return fn
    return deco


@control("C1 — the defect exactly as it shipped (both screens, one predicate)")
def c1():
    edit(SPEND, "{agg.length === 0 && windowRows.length > 0 ? (", "{false ? (")
    edit(OVERVIEW, ") : agg.length === 0 && windowRows.length > 0 ? (", ") : false ? (")
    return {
        "predict_red": {
            "/spend — an unattributable window is not an empty one > does NOT claim the window holds no ledger rows when it holds three",
            'the console landing screen — "No earnings yet" under a non-zero Lifetime earned > does NOT say the workspace has no earnings while showing the LENS it earned',
        },
        "must_stay_green": {
            "/spend — an unattributable window is not an empty one > MUST STAY GREEN — an actually empty window still says the window is empty",
            'the console landing screen — "No earnings yet" under a non-zero Lifetime earned > MUST STAY GREEN — a workspace with an empty mint ledger still reads "No earnings yet"',
        },
    }


@control("C2 — Spend only: the new branch swallows the genuinely empty window")
def c2():
    edit(SPEND, "{agg.length === 0 && windowRows.length > 0 ? (", "{agg.length === 0 && windowRows.length >= 0 ? (")
    return {
        "predict_red": {
            "/spend — an unattributable window is not an empty one > MUST STAY GREEN — an actually empty window still says the window is empty",
        },
        "must_stay_green": {
            "/spend — an unattributable window is not an empty one > does NOT claim the window holds no ledger rows when it holds three",
            'the console landing screen — "No earnings yet" under a non-zero Lifetime earned > MUST STAY GREEN — a workspace with an empty mint ledger still reads "No earnings yet"',
        },
    }


@control("C3 — Overview only: its branch removed, Spend's left alone")
def c3():
    edit(OVERVIEW, ") : agg.length === 0 && windowRows.length > 0 ? (", ") : false ? (")
    return {
        "predict_red": {
            'the console landing screen — "No earnings yet" under a non-zero Lifetime earned > does NOT say the workspace has no earnings while showing the LENS it earned',
        },
        "must_stay_green": {
            "/spend — an unattributable window is not an empty one > does NOT claim the window holds no ledger rows when it holds three",
        },
    }


@control("C4 — the count printed from the wrong set (agg.length, which is 0 here)")
def c4():
    edit(SPEND, "{windowRows.length} ledger row{windowRows.length === 1 ? '' : 's'} landed in this",
         "{agg.length} ledger row{windowRows.length === 1 ? '' : 's'} landed in this")
    return {
        "predict_red": {
            "/spend — an unattributable window is not an empty one > does NOT claim the window holds no ledger rows when it holds three",
        },
        "must_stay_green": {
            'the console landing screen — "No earnings yet" under a non-zero Lifetime earned > does NOT say the workspace has no earnings while showing the LENS it earned',
        },
        "note": "only the COUNT assertion can see this — the branch and the testid are unchanged",
    }


@control("C5 — the control on MY OWN FIXTURE: the settled row starts carrying model_used")
def c5():
    edit(TEST, "metadata: { request_id: `rq-${i}`, traffic_hold: true },",
         "metadata: { request_id: `rq-${i}`, traffic_hold: true, model_used: 'x' },")
    return {
        "predict_red": {
            "/spend — an unattributable window is not an empty one > does NOT claim the window holds no ledger rows when it holds three",
            'the console landing screen — "No earnings yet" under a non-zero Lifetime earned > does NOT say the workspace has no earnings while showing the LENS it earned',
        },
        "must_stay_green": {
            "/spend — an unattributable window is not an empty one > MUST STAY GREEN — rows that DO carry model_used still render the split",
        },
        "note": "proves the two catchers turn on the metadata key of the fixture and nothing else",
    }


@control("C6 — SCOPE: an unrelated product change reds other files and not this guard")
def c6():
    edit(TRACK_FORMAT, "  3: 'Medium',", "  3: 'Med',")
    return {
        "predict_red": set(),
        "must_stay_green": {
            "/spend — an unattributable window is not an empty one > does NOT claim the window holds no ledger rows when it holds three",
            'the console landing screen — "No earnings yet" under a non-zero Lifetime earned > does NOT say the workspace has no earnings while showing the LENS it earned',
        },
        "scope_check": ["src/areas/track"],
    }


def main():
    for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGPIPE):
        signal.signal(s, signal.SIG_DFL)

    ok, dirt = clean_tree()
    if not ok:
        print("REFUSING: tree is dirty. A surviving mutation would be invisible.\n" + dirt)
        return 2

    digests = {p: sha(p) for p in FILES}
    backup = pathlib.Path(tempfile.mkdtemp(prefix="w11-controls-"))
    for p in FILES:
        shutil.copy2(p, backup / p.name)

    results = []
    try:
        base = run_vitest([GUARD])
        assert base is not None, "baseline produced no report"
        print(f"BASELINE: {len(base)} failing — {sorted(base) if base else 'all green'}")
        if base:
            return 3

        for name, fn in CONTROLS:
            spec = fn()
            targets = [GUARD] + spec.get("scope_check", [])
            failing = run_vitest(targets)
            for p in FILES:  # restore before judging, so a judge crash cannot leave a mutation
                shutil.copy2(backup / p.name, p)
            if failing is None:
                results.append((name, "NO REPORT", "the runner produced nothing — not a verdict"))
                continue
            pred = spec["predict_red"]
            green = spec["must_stay_green"]
            guard_failing = {f for f in failing if "unattributable window" in f or "No earnings yet" in f
                             or "empty mint ledger" in f or "model_used" in f}
            caught = pred <= guard_failing
            greens_held = not (green & failing)
            scope_red = failing - guard_failing
            verdict = "AS PREDICTED" if (caught and greens_held) else "NOT AS PREDICTED"
            results.append((name, verdict, {
                "predicted_red": sorted(pred),
                "actually_red_in_guard": sorted(guard_failing),
                "must_stay_green_held": greens_held,
                "red_outside_the_guard": sorted(scope_red),
                "note": spec.get("note", ""),
            }))
            print(f"\n{name}\n  {verdict}")
            for k, v in results[-1][2].items():
                if v not in ("", [], set()):
                    print(f"    {k}: {v}")
    finally:
        for p in FILES:
            shutil.copy2(backup / p.name, p)
        bad = [p.name for p in FILES if sha(p) != digests[p]]
        print("\nRESTORE:", "sha256 identical on all four files" if not bad else f"⚠ MISMATCH {bad}")
        shutil.rmtree(backup, ignore_errors=True)

    n_ok = sum(1 for _, v, _ in results if v == "AS PREDICTED")
    print(f"\n{n_ok}/{len(results)} controls as predicted")
    return 0 if n_ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
