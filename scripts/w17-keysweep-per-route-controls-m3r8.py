#!/usr/bin/env python3
"""
W1.7 — THE KEY SWEEP'S FLIP SIDE WAS POSITIONAL: positive controls (tab-m3r8).

Each control MUTATES the shipped product and predicts which named test goes RED. A guard that
stays green under its own mutation is not a guard, whatever it asserted a moment ago.

⚠ WHAT WAS WRONG. Two sweeps assert that the BFF attaches the session's workspace token to the
UPSTREAM request — the half no leak sweep covers, because a leak sweep only proves the credential
is not in the RESPONSE. Both recorded the header into a single `gotAuth string` that every
endpoint overwrote, and checked it ONCE after the loop. So each was a claim about whichever
endpoint happened to proxy LAST, and silent about the rest.

MEASURED at `49fd5f2`, before the fix:
  · `doGet` attaching only on `/v1/api/usage` (the last of TEN that reach Lens in bff_test.go):
    TestKeyNeverReachesResponse **PASSED** with nine proxying routes sending no credential.
  · `doGet` attaching only on `/v1/bonds` (the last of SIX in auth_test.go):
    TestKeyNeverReachesResponseOIDC **PASSED** with five sending none.

C1 and C2 below are those two mutations. They are the reason this merge exists, so if either ever
scores NOT CAUGHT again the fix has been undone.

⚠ C3 IS THE PAIR THAT STOPS C1 BEING MISREAD. The OLD guard was not useless — it caught the
credential being dropped EVERYWHERE, because then nothing carried one. Keeping that case shows
what the old shape did cover, so "the flip side asserted nothing" is not claimed when what is true
is narrower and more interesting: it asserted exactly one route, chosen by evaluation order.

Verdicts come from `go test`'s own per-test reporting, never the process exit code: a package that
fails to BUILD exits non-zero and would score every control as CAUGHT while asserting nothing.
Every touched file is restored and compared against its original sha256.

Usage: python3 scripts/w17-keysweep-per-route-controls-m3r8.py
"""

import hashlib
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BFF = REPO / "apps/bff"
LENS = BFF / "lens.go"
BFFTEST = BFF / "bff_test.go"

TESTS = "TestKeyNeverReachesResponse"

ATTACH = '''	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")
	return a.client.Do(req)'''


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def failures():
    """Names of failing tests, or None if the package never reached an assertion."""
    p = subprocess.run(["go", "test", "-run", TESTS, "-count=1", "."],
                       cwd=BFF, capture_output=True, text=True)
    out = p.stdout + p.stderr
    if "build failed" in out or "[build failed]" in out or "cannot find package" in out:
        return None
    fails = re.findall(r"--- FAIL: (\S+)", out)
    if not fails and p.returncode != 0 and "FAIL" not in out:
        return None
    if not fails and p.returncode != 0:
        # FAIL without a named test: the package failed as a whole. Report it rather than
        # silently counting it as a catch of whatever we were probing.
        return ["<package FAIL with no named test>"]
    return fails


