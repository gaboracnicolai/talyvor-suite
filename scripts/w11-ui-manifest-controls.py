#!/usr/bin/env python3
"""POSITIVE CONTROLS for extending the test-count manifest to packages/ui.

THE DEFECT, MEASURED AT 8ed03da BEFORE THE WIRING EXISTED: one `it(...)` block deleted from
packages/ui/src/__tests__/theme-storage.test.tsx and the ROOT `pnpm test` exits 0 —

    packages/ui test:  Tests  349 passed (349)
    apps/web  test:  test-manifest: ok (85 files, 1063 tests, all run)

the #7 regression verbatim, alive in the project the guard did not cover.

⚠ WHAT THIS SET HAS TO PROVE IS NOT "THE SCRIPT WORKS". The script already worked — it worked on
apps/web all along. What was missing is the WIRING, so U3 mutates packages/ui's `test` script back
to the bare `vitest run` it was and shows the deletion going silent again.

⚠ AND U4 IS THE ONE I WOULD HAVE SKIPPED. This merge MOVES the script out of apps/web/scripts. A
move empties guards that never mention the path; U4 asserts the apps/web half still reds, and
reds LABELLED apps/web, so "it still runs" is measured rather than assumed.

Restore is in a `finally` and sha256-verified. Runner is the ROOT `pnpm test` (see the C0 note in
apps/web/scripts/w11-skipped-test-controls.py for why the filtered runner cannot be used).

Usage:  python3 scripts/w11-ui-manifest-controls.py
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path.home() / "talyvor-suite"
UI_TEST = ROOT / "packages/ui/src/__tests__/theme-storage.test.tsx"
UI_PKG = ROOT / "packages/ui/package.json"
WEB_TEST = ROOT / "apps/web/src/areas/lens/Ledger.test.tsx"

UI_DESCRIBE = "describe('the theme toggle when the browser refuses site data', () => {"
UI_WIRED = (
    '"test": "vitest run --reporter=default --reporter=json --outputFile=.vitest-report.json '
    '&& node ../../scripts/check-test-manifest.mjs ."'
)
UI_BARE = '"test": "vitest run"'

CONTROLS = [
    (
        "U0  no mutation — the must-stay-green baseline",
        [],
        "NOTHING may red. Without it, an armed failure and a broken runner are the same reading.",
        False,
    ),
    (
        "U1  THE DEFECT — one it(...) DELETED from a packages/ui test",
        [(UI_TEST, "DELETE_ONE_IT", "")],
        "test-manifest: packages/ui: SHRANK theme-storage.test.tsx 8 -> 7. This exact mutation "
        "exited 0 at 8ed03da.",
        True,
    ),
    (
        "U2  a packages/ui describe SKIPPED",
        [(UI_TEST, UI_DESCRIBE, UI_DESCRIBE.replace("describe(", "describe.skip("))],
        "NOT RUN lines LABELLED packages/ui — the status rule merged in #156 reaching the second "
        "project by construction, which is the whole reason one script serves both.",
        True,
    ),
    (
        "U3  THE WIRING REMOVED — packages/ui back to a bare `vitest run`, with U1's deletion",
        [(UI_PKG, UI_WIRED, UI_BARE), (UI_TEST, "DELETE_ONE_IT", "")],
        "NOT CAUGHT — green again, exactly as main was. Proves the closure is the WIRING and not "
        "the script, and that nothing else in the repo counts packages/ui's tests.",
        False,
    ),
    (
        "U4  the apps/web half, after the script MOVED out of apps/web/scripts",
        [(WEB_TEST, "DELETE_ONE_IT", "")],
        "test-manifest: apps/web: SHRANK Ledger.test.tsx 9 -> 8. A move empties guards that never "
        "mention the path; this is the must-stay-green companion that says the older half still "
        "runs, and still knows which project it is talking about.",
        True,
    ),
]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def delete_one_it(src):
    lines = src.split("\n")
    starts = [i for i, l in enumerate(lines) if l.startswith("  it(")]
    assert starts, "no top-level it( in the file"
    i = starts[0]
    depth, j = 0, i
    while True:
        depth += lines[j].count("{") - lines[j].count("}")
        if depth <= 0 and j > i:
            break
        j += 1
    return "\n".join(lines[:i] + lines[j + 1 :])


def apply(edits):
    paths = [p for p, _, _ in edits]
    assert len(set(paths)) == len(paths), f"two edits to one file: {paths}"
    backups, plans = {}, []
    for path, find, repl in edits:
        src = path.read_text()
        if find == "DELETE_ONE_IT":
            new = delete_one_it(src)
            assert len(new) < len(src), f"{path.name}: deletion removed nothing"
        else:
            n = src.count(find)
            assert n == 1, f"{path.name}: anchor appears {n} times, need exactly 1"
            new = src.replace(find, repl, 1)
        plans.append((path, new))
    for path, new in plans:
        bk = pathlib.Path(tempfile.mkdtemp()) / path.name
        shutil.copy2(path, bk)
        backups[path] = (bk, sha(path))
        path.write_text(new)
    return backups


def main():
    # ⚠ THE ARGUMENT ASSERTION, CHECKED DIRECTLY. The script resolves its paths against a directory
    #   it is GIVEN; pointed at one with no package.json every path is simply absent, and "the
    #   manifest is missing" would read the same as "you pointed me at nothing".
    for args, why in (([], "no argument"), (["/tmp"], "a directory with no package.json")):
        r = subprocess.run(
            ["node", str(ROOT / "scripts/check-test-manifest.mjs"), *args],
            cwd=ROOT, capture_output=True, text=True,
        )
        assert r.returncode != 0, f"{why} did not fail: {r.stdout}"
        print(f"arg-guard: {why} -> exit {r.returncode}: {(r.stderr or r.stdout).strip()[:88]}")

    results = []
    for label, edits, predicted, must_red in CONTROLS:
        print(f"\n{'=' * 78}\n{label}\n  PREDICTED: {predicted}")
        backups = {}
        try:
            backups = apply(edits)
            r = subprocess.run(["pnpm", "test"], cwd=ROOT, capture_output=True, text=True)
            out = r.stdout + r.stderr
            lines = [
                l.strip() for l in out.splitlines()
                if any(k in l for k in ("NOT RUN", "SHRANK", "VANISHED", "test-manifest:",
                                        "audit-reach:", "Tests  "))
            ]
            caught = r.returncode != 0
            print(f"  ACTUAL:    exit={r.returncode} -> {'CAUGHT' if caught else 'NOT CAUGHT'}")
            for l in lines[-8:]:
                print(f"      {l[:150]}")
            ok = caught == must_red
            results.append((label, ok, caught))
            print(f"  SCORE:     {'as predicted' if ok else '⚠ PREDICTION WRONG'}")
        finally:
            for path, (bk, before) in backups.items():
                shutil.copy2(bk, path)
                if sha(path) != before:
                    sys.exit(f"RESTORE FAILED for {path} — the tree is dirty")
            if backups:
                print(f"  restored:  {len(backups)} file(s), sha256 verified")

    print(f"\n{'=' * 78}\nSUMMARY")
    for label, ok, caught in results:
        print(f"  {'ok ' if ok else '⚠  '} {'CAUGHT    ' if caught else 'NOT CAUGHT'} {label}")
    if not all(ok for _, ok, _ in results):
        sys.exit("at least one control did not match its prediction")


main()
