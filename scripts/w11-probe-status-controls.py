#!/usr/bin/env python3
"""Positive-control harness for the product-probe status guard (#w11, tab-9e14).

CONTRACT, stated before any control runs:
  · REFUSES to run on a dirty tree.
  · cp backup, restore in a `finally`, sha256 re-checked after.
  · Every control names the test it PREDICTS will catch it; the verdict is read from the
    FAILING TEST NAMES, never from a count.
  · The must-stay-green set always includes the PRE-EXISTING 503 test, which is what stops a
    mutation that merely breaks the strip from reading as a caught defect.
  · C4 is predicted NOT CAUGHT and is recorded as a limit of the guard, not deleted.

Run: python3 scripts/w11-probe-status-controls.py
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

OVERVIEW = WEB / "src/areas/lens/Overview.tsx"
FILES = [OVERVIEW]

TARGETS = [
    "src/areas/lens/Overview.test.tsx",
    "src/SessionExpired.test.tsx",      # the 401/500/502/503 separation, independently
]

T_404 = 'the products strip does not read a 404 as a deployment fact > a 404 from a running product surfaces as a fault, never as "Not configured"'
T_200 = "the products strip does not read a 404 as a deployment fact > a 200 still reads Configured on both — the fault path did not swallow the good one"
T_503 = 'the products strip reads unconfigured as calm state > Track and Docs at 503 show "Not configured", never an error'


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def clean_tree():
    out = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                         capture_output=True, text=True).stdout.strip()
    return out == "", out


def run_vitest(paths):
    report = WEB / ".w11-probe-report.json"
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
    return {a.get("fullName", "?")
            for f in data.get("testResults", [])
            for a in f.get("assertionResults", [])
            if a.get("status") == "failed"}


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


@control("C1 — the defect as it shipped: 404 classified as 'not wired'")
def c1():
    edit(OVERVIEW, "const off = isUnconfigured(q.error);",
         "const off = isUnconfigured(q.error) || (q.error instanceof ApiError && q.error.status === 404);")
    return {"predict_red": {T_404}, "must_stay_green": {T_200, T_503}}


@control("C2 — the calm state removed entirely: every refusal becomes a fault")
def c2():
    edit(OVERVIEW, "const off = isUnconfigured(q.error);", "const off = false;")
    # The PRE-EXISTING 503 test is the catcher. That is the point of including it: it proves
    # the calm state is protected by something other than the test written for this finding.
    return {"predict_red": {T_503}, "must_stay_green": {T_404, T_200}}


@control("C3 — a reachable product rendered as not configured")
def c3():
    edit(OVERVIEW, "        <StateMark state=\"on\" />\n      )}\n    </Row>\n  );",
         "        <StateMark state=\"off\" />\n      )}\n    </Row>\n  );")
    return {"predict_red": {T_200}, "must_stay_green": {T_404}}


@control("C4 — PREDICTED NOT CAUGHT: the hint stops naming the cause")
def c4():
    edit(OVERVIEW,
         'hint={off ? "Not configured on this BFF deployment." : hint}',
         'hint={hint}')
    # Recorded as a LIMIT, not retargeted. The 404 test asserts that hint's ABSENCE, and the
    # pre-existing 503 test asserts the MARK, not the hint — so nothing pins the hint's
    # PRESENCE. Low severity: the row still reads "Not configured", it just stops saying where.
    return {"predict_red": set(), "must_stay_green": {T_404, T_200, T_503}}


def main():
    ok, dirt = clean_tree()
    if not ok:
        print("REFUSING: tree is dirty.")
        print(dirt)
        return 1

    before = {p: sha(p) for p in FILES}
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="w11-probe-ctl-"))
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

    score = 0
    try:
        for name, fn in CONTROLS:
            for p in FILES:
                shutil.copy2(tmp / p.name, p)
            spec = fn()
            failing = run_vitest(TARGETS)
            if failing is None:
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
            print(f"  {name}\n    → {verdict}\n      red={sorted(got) if got else '∅'}")
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
