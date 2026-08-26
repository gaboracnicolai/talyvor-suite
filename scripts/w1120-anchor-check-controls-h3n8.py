#!/usr/bin/env python3
"""Positive controls for the anchor checker — BOTH DIRECTIONS, taken from this repo's history.

A checker that prints "every decidable anchor matches the tree" is worthless until something is
known to make it say otherwise. `65e2833` and `2ed28a1` each REPAIRED control anchors that had gone
stale, so for those harnesses the answer is already known at two commits:

    the version BEFORE the repair  -> the checker MUST report a miss   (it can go red)
    the version AFTER  the repair  -> the checker MUST report nothing  (it is not crying wolf)

Neither half alone is a control. Green-on-current proves only that the checker is quiet, which an
`exit 0` stub also achieves; red-on-stale proves only that it is noisy.

⚠ NOT EVERY FILE IN THOSE MERGES WAS AN ANCHOR REPAIR — some were prose or predictions. Those come
back `no-anchor-change` and that is a TRUE NEGATIVE, reported here rather than quietly dropped, so
the ARMS-AGAIN count below is the honest size of the control and not a total dressed up as one.
"""
from __future__ import annotations

import hashlib
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECKER = ROOT / "scripts" / "w1120-anchor-check-h3n8.py"

# (harness, the merge that repaired it) — its parent holds the stale version
REPAIRS = [
    ("apps/web/scripts/w11-copy-failure-controls.py", "65e2833"),
    ("apps/web/scripts/w11-header-reflow-controls.py", "65e2833"),
    ("scripts/w11-pointer-pins-controls.py", "65e2833"),
    ("scripts/w11-case-controls.py", "2ed28a1"),
    ("scripts/w11-display-sweep-controls.py", "2ed28a1"),
    ("scripts/w11-focus-controls.py", "2ed28a1"),
    ("scripts/w11-formatter-reach-controls.py", "2ed28a1"),
    ("scripts/w11-placeholder-controls.py", "2ed28a1"),
    ("scripts/w11-press-controls.py", "2ed28a1"),
]


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_checker() -> tuple[str, int]:
    r = subprocess.run([sys.executable, str(CHECKER)], capture_output=True, text=True, cwd=ROOT)
    return r.stdout + r.stderr, r.returncode


def verdict_for(out: str, rel: str) -> str:
    """MISS / UNREADABLE / clean — for one harness, read out of a whole-tree run."""
    misses, unreadable, section = False, False, None
    for line in out.splitlines():
        if "COULD NOT READ" in line:
            section = "unreadable"
        elif "NO LONGER MATCH" in line:
            section = "misses"
        elif line.startswith("  ") and rel in line:
            if section == "misses":
                misses = True
            elif section == "unreadable":
                unreadable = True
    if misses:
        return "MISS"
    return "UNREADABLE" if unreadable else "clean"


def main() -> int:
    base_out, base_rc = run_checker()
    print(f"checker on the tree as it stands: exit {base_rc}")
    print()

    results: list[tuple[str, str, str]] = []
    for rel, merge in REPAIRS:
        path = ROOT / rel
        before = sha(path)
        new_v = verdict_for(base_out, rel)

        stale = subprocess.run(["git", "show", f"{merge}^:{rel}"],
                               capture_output=True, cwd=ROOT)
        if stale.returncode != 0:
            print(f"  !! cannot read {rel} at {merge}^ — control NOT RUN")
            results.append((rel, new_v, "NOT-RUN"))
            continue

        original = path.read_bytes()
        try:
            path.write_bytes(stale.stdout)
            out, _ = run_checker()
            old_v = verdict_for(out, rel)
        finally:
            path.write_bytes(original)
            assert sha(path) == before, f"RESTORE FAILED for {rel}"
        results.append((rel, new_v, old_v))

    # ---- the vacuity floor -------------------------------------------------------------------
    # ⚠ WITHOUT THIS, a checker that reads NOTHING passes DIRECTION A for every harness above by
    # reporting `clean` — and `clean` is what it prints when it has not looked. Each floor below
    # blinds one organ of the checker and requires it to FAIL rather than fall quiet.
    # ⚠ THIS SECTION EXISTED AS A COMMENT WITH NO CODE UNDER IT FOR ONE DRAFT OF THIS FILE. A
    # heading is not a control.
    floors: list[tuple[str, bool, str]] = []
    src = CHECKER.read_text()
    BLINDINGS = [
        ("extractor blinded — _str returns None for everything",
         "    def _str(self, node: ast.AST | None) -> str | None:\n",
         "    def _str(self, node: ast.AST | None) -> str | None:\n        return None\n"),
        ("resolver blinded — no path ever names a file",
         "    roots = [ROOT, ROOT / \"apps/web\", ROOT / \"packages/ui\"]",
         "    return None\n    roots = [ROOT, ROOT / \"apps/web\", ROOT / \"packages/ui\"]"),
        ("census blinded — the harness glob matches nothing",
         'ROOT.rglob("w1*controls*.py")', 'ROOT.rglob("nothing-matches-this-*.py")'),
    ]
    tmp = ROOT / "scripts" / "_w1120_floor_tmp.py"
    for why, find, repl in BLINDINGS:
        if find not in src:
            floors.append((why, False, "anchor for the blinding is gone — FLOOR NOT RUN"))
            continue
        try:
            tmp.write_text(src.replace(find, repl, 1))
            r = subprocess.run([sys.executable, str(tmp)], capture_output=True, text=True, cwd=ROOT)
            out = r.stdout + r.stderr
            # ⚠ A NAMED MARKER, NOT MERELY exit != 0: a checker that crashes on the blinding is
            # also non-zero, and that would prove the interpreter noticed, not the floor.
            noticed = r.returncode != 0 and any(
                k in out for k in ("COULD NOT READ", "CENSUS COLLAPSED", "NO LONGER MATCH"))
            floors.append((why, noticed, f"exit {r.returncode}"))
        finally:
            tmp.unlink(missing_ok=True)

    print("=" * 96)
    for why, ok, note in floors:
        print(f"  {'✓' if ok else '***'} FLOOR  {why}  ({note})")
        if not ok:
            print("      the blinded checker did NOT fail — it would report every harness clean")
    print()
    armed = [r for r in results if r[1] == "clean" and r[2] == "MISS"]
    print(f"{len(armed)}/{len(results)} harnesses reproduce their repair IN BOTH DIRECTIONS")
    print()
    print(f"  {'harness':<52} {'at HEAD':<12} {'before repair'}")
    for rel, new_v, old_v in results:
        tag = "ARMS-AGAIN" if (new_v == "clean" and old_v == "MISS") else (
            "no-anchor-change" if (new_v == "clean" and old_v == "clean") else "*** UNEXPECTED ***")
        print(f"  {rel:<52} {new_v:<12} {old_v:<14} {tag}")
    print()

    bad = [r for r in results if r[1] != "clean"]
    if bad:
        print("*** DIRECTION A FAILED: a repaired harness is not read as clean at HEAD:")
        for rel, new_v, _ in bad:
            print(f"      {rel}: {new_v}")
    if not armed:
        print("*** DIRECTION B FAILED: NO stale version made the checker say anything.")
        print("    The checker is inert — every 'clean' above is worth nothing.")
    return 0 if (armed and not bad and all(ok for _, ok, _ in floors)) else 1


if __name__ == "__main__":
    sys.exit(main())
