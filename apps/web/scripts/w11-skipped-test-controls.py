#!/usr/bin/env python3
"""POSITIVE CONTROLS for the NOT RUN rule in check-test-manifest.mjs.

THE DEFECT, MEASURED AT 389eff9 BEFORE THE RULE EXISTED: `describe(` -> `describe.skip(` on
Convert.test.tsx's "the conversion says what it actually cost" — the three cases merged in #155
that state what the irreversible conversion actually charged — and the ROOT `pnpm test` exits 0
with `test-manifest: ok (85 files, 1063 tests)`, audit-reach 72/72 and both audit-gates ok.

EVERY CONTROL NAMES ITS PREDICTED CATCHER BEFORE IT RUNS, and the prediction is scored against
what actually reddened, because a CAUGHT that fired through a different assertion says nothing
about the guard it was written for.

⚠ THE RUNNER IS THE ROOT `pnpm test`, NOT `pnpm --filter @talyvor/web test`. Measured: the filtered
runner reds audit-reach on a PRISTINE tree — it reads packages/ui's commit record, which only a ui
run writes — so a red from it is the instrument and not the product. C0 below is the must-stay-green
baseline that keeps that honest.

⚠ RESTORE IS IN A `finally` AND VERIFIED BY sha256. A crash between mutate and restore would leave
a disabled money test, or a blinded guard, on disk.

Usage:  python3 apps/web/scripts/w11-skipped-test-controls.py
"""
import hashlib
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path.home() / "talyvor-suite"
CONVERT = ROOT / "apps/web/src/areas/lens/Convert.test.tsx"
# ⚠ MOVED TO THE REPO ROOT by the packages/ui-scope merge — the script now takes the project
#   directory as an argument and both projects run it. A harness that kept the old path would
#   have thrown on read rather than matching zero bytes, which is the loud half of that class.
GUARD = ROOT / "scripts/check-test-manifest.mjs"
LEDGER = ROOT / "apps/web/src/areas/lens/Ledger.test.tsx"

MONEY_DESCRIBE = "describe('the conversion says what it actually cost', () => {"
MONEY_IT = "  it('states the µLENS the server charged, not the µLENS this panel predicted', async () => {"
GUARD_PREDICATE = "    if (a.status !== 'passed') {"
GUARD_BLIND = "    if (false) {"

# (label, [(path, find, replace)], what it is, predicted catcher, must the chain red?)
CONTROLS = [
    (
        "C0  no mutation at all — the must-stay-green baseline",
        [],
        "the pristine tree under the same runner",
        "NOTHING may red. Without this, 'the armed run failed' and 'the runner is wrong' are "
        "the same observation.",
        False,
    ),
    (
        "C1  THE DEFECT — describe.skip on the three money cases",
        [(CONVERT, MONEY_DESCRIBE, MONEY_DESCRIBE.replace("describe(", "describe.skip("))],
        "the exact mutation that was green before this merge",
        "NOT RUN, three lines, naming Convert.test.tsx and the three fullNames. "
        "test-manifest's COUNT rule must stay silent (1063 either way) — that silence is the "
        "blindness this rule exists for, and it is why the count is left counting skipped tests.",
        True,
    ),
    (
        "C2  it.skip on ONE case — a different syntax, same channel",
        [(CONVERT, MONEY_IT, MONEY_IT.replace("  it(", "  it.skip("))],
        "the single-test shape, which a rule keyed on describe blocks would miss",
        "NOT RUN, exactly one line, naming that one fullName.",
        True,
    ),
    (
        "C3  it.todo — the status string the DENYLIST would have missed",
        [(CONVERT, MONEY_IT, MONEY_IT.replace("  it(", "  it.todo("))],
        "vitest counts this under numTodoTests, a DIFFERENT field from numPendingTests",
        "NOT RUN with status \"todo\" — this is the control that justifies the allowlist "
        "(`status !== 'passed'`) over a denylist of the one status I had measured.",
        True,
    ),
    (
        "C4  THE RULE BLINDED, with C1's skip on top",
        [
            (GUARD, GUARD_PREDICATE, GUARD_BLIND),
            (CONVERT, MONEY_DESCRIBE, MONEY_DESCRIBE.replace("describe(", "describe.skip(")),
        ],
        "the measured blindness: is this rule the ONLY thing in the repo that can see a skip?",
        "NOT CAUGHT — the whole chain green again, exactly as it was at 389eff9. If anything else "
        "reds, this rule is redundant enforcement and does not justify itself.",
        False,
    ),
    (
        "C5  a test DELETED rather than skipped — the must-stay-green companion",
        [(LEDGER, "DELETE_ONE_IT", "")],
        "the original #7 channel, which the COUNT rule owns",
        "SHRANK from the count rule, and the NOT RUN rule stays SILENT. Keeps CAUGHT from being a "
        "catch-all and proves the count rule still works beside the new one.",
        True,
    ),
]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def delete_one_it(src):
    """Remove the first top-level `it(` block by brace matching — a real deletion, not a comment."""
    lines = src.split("\n")
    starts = [i for i, l in enumerate(lines) if l.startswith("  it(")]
    assert starts, "no top-level it( in the file"
    i = starts[0]
    depth = 0
    j = i
    while True:
        depth += lines[j].count("{") - lines[j].count("}")
        if depth <= 0 and j > i:
            break
        j += 1
    return "\n".join(lines[:i] + lines[j + 1 :])