CONTROLS = [
    ("C1 the key is attached ONLY on the last-proxying route (bff sweep)", LENS, ATTACH,
     '''	if upstreamPath == "/v1/api/usage" {
		req.Header.Set("Authorization", "Bearer "+t.token)
	}
	req.Header.Set("Accept", "application/json")
	return a.client.Do(req)''',
     "TestKeyNeverReachesResponse$",
     "⚠ THE MUTATION THE OLD GUARD PASSED. Nine of the ten routes that reach Lens send no "
     "credential; the tenth is the one the loop happened to visit last, and the single "
     "post-loop check read only that. Now every route is named in the failure."),

    ("C2 the key is attached ONLY on the last-proxying route (OIDC sweep)", LENS, ATTACH,
     '''	if upstreamPath == "/v1/bonds" {
		req.Header.Set("Authorization", "Bearer "+t.token)
	}
	req.Header.Set("Accept", "application/json")
	return a.client.Do(req)''',
     "TestKeyNeverReachesResponseOIDC",
     "⚠ THE SAME DEFECT ONE FILE OVER, and the reason both are in one merge. This repository's "
     "recurring shape is the fix applied where the defect was reported and the identical shape "
     "one element over never swept for."),

    ("C3 the key is attached NOWHERE (what the OLD shape DID cover)", LENS, ATTACH,
     '''	_ = t
	req.Header.Set("Accept", "application/json")
	return a.client.Do(req)''',
     "TestKeyNeverReachesResponse",
     "C1's pair. The old single-string check DID catch this, because then nothing carried a "
     "credential and the one variable stayed empty. Keeping it stops C1 being read as 'the old "
     "assertion was worthless' — what is true is narrower: it held exactly one route, and which "
     "one depended on evaluation order rather than on anything anybody chose."),

    ("C4 a swept route stops proxying to Lens", BFFTEST,
     '"/api/bonds",\n\t\t"/api/track/workspaces"',
     '"/api/bondsXX",\n\t\t"/api/track/workspaces"',
     "TestKeyNeverReachesResponse$",
     "⚠ THE CENSUS HALF. A route that stops reaching Lens contributes no upstream hits and would "
     "simply drop out of a per-endpoint loop — passing while covering one route fewer, which is "
     "the original defect in a new place. The pinned proxy table is what refuses it."),

    ("C5 the pinned proxy table is wrong about a route", BFFTEST,
     # ⚠ THE ANCHOR IS BUILT FROM THE FILE'S OWN SPACING RATHER THAN RETYPED. The first version
     # guessed the column alignment inside the map literal; gofmt had chosen a different width and
     # the anchor matched 0×. The anchor check caught it — a control whose anchor is dead probes
     # nothing and would have reported this census as unguarded.
     '"/api/bonds":' + ' ' * 27 + 'true,',
     '"/api/bonds":' + ' ' * 27 + 'false,',
     "TestKeyNeverReachesResponse$",
     "C4's mirror: the table is compared against what was MEASURED, in both directions, so it "
     "cannot quietly drift into agreeing with a product that changed."),

    ("C6 NEGATIVE CONTROL — a comment-only edit", LENS,
     "// doGet issues the upstream GET with the workspace key attached server-side.",
     "// doGet (a comment changed by the negative control).",
     None,
     "Nothing may red. A harness that reds on any edit is measuring the edit, not the product."),
]


def main() -> int:
    print("=" * 78)
    print("W1.7 — THE KEY SWEEP'S FLIP SIDE WAS POSITIONAL: positive controls")
    print("=" * 78)

    base = failures()
    if base is None:
        print("FATAL: the package did not reach its assertions on the clean tree")
        return 1
    if base:
        print(f"FATAL: the clean tree is not green: {base}")
        return 1
    print("clean tree: both sweeps GREEN\n")

    passed = 0
    for name, path, anchor, repl, expect, why in CONTROLS:
        src = path.read_text(encoding="utf-8")
        before = sha(path)
        n = src.count(anchor)
        if n != 1:
            print(f"✗ {name}\n   ANCHOR DEAD — {path.name} holds it {n}×, expected 1. "
                  f"This control probes NOTHING.\n")
            continue
        path.write_text(src.replace(anchor, repl), encoding="utf-8")
        try:
            fails = failures()
            if fails is None:
                ok, detail = False, "INVALID — the package never reached an assertion"
            elif expect is None:
                ok = len(fails) == 0
                detail = "nothing red (as predicted)" if ok else f"RED: {fails}"
            else:
                hit = [f for f in fails if re.search(expect, f)]
                ok = len(hit) >= 1
                detail = (f"caught by: {hit[0]}" if hit
                          else f"NOT CAUGHT. red instead: {fails or '(nothing)'}")
            print(f"{'✓' if ok else '✗'} {name}\n   {why}\n   → {detail}\n")
            passed += 1 if ok else 0
        finally:
            path.write_text(src, encoding="utf-8")
            assert sha(path) == before, f"restore of {path} did not match its original sha256"

    print("every touched file restored to its original sha256")
    print("=" * 78)
    print(f"{passed}/{len(CONTROLS)} controls behaved as predicted")
    print("=" * 78)
    return 0 if passed == len(CONTROLS) else 1


sys.exit(main())
