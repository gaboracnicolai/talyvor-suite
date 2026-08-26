#!/usr/bin/env python3
"""Positive controls for W1.7's mountedPatterns() rewrite (apps/bff).

WHAT IS BEING CONTROLLED
    mountedPatterns() is the POPULATION five sweeps are built on. It used to be a regex over
    ONE file's source text while its docstring called that "the pattern the router actually
    mounts". This harness proves the rewrite closed the gap AND isolates WHICH part of the
    rewrite is load-bearing — because "I made it an AST parse" is not by itself a fix.

PREDICTED BEFORE THE RUN.

    K1  a WRITE route mounted through a const          -> REFUSAL + the sweeps red.
                                                          THIS IS THE MEASURED DEFECT: on
                                                          b79320e3 this exact edit left
                                                          `go test ./...` GREEN.
    K2  a route mounted in ANOTHER FILE (track.go)     -> seen now; the write-route gate reds.
                                                          The old regex read lens.go only.
    K3  a route mounted on a DIFFERENT RECEIVER        -> seen now; the write-route gate reds.
                                                          The old regex required `a.mux`.
    K4  COMPOUND, and the most informative arm:
        the refusal downgraded to a silent skip,
        WITH K1's const route on top                   -> NOT CAUGHT. If this is caught, the
                                                          refusal is not what closes the hole
                                                          and this write-up is wrong.
    K5  VOID — a comment reworded in lens.go           -> nothing may catch it.

DISCIPLINE
    - Refuses on a dirty tree or a suite that is not already green.
    - Every mutation asserts it CHANGED THE BYTES; a drifted anchor stops the run.
    - A build failure scores VOID, never CAUGHT.
    - The classifier REFUSES when '--- FAIL:' is present but no test name parses.
    - Restored in a finally; sha256 of every touched file verified identical at the end.
"""
import hashlib
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BFF = os.path.join(ROOT, "apps/bff")
LENS = os.path.join(BFF, "lens.go")
SAME = os.path.join(BFF, "sameorigin_test.go")
TRACK = os.path.join(BFF, "track.go")

KEYS_MOUNT = '\ta.mux.HandleFunc("/api/keys", a.requireTenant(a.handleKeys))'
CONST_MOUNT = ('\tconst shadowRoute = "/api/shadow"\n'
               '\ta.mux.HandleFunc(shadowRoute, a.requireTenant(a.handleKeys))\n'
               + KEYS_MOUNT)
RECEIVER_MOUNT = ('\tsecondMux := a.mux\n'
                  '\tsecondMux.HandleFunc("/api/shadow2", a.requireTenant(a.handleKeys))\n'
                  + KEYS_MOUNT)

REFUSAL = '''	if len(unresolved) > 0 {
		t.Fatalf("mountedPatterns: %d route mount(s) whose pattern is not a string literal, so no "+'''
SILENT_SKIP = '''	if false && len(unresolved) > 0 {
		t.Fatalf("mountedPatterns: %d route mount(s) whose pattern is not a string literal, so no "+'''


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def gotest():
    p = subprocess.run(["go", "test", "-count=1", "-v", "./..."], cwd=BFF,
                       capture_output=True, text=True)
    out = p.stdout + p.stderr
    if "[build failed]" in out or re.search(r"^# ", out, re.M):
        return False, set()
    names = set(re.findall(r"^\s*--- FAIL: (\S+)", out, re.M))
    if "--- FAIL:" in out and not names:
        sys.exit("CLASSIFIER REFUSES: '--- FAIL:' present but no test name parsed.\n" + out[-2500:])
    # keep the most specific names only (a parent reports FAIL when a subtest does)
    names = {n for n in names if not any(o != n and o.startswith(n + "/") for o in names)}
    return True, names


# (label, [(path, anchor, replacement), ...], predicted_nonempty)
MUTATIONS = [
    ("K1  WRITE route via a const", [(LENS, KEYS_MOUNT, CONST_MOUNT)], True),
    ("K2  route mounted in ANOTHER FILE", [
        (TRACK, "package main\n", 'package main\n\nfunc (a *app) w17ControlMount() {\n\ta.mux.HandleFunc("/api/shadow3", a.requireTenant(a.handleKeys))\n}\n')], True),
    ("K3  route on a DIFFERENT RECEIVER", [(LENS, KEYS_MOUNT, RECEIVER_MOUNT)], True),
    ("K4  COMPOUND: refusal -> silent skip, WITH K1", [
        (SAME, REFUSAL, SILENT_SKIP), (LENS, KEYS_MOUNT, CONST_MOUNT)], False),
    ("K5  VOID — comment reworded", [
        (LENS, "\ta.mux.Handle(\"/\", a.spaHandler())",
         "\t// reworded by the VOID control arm\n\ta.mux.Handle(\"/\", a.spaHandler())")], False),
]

TOUCHED = [LENS, SAME, TRACK]
if subprocess.run(["git", "diff", "--quiet", "--"] + TOUCHED, cwd=ROOT).returncode != 0:
    sys.exit("REFUSING: target files already have uncommitted changes.")
BEFORE = {p: sha(p) for p in TOUCHED}
ORIG = {p: open(p).read() for p in TOUCHED}

print("BASELINE — apps/bff must be green before any mutation.")
ok, failed = gotest()
if not ok or failed:
    sys.exit(f"REFUSING: baseline not green (build_ok={ok}, failed={sorted(failed)}).")
print("  baseline green\n")

results = []
try:
    for label, edits, expect_caught in MUTATIONS:
        for path, anchor, repl in edits:
            src = open(path).read()
            if src.count(anchor) != 1:
                sys.exit(f"ANCHOR DRIFT on {label} in {os.path.basename(path)}: "
                         f"{src.count(anchor)} occurrences, want 1.")
            open(path, "w").write(src.replace(anchor, repl))
            assert open(path).read() != ORIG[path], f"{label}: changed no bytes in {path}"

        build_ok, failed = gotest()
        if not build_ok:
            results.append((label, "VOID (build failed)", set(), expect_caught))
        else:
            got = bool(failed)
            verdict = "AS PREDICTED" if got == expect_caught else "*** MISPREDICTED ***"
            results.append((label, verdict, failed, expect_caught))
        for path, _, _ in edits:
            open(path, "w").write(ORIG[path])
finally:
    for p in TOUCHED:
        open(p, "w").write(ORIG[p])

print("\n" + "=" * 78)
bad = 0
for label, verdict, failed, expect in results:
    if verdict != "AS PREDICTED":
        bad += 1
    print(f"{label:<44} {verdict}   (expected caught={expect})")
    print(f"{'':<44} red: {sorted(failed) or '(none)'}")
print("=" * 78)
allsame = all(sha(p) == BEFORE[p] for p in TOUCHED)
print(f"sha256 all restored identical: {allsame}")
if not allsame:
    sys.exit("FILES NOT RESTORED")
ok, failed = gotest()
print(f"suite green after restore: {ok and not failed}")
print(f"\n{len(results) - bad}/{len(results)} as predicted")
sys.exit(1 if bad else 0)
