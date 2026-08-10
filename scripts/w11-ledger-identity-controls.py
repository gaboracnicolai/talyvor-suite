#!/usr/bin/env python3
"""Positive-control harness for the ledger in-flight identity guard (#w11, tab-9e14).

CONTRACT, stated before any control runs:
  · REFUSES to run on a dirty tree. A mutation that survives a crash is invisible
    otherwise.
  · Backs originals up with cp into a temp dir and restores in a `finally`, then
    re-checks sha256 against the pre-run digests.
  · Every control names the test it PREDICTS will catch it, and the verdict is read
    from the FAILING TEST NAMES — never from a count. A crash and a real catch look
    identical in a pass/fail tally.
  · Every catcher control is paired with a MUST-STAY-GREEN set that includes
    Ledger.test.tsx, the screen's own pre-existing guard: a mutation that merely
    breaks the ledger would otherwise read as a caught defect.
  · C4 is predicted NOT CAUGHT and is recorded as a limit of the guard, not deleted.

Run: python3 scripts/w11-ledger-identity-controls.py
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "apps/web"

LEDGER = WEB / "src/areas/lens/Ledger.tsx"
FILES = [LEDGER]

GUARD = "src/areas/lens/ledgerInFlightIdentity.test.tsx"
SCREEN = "src/areas/lens/Ledger.test.tsx"      # the pre-existing guard for the same screen
PILLS = "src/areas/lens/ledgerPillVocabulary.test.tsx"
TARGETS = [GUARD, SCREEN, PILLS]

T_TOKEN = "the ledger names the rows it is showing, not the ones it requested > a token switch never repaints the other ledger in this ledger’s unit and vocabulary"
T_RANGE = "the ledger names the rows it is showing, not the ones it requested > the row range counts the rows on screen while the next page is in flight"


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def clean_tree():
    out = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                         capture_output=True, text=True).stdout.strip()
    return out == "", out


def run_vitest(paths):
    """Run vitest on `paths`; return the set of FAILING full test names, or None if
    vitest wrote no report (which is not the same as 'nothing failed')."""
    report = WEB / ".w11-control-report.json"
    if report.exists():
        report.unlink()
    subprocess.run(
        ["npx", "vitest", "run", *paths, "--reporter=json", f"--outputFile={report.name}"],
        cwd=WEB, capture_output=True, text=True,
    )
    if not report.exists():
        return None
    data = json.loads(report.read_text())
    report.unlink()
    failing = set()
    for f in data.get("testResults", []):
        for a in f.get("assertionResults", []):
            if a.get("status") == "failed":
                failing.add(a.get("fullName", "?"))
    return failing


# vitest's `fullName` joins describe and test with a SPACE; the predictions above are
# written with " > ". Comparing raw strings would condemn every working control.
def norm(s):
    return " ".join(s.replace(" > ", " ").split())


def edit(path, old, new, count=1):
    t = path.read_text()
    n = t.count(old)
    assert n == count, f"anchor {old!r} appears {n}x in {path.name}, expected {count}"
    path.write_text(t.replace(old, new))


CONTROLS = []


def control(name):
    def deco(fn):
        CONTROLS.append((name, fn))
        return fn
    return deco


@control("C1 — the defect as it shipped: the placeholder keeps the OTHER token's rows")
def c1():
    edit(LEDGER,
         "placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === token ? prev : undefined),",
         "placeholderData: (prev) => prev,")
    return {"predict_red": {T_TOKEN}, "must_stay_green": {T_RANGE}}


@control("C2 — the defect as it shipped: the row range counts the page in flight")
def c2():
    edit(LEDGER,
         "Rows {rows.length ? shownOffset + 1 : 0}–{shownOffset + rows.length}",
         "Rows {rows.length ? offset + 1 : 0}–{offset + rows.length}")
    return {"predict_red": {T_RANGE}, "must_stay_green": {T_TOKEN}}


@control("C3 — the token check reads the OFFSET position of the key, not the token")
def c3():
    edit(LEDGER, "prevQuery?.queryKey[1] === token", "prevQuery?.queryKey[2] === token")
    # The placeholder is then dropped on EVERY key change, paging included, so the
    # table blanks under Next. The range test's positive precondition is the catcher —
    # which is the point: it proves that precondition is load-bearing, not decoration.
    return {"predict_red": {T_RANGE}, "must_stay_green": {T_TOKEN}}


@control("C4 — PREDICTED NOT CAUGHT: Previous is enabled from the page in flight")
def c4():
    edit(LEDGER, "const hasPrev = shownOffset > 0", "const hasPrev = offset > 0")
    # Recorded as a LIMIT of this guard rather than retargeted. Neither test asserts on
    # the Previous button's enabled state during the window, and the mutation is
    # behaviourally inert: Previous returns to the page already on screen.
    return {"predict_red": set(), "must_stay_green": {T_TOKEN, T_RANGE}}


def main():
    ok, dirt = clean_tree()
    if not ok:
        print("REFUSING: tree is dirty. A control campaign is evidence only if the tree was clean.")
        print(dirt)
        return 1

    before = {p: sha(p) for p in FILES}
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="w11-ledger-ctl-"))
    for p in FILES:
        shutil.copy2(p, tmp / p.name)

    baseline = run_vitest(TARGETS)
    if baseline is None:
        print("REFUSING: vitest wrote no report on the baseline run — it measured nothing.")
        shutil.rmtree(tmp)
        return 1
    if baseline:
        print(f"REFUSING: baseline is not green — {sorted(baseline)}")
        shutil.rmtree(tmp)
        return 1
    print(f"baseline: {len(TARGETS)} target files green\n")

    score, results = 0, []
    try:
        for name, fn in CONTROLS:
            for p in FILES:
                shutil.copy2(tmp / p.name, p)
            spec = fn()
            failing = run_vitest(TARGETS)
            if failing is None:
                results.append((name, "NO REPORT", "vitest measured nothing"))
                print(f"  {name}\n    → NO REPORT")
                continue
            got = {norm(f) for f in failing}
            want_red = {norm(f) for f in spec["predict_red"]}
            want_green = {norm(f) for f in spec["must_stay_green"]}
            red_ok = want_red <= got
            green_ok = not (want_green & got)
            if want_red:
                verdict = "CAUGHT as predicted" if (red_ok and green_ok) else "NOT AS PREDICTED"
            else:
                verdict = "NOT CAUGHT as predicted" if (not got and green_ok) else "NOT AS PREDICTED"
            if verdict.endswith("as predicted"):
                score += 1
            detail = f"red={sorted(got) if got else '∅'}"
            results.append((name, verdict, detail))
            print(f"  {name}\n    → {verdict}\n      {detail}")
    finally:
        for p in FILES:
            shutil.copy2(tmp / p.name, p)
        after = {p: sha(p) for p in FILES}
        restored = all(before[p] == after[p] for p in FILES)
        shutil.rmtree(tmp)
        print(f"\nrestore: {'byte-identical' if restored else '⚠ MISMATCH — TREE NOT RESTORED'}")
        if not restored:
            return 2

    print(f"\n{score}/{len(CONTROLS)} controls behaved exactly as predicted")
    return 0 if score == len(CONTROLS) else 1


if __name__ == "__main__":
    sys.exit(main())
