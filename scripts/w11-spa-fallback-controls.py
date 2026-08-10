#!/usr/bin/env python3
"""w11-spa-fallback-controls.py — positive controls for spa_fallback_test.go.

Each control breaks ONE thing in apps/bff/lens.go and names, BEFORE the run, the test that must
fail because of it.  A guard that passes on the first run is a guard nobody has proven can fail;
these are what prove it.

⚠ THE VERDICT IS READ FROM THE SET OF FAILING TEST NAMES, NOT FROM AN EXIT CODE.  `go test` exits
1 for a compile error, a panic and a caught mutation alike, and a panic in one test kills the whole
package binary so every other test in it disappears from the output rather than passing.  So this
runs `go test -v`, collects `--- PASS` / `--- FAIL` per test, and refuses to score a run where the
package did not build or did not report the tests it was supposed to report.

⚠ EVERY CONTROL NAMES A must-stay-green SET TOO.  A mutation that reds everything proves nothing
about which assertion did the work — the point of C5 is that it reds exactly one case in one test
while the floor stays green.

⚠ THE RESTORE IS IN A `finally`.  A crash between the write and the restore would leave a mutated
lens.go on disk, and the closing checksum is what says it did not.

Usage:  python3 scripts/w11-spa-fallback-controls.py [-v]
"""

from __future__ import annotations

import hashlib
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TARGET = REPO / "apps" / "bff" / "lens.go"

# Every test this file reasons about. A control whose run does not REPORT one of these — because
# the package failed to build, or panicked and took the binary down — is scored ERROR, never green.
GUARD_TESTS = [
    "TestBundleStillServes",
    "TestMissingAssetIsNotTheApp",
    "TestAssetDirectoryIsNotTheApp",
    "TestMissingVersionJSONIsNotTheApp",
    "TestClientRoutesStillFallBack",
]

