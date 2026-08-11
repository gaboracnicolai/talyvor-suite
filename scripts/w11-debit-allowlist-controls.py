#!/usr/bin/env python3
"""Positive controls for debitTotal's SETTLED_CHARGE allow-list (W1.1, tab-3e7b).

WHAT THIS EXISTS TO SETTLE. `debitTotal` used to sum a row by SIGN whenever its `type` was
not a string — the 4.5x-too-high rule that SETTLED_CHARGE replaced, kept alive one branch
below it. Its only unit test passed rows with NO type, so every assertion about the money
total was made INSIDE the dead branch and the allow-list was never evaluated there.

Verdicts are recorded per TEST, never per file and never from the exit code alone: four
sibling `lxcDebitsByModel` tests share this file, so "spendMath.test.ts failed" is true of
a mutation the money total is completely blind to. That is not a hypothetical — it is what
the first run of C1 reported, and it is why the catcher is printed by name.

C0 is inert on purpose. A harness that answers CAUGHT to everything cannot distinguish a
guard from a crash, so one control must come back NOT CAUGHT for the others to mean anything.

Restore happens in a finally AND is verified by sha256, so a crash between mutate and
restore cannot leave a mutated money function on disk.
"""

import hashlib
import pathlib
import re
import subprocess
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent / "apps" / "web"
SPENDMATH = WEB / "src" / "areas" / "lens" / "spendMath.ts"

# The two assertions each control is meant to speak to, by their test titles.
MAIN = "sums the settled charges only"
UNTYPED = "does not count a row whose type is missing"


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


FAILED = re.compile(r"^\s*(?:×|FAIL)\s+(.*?)(?:\s+\d+ms)?$", re.M)


def run_vitest() -> tuple[int, list[str]]:
    """Run the WHOLE apps/web project so a mutation's full blast radius is visible."""
    r = subprocess.run(
        ["npx", "vitest", "run", "--reporter=verbose"],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    out = r.stdout + r.stderr
    names = []
    for line in FAILED.findall(out):
        line = line.strip()
        if line and line not in names:
            names.append(line)
    return r.returncode, names


CONTROLS = [
    (
        "C0",
        "INERT — renames a local. Must be NOT CAUGHT, or CAUGHT means nothing.",
        "  let total = 0\n",
        "  let sum = 0\n",
        [],
    ),
    (
        "C1",
        "the allow-list constant no row can match",
        "const SETTLED_CHARGE = 'spend'",
        "const SETTLED_CHARGE = 'spend_x'",
        [MAIN],
    ),
    (
        "C2",
        "the deleted sign fallback, put back verbatim",
        "    if (r.type === SETTLED_CHARGE) {\n      total += -r.amount",
        "    if (typeof r.type === 'string' ? r.type === SETTLED_CHARGE : r.amount < 0) {\n      total += -r.amount",
        [UNTYPED],
    ),
]

# C0 renames `total` where it is declared only; the rest of the function still says `total`,
# which would be a ReferenceError, not an inert edit. Rename every occurrence in the body.
C0_EXTRA = [("      total += -r.amount", "      sum += -r.amount"), ("  return total\n}", "  return sum\n}")]


def main() -> int:
    only = sys.argv[1:] or [c[0] for c in CONTROLS]
    results = []
    for cid, what, old, new, expect_titles in CONTROLS:
        if cid not in only:
            continue
        before = SPENDMATH.read_text()
        digest = sha(SPENDMATH)
        edits = [(old, new)] + (C0_EXTRA if cid == "C0" else [])
        try:
            body = before
            premise_ok = True
            for o, n in edits:
                if body.count(o) != 1:
                    print(f"{cid}: PREMISE FAILED — anchor occurs {body.count(o)}x: {o!r}")
                    premise_ok = False
                    break
                body = body.replace(o, n, 1)
            if not premise_ok:
                results.append((cid, "PREMISE FAILED", []))
                continue
            SPENDMATH.write_text(body)
            assert sha(SPENDMATH) != digest, f"{cid}: write did not change the file"
            code, names = run_vitest()
            verdict = "CAUGHT" if code != 0 else "NOT CAUGHT"
            spoke = [t for t in expect_titles if any(t in n for n in names)]
            missed = [t for t in expect_titles if t not in spoke]
            print(f"\n=== {cid} — {verdict} (exit {code}) — {what}")
            for n in names:
                print(f"    red: {n}")
            if not names:
                print("    red: (none)")
            if missed:
                print(f"    ⚠ PREDICTED CATCHER SILENT: {missed}")
            results.append((cid, verdict, names))
        finally:
            SPENDMATH.write_text(before)
            assert sha(SPENDMATH) == digest, f"{cid}: RESTORE FAILED for {SPENDMATH}"

    print("\n────── summary")
    for cid, verdict, names in results:
        print(f"  {cid}: {verdict:11s} ({len(names)} red)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
