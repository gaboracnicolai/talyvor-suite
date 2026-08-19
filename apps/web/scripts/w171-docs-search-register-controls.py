#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR apps/web/src/docsSearchRegister.test.ts — tab-4b7e, W1.7.1.

The guard went RED-FIRST (14 of 16 failing before the register entries existed) and green after,
which is necessary and not sufficient: what it must also do is fail for each defect it exists to
catch, ALONE, and stay green for a change that is not one.

Every control mutates ONE thing, runs the FULL apps/web suite (so "nothing else catches this" is
measured rather than assumed), compares the outcome against a verdict predicted BEFORE the run, and
restores the file in a `finally` with its sha256 compared back.

BLINDING (B*) runs the same defect with docsSearchRegister.test.ts REMOVED. A control that is
"caught" only because some other file also fails proves nothing about this guard.

Usage:  python3 apps/web/scripts/w171-docs-search-register-controls.py
"""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
ROOT = WEB.parents[1]
ROUTE = ROOT / "apps/bff/docs_search.go"
REGISTER = ROOT / "deploy/decision-expiry.sh"
GUARD = WEB / "src/docsSearchRegister.test.ts"

REPORT = WEB / ".vitest-report-w171.json"


def run_suite() -> set:
    """Full apps/web run. Returns the set of FAILING test file basenames."""
    subprocess.run(
        ["npx", "vitest", "run", "--reporter=json", f"--outputFile={REPORT}"],
        cwd=WEB, capture_output=True, text=True,
    )
    if not REPORT.exists():
        raise SystemExit("vitest wrote no report — the harness cannot score a run it cannot read")
    data = json.loads(REPORT.read_text())
    REPORT.unlink()
    failing = set()
    for r in data.get("testResults", []):
        # vitest's json reporter marks a file's status; a file that fails to COLLECT also lands here.
        if r.get("status") == "failed" or any(a.get("status") == "failed" for a in r.get("assertionResults", [])):
            failing.add(Path(r["name"]).name)
    return failing


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


GUARD_NAME = "docsSearchRegister.test.ts"

# (label, file, mutate(text)->text, caught?)  — caught means THIS guard must be among the failures.
CONTROLS = [
    ("G1  a SIXTH parameter put on the wire, register untouched", ROUTE,
     lambda t: t.replace('out.Set("limit", strconv.Itoa(limit))',
                         'out.Set("sort", "title")\n\t\tout.Set("limit", strconv.Itoa(limit))'), True),
    ("G2  a FOURTH type accepted here, register untouched", ROUTE,
     lambda t: t.replace('map[string]bool{"all": true, "fulltext": true, "semantic": true}',
                         'map[string]bool{"all": true, "fulltext": true, "semantic": true, "titles": true}'), True),
    ("G3  the merged window moved to 40, register untouched", ROUTE,
     lambda t: t.replace("const docsSearchMergedWindow = 50", "const docsSearchMergedWindow = 40"), True),
    ("G4  a THIRD upstream-behaviour refusal declared with no entry", ROUTE,
     lambda t: t.replace("// docsSearch — GET /api/docs/search",
                         'const docsSearchSpaceRefusal = "space_id must name a space"\n\n'
                         "// docsSearch — GET /api/docs/search"), True),
    ("G5  a refusal constant DECLARED but never written to a caller", ROUTE,
     lambda t: t.replace('writeJSON(w, http.StatusBadRequest, map[string]string{"error": docsSearchTypeRefusal})',
                         'writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad type"})'), True),
    ("G6  the window entry DELETED from the register", REGISTER,
     lambda t: t.replace("cannot \"the 50-row merged window is talyvor-docs' own maxFetchRows",
                         "true \"the 50-row merged window is talyvor-docs' own maxFetchRows"), True),
    ("G7  the key-set entry's EXPECTATION narrowed to four keys", REGISTER,
     lambda t: t.replace("URL.Query().Get(limit)|URL.Query().Get(offset)|URL.Query().Get(q)|"
                         "URL.Query().Get(space_id)|URL.Query().Get(type)|",
                         "URL.Query().Get(limit)|URL.Query().Get(offset)|URL.Query().Get(q)|"
                         "URL.Query().Get(type)|"), True),
    ("G8  the type entry's grep pattern RE-AIMED (the entry still exists, and still counts)", REGISTER,
     lambda t: t.replace("grep -o 'kind == .[a-z]*.'", "grep -o 'kinds == .[a-z]*.'"), True),
    ("G9  the window entry's expectation moved to 60 while the const stays 50", REGISTER,
     lambda t: t.replace('= \\"maxFetchRows = 50|\\"', '= \\"maxFetchRows = 60|\\"'), True),
    # ── VACUITY. Every population is a parse; a parse that finds nothing must not pass. ──
    ("V1  the wire-query builder renamed, so `out.Set` parses to NOTHING", ROUTE,
     lambda t: t.replace("out.Set(", "wire.Set(").replace("out := url.Values{}", "wire := url.Values{}")
                .replace("docsWorkspacePath(ws, \"/search\"), out.Encode()",
                         "docsWorkspacePath(ws, \"/search\"), wire.Encode()"), True),
    ("V2  the type map renamed, so the discriminator parses to NOTHING", ROUTE,
     lambda t: t.replace("docsSearchTypes", "docsSearchKinds"), True),
    # ── THE NEGATIVE CONTROL. A guard that reds on everything is not a guard. ──
    ("N1  a COMMENT reworded in the route — nothing declared moved", ROUTE,
     lambda t: t.replace("// docsSearchDefaultLimit is THIS route's default page size",
                         "// docsSearchDefaultLimit is this route's default page size"), False),
]

# The blinded runs: the same defect with the guard file removed. If the project is still red, the
# control proves the PROJECT catches it and says nothing about this guard.
BLINDED = {"G1  a SIXTH parameter put on the wire, register untouched",
           "G2  a FOURTH type accepted here, register untouched",
           "G3  the merged window moved to 40, register untouched",
           "G7  the key-set entry's EXPECTATION narrowed to four keys"}


def main() -> int:
    base = run_suite()
    print(f"baseline failures: {sorted(base) or '(none)'}")
    if base:
        raise SystemExit("the suite is not green before the controls — fix that first")

    originals = {p: (p.read_text(), sha(p)) for p in {ROUTE, REGISTER}}
    guard_text, guard_sha = GUARD.read_text(), sha(GUARD)
    caught = green = anomalies = 0

    for label, path, mutate, want_caught in CONTROLS:
        text, digest = originals[path]
        blind = label in BLINDED
        try:
            mutated = mutate(text)
            if mutated == text:
                print(f"  ⚠ VOID  {label}: the mutation changed NOTHING — a no-op reads exactly "
                      "like a defect nobody watches")
                anomalies += 1
                continue
            path.write_text(mutated)
            failing = run_suite()
            blinded_failing = None
            if blind:
                GUARD.unlink()
                try:
                    blinded_failing = run_suite()
                finally:
                    GUARD.write_text(guard_text)
                    assert sha(GUARD) == guard_sha
        finally:
            path.write_text(text)
            assert sha(path) == digest, f"{path} not restored byte-for-byte"

        hit = GUARD_NAME in failing
        others = sorted(failing - {GUARD_NAME})
        ok = hit == want_caught
        note = ""
        if blinded_failing is not None:
            note = (f"   BLINDED: {sorted(blinded_failing) or 'PROJECT GREEN — nothing else watches it'}")
            if blinded_failing:
                ok = False
        print(f"  {'ok  ' if ok else 'ANOM'}  {label}\n"
              f"          predicted {'CAUGHT' if want_caught else 'GREEN'}"
              f"   |   guard {'RED' if hit else 'green'}"
              f"   |   others red: {others or '(none)'}{note}")
        if not ok:
            anomalies += 1
        elif want_caught:
            caught += 1
        else:
            green += 1

    for p, (text, digest) in originals.items():
        assert sha(p) == digest
    print(f"\n{caught} caught, {green} predicted-green, {anomalies} anomalies (all files restored)")
    return 1 if anomalies else 0


if __name__ == "__main__":
    sys.exit(main())