# ── THE MUTATIONS, AND THE PREDICTION FOR EACH ───────────────────────────────────────
#
# `old` must appear EXACTLY ONCE in lens.go or the control is scored ERROR: a replacement that
# matched zero bytes would run the unmutated product and report a working guard as blind, and one
# that matched twice would apply half of itself.
CONTROLS = [
    {
        "id": "C1",
        "what": "isBuildOwnedPath stops recognising the assets/ prefix (the /version.json arm survives)",
        "old": '\tif cleanPath == "/"+bundleAssetsDir || strings.HasPrefix(cleanPath, "/"+bundleAssetsDir+"/") {\n\t\treturn true\n\t}\n',
        "new": "",
        "must_fail": ["TestMissingAssetIsNotTheApp", "TestAssetDirectoryIsNotTheApp"],
        "must_pass": ["TestBundleStillServes", "TestClientRoutesStillFallBack", "TestMissingVersionJSONIsNotTheApp"],
    },
    {
        "id": "C2",
        "what": "the build-owned FILE set empties, so /version.json falls through again",
        "old": 'var buildOwnedFiles = map[string]bool{"/version.json": true}',
        "new": "var buildOwnedFiles = map[string]bool{}",
        "must_fail": ["TestMissingVersionJSONIsNotTheApp"],
        "must_pass": ["TestBundleStillServes", "TestClientRoutesStillFallBack", "TestMissingAssetIsNotTheApp", "TestAssetDirectoryIsNotTheApp"],
    },
    {
        "id": "C3",
        "what": "the call site goes: the predicate is still correct and nothing consults it (the state before this change)",
        "old": "\t\tif isBuildOwnedPath(clean) {\n\t\t\thttp.NotFound(w, r) // a bundle file that is not on disk does not exist; do not hand back a document\n\t\t\treturn\n\t\t}\n",
        "new": "\t\t_ = isBuildOwnedPath\n",
        "must_fail": ["TestMissingAssetIsNotTheApp", "TestAssetDirectoryIsNotTheApp", "TestMissingVersionJSONIsNotTheApp"],
        "must_pass": ["TestBundleStillServes", "TestClientRoutesStillFallBack"],
    },
    {
        "id": "C4",
        "what": "the directory name is off by one letter — the guard compiles, reads a real field, and covers nothing",
        "old": 'const bundleAssetsDir = "assets"',
        "new": 'const bundleAssetsDir = "asset"',
        "must_fail": ["TestMissingAssetIsNotTheApp", "TestAssetDirectoryIsNotTheApp"],
        "must_pass": ["TestBundleStillServes", "TestClientRoutesStillFallBack", "TestMissingVersionJSONIsNotTheApp"],
    },
    {
        "id": "C5",
        "what": "THE WRONG FIX THE QUEUE NOTE WARNED ABOUT: an EXTENSION rule instead of a prefix rule",
        # This is the control the over-correction refusal exists for. It fixes the measured defect
        # perfectly — every missing asset 404s — and 404s `/track/issues/42.5`, a page, on the way.
        # It must red TestClientRoutesStillFallBack and NOTHING ELSE; the floor has no dotted path
        # in it, so a run where the floor also reds would mean the mutation did something wider.
        "old": "\treturn buildOwnedFiles[cleanPath]",
        "new": "\treturn strings.Contains(filepath.Base(cleanPath), \".\")",
        "must_fail": ["TestClientRoutesStillFallBack"],
        "must_pass": ["TestBundleStillServes", "TestMissingAssetIsNotTheApp", "TestAssetDirectoryIsNotTheApp", "TestMissingVersionJSONIsNotTheApp"],
    },
    {
        "id": "C6",
        "what": "the refusal keeps the body out of it but answers 200 — the status half of every case, alone",
        # servedTheApp() goes FALSE under this mutation, so only the status assertions can speak.
        # If a run of this scores green anywhere, that test's status assertion was decoration.
        "old": "\t\t\thttp.NotFound(w, r) // a bundle file that is not on disk does not exist; do not hand back a document",
        "new": "\t\t\tw.WriteHeader(http.StatusOK)",
        "must_fail": ["TestMissingAssetIsNotTheApp", "TestAssetDirectoryIsNotTheApp", "TestMissingVersionJSONIsNotTheApp"],
        "must_pass": ["TestBundleStillServes", "TestClientRoutesStillFallBack"],
    },
    {
        "id": "C7",
        "what": "MUST STAY GREEN — a comment word changes inside the guard and nothing else does",
        # Without this, "the controls all red" is consistent with a guard that reds on any edit to
        # this region, which is a guard the next person deletes.
        "old": "// buildOwnedFiles are bundle files the build emits at a stable path",
        "new": "// buildOwnedFiles are bundle files the build writes at a stable path",
        "must_fail": [],
        "must_pass": GUARD_TESTS,
    },
    {
        "id": "C8",
        "what": "THE FLOOR'S OWN CONTROL — the FileServer branch stops serving, so a real asset 404s too",
        # Every other test here asserts that something is NOT served. All of them are satisfied by
        # a handler that serves nothing. This is the one that would notice, and this is the proof.
        # ⚠ `_ = fs` IS LOAD-BEARING. The first draft of this control deleted the fs.ServeHTTP call
        # outright and the package stopped COMPILING (`declared and not used: fs`) — which the
        # harness scored ERROR, not CAUGHT. A compile error reds every test at once and would have
        # read as a spectacular floor if the verdict were an exit code.
        "old": "\t\t\tfs.ServeHTTP(w, r)\n\t\t\treturn",
        "new": "\t\t\t_ = fs\n\t\t\thttp.NotFound(w, r)\n\t\t\treturn",
        # Both, predicted: /version.json also leaves by the FileServer branch, so the "a bundle
        # that HAS one still serves it" half of the version test reds too. That is the same floor
        # speaking twice, and it is named rather than excluded.
        "must_fail": ["TestBundleStillServes", "TestMissingVersionJSONIsNotTheApp"],
        "must_pass": ["TestClientRoutesStillFallBack", "TestMissingAssetIsNotTheApp", "TestAssetDirectoryIsNotTheApp"],
    },
]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_tests() -> tuple[dict[str, str], str]:
    """Return {test name: PASS|FAIL} and the raw output. Build failures yield an empty dict."""
    proc = subprocess.run(
        ["go", "test", "-count=1", "-v", "-run", "|".join(GUARD_TESTS), "."],
        cwd=REPO / "apps" / "bff",
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    results: dict[str, str] = {}
    for m in re.finditer(r"^\s*--- (PASS|FAIL): (\w+)", out, re.M):
        results[m.group(2)] = m.group(1)
    return results, out


def main() -> int:
    verbose = "-v" in sys.argv
    source = TARGET.read_text()
    before = sha(TARGET)

    print(f"target   {TARGET.relative_to(REPO)}  sha256 {before[:16]}")
    baseline, out = run_tests()
    missing = [t for t in GUARD_TESTS if t not in baseline]
    if missing:
        print(f"BASELINE DID NOT REPORT {missing} — refusing to score anything against it")
        print(out[-3000:])
        return 3
    if any(v != "PASS" for v in baseline.values()):
        print(f"BASELINE IS NOT GREEN: {baseline} — every verdict below would be meaningless")
        return 3
    print(f"baseline {len(baseline)}/{len(GUARD_TESTS)} PASS\n")

    verdicts = []
    try:
        for c in CONTROLS:
            n = source.count(c["old"])
            if n != 1:
                verdicts.append((c["id"], "ERROR", f"anchor matched {n} times, want exactly 1"))
                print(f"{c['id']}  ERROR  anchor matched {n} times — not applied")
                continue
            TARGET.write_text(source.replace(c["old"], c["new"], 1))
            res, out = run_tests()

            unreported = [t for t in GUARD_TESTS if t not in res]
            if unreported:
                verdicts.append((c["id"], "ERROR", f"package did not report {unreported} (build failure or panic)"))
                print(f"{c['id']}  ERROR  {c['what']}")
                print(f"      the package did not report {unreported}")
                print("      " + "\n      ".join(out.strip().splitlines()[-6:]))
                continue

            failed = sorted(t for t, v in res.items() if v == "FAIL")
            want_fail = sorted(c["must_fail"])
            green_kept = [t for t in c["must_pass"] if res.get(t) == "PASS"]
            # TWO CONDITIONS, BOTH REQUIRED, and the second is the one that carries the meaning:
            # every predicted red actually red, AND every test named must-stay-green still green.
            # Without the second, a mutation that reds the whole package scores "as predicted" for
            # any prediction at all. A control with no predicted reds (C7) is satisfied only by an
            # empty failure set.
            ok = set(want_fail).issubset(set(failed)) and all(res.get(t) == "PASS" for t in c["must_pass"])
            if not c["must_fail"]:
                ok = ok and failed == []

            verdicts.append((c["id"], "AS PREDICTED" if ok else "NOT AS PREDICTED", f"failed={failed}"))
            print(f"{c['id']}  {'AS PREDICTED' if ok else '⚠ NOT AS PREDICTED'}  {c['what']}")
            print(f"      predicted red: {want_fail or '(none)'}")
            print(f"      actually red : {failed or '(none)'}")
            print(f"      stayed green : {green_kept}")
            if verbose or not ok:
                for line in out.splitlines():
                    if "spa_fallback_test.go:" in line or "version_test.go:" in line:
                        print("      | " + line.strip())
            print()
    finally:
        TARGET.write_text(source)
        after = sha(TARGET)
        print(f"restored {TARGET.relative_to(REPO)}  sha256 {after[:16]}  {'OK' if after == before else '⚠ MISMATCH'}")
        if after != before:
            return 4

    good = sum(1 for _, v, _ in verdicts if v == "AS PREDICTED")
    print(f"\n{good}/{len(CONTROLS)} as predicted")
    return 0 if good == len(CONTROLS) else 1


if __name__ == "__main__":
    sys.exit(main())