def apply(edits):
    """Apply every edit, asserting each anchor is unique FIRST. Returns the backups."""
    # ⚠ ONE EDIT PER FILE, ASSERTED. Every plan below is made against the file as first read, so
    #   two edits to ONE file would mean the second write erases the first and the control would
    #   land half of itself — a working guard then scores NOT CAUGHT.
    paths = [p for p, _, _ in edits]
    assert len(set(paths)) == len(paths), f"two edits to one file: {paths}"
    backups = {}
    plans = []
    for path, find, repl in edits:
        src = path.read_text()
        if find == "DELETE_ONE_IT":
            new = delete_one_it(src)
            assert len(new) < len(src), f"{path.name}: deletion removed nothing"
        else:
            n = src.count(find)
            assert n == 1, f"{path.name}: anchor appears {n} times, need exactly 1"
            new = src.replace(find, repl, 1)
            assert new != src, f"{path.name}: replacement changed no bytes"
        plans.append((path, new))
    for path, new in plans:
        if path not in backups:
            bk = pathlib.Path(tempfile.mkdtemp()) / path.name
            shutil.copy2(path, bk)
            backups[path] = (bk, sha(path))
        path.write_text(new)
    return backups


def run():
    r = subprocess.run(["pnpm", "test"], cwd=ROOT, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def verdict_lines(out):
    keep = []
    for l in out.splitlines():
        if any(k in l for k in ("NOT RUN", "SHRANK", "VANISHED", "GREW", "NEW  ",
                                "test-manifest:", "audit-reach:", "audit-gate:",
                                "Tests  ", "Test Files")):
            keep.append(l.strip())
    return keep


def main():
    results = []
    for label, edits, what, predicted, must_red in CONTROLS:
        print(f"\n{'=' * 78}\n{label}\n  what:      {what}\n  PREDICTED: {predicted}")
        backups = {}
        try:
            # ⚠ multi-file edits are planned against ONE read each and asserted before ANY write,
            #   so a second write cannot erase the first.
            backups = apply(edits)
            code, out = run()
            lines = verdict_lines(out)
            caught = code != 0
            print(f"  ACTUAL:    exit={code} -> {'CAUGHT' if caught else 'NOT CAUGHT'}")
            for l in lines[-10:]:
                print(f"      {l}")
            ok = caught == must_red
            results.append((label, ok, caught, lines))
            print(f"  SCORE:     {'as predicted' if ok else '⚠ PREDICTION WRONG'}")
        finally:
            for path, (bk, before) in backups.items():
                shutil.copy2(bk, path)
                if sha(path) != before:
                    sys.exit(f"RESTORE FAILED for {path} — the tree is dirty")
            if backups:
                print(f"  restored:  {len(backups)} file(s), sha256 verified")

    print(f"\n{'=' * 78}\nSUMMARY")
    for label, ok, caught, _ in results:
        print(f"  {'ok ' if ok else '⚠  '} {'CAUGHT    ' if caught else 'NOT CAUGHT'} {label}")
    if not all(ok for _, ok, _, _ in results):
        sys.exit("at least one control did not match its prediction — read the run above")


main()
