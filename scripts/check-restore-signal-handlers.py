#!/usr/bin/env python3
"""Every control script that mutates a tracked file and restores it in a `finally` must also
install a restoring SIGNAL HANDLER — because a `finally` does not run on SIGTERM.

WHY THIS EXISTS, MEASURED RATHER THAN SUPPOSED (W1.7, merge 78c69c8). A 2-minute command timeout
SIGTERM'd `scripts/w11-expiry-subject-controls.py` mid-control. The `finally` never ran and the
working tree was left with `deploy/decision-expiry.sh` reading `if true; then` where a gate had
been, and a test file reading `D8: 'zzz never printed'`.

⚠ NOTHING ABOUT THAT TREE LOOKED WRONG. `pnpm test` had passed minutes earlier, `git status`
showed only files the session had edited on purpose, and the diff was one line inside a table that
had legitimately been touched. It was found only because the NEXT harness refused to score against
a red baseline. The stranded state is the dangerous kind: a kill landing on a control whose
mutation WEAKENS a guard leaves that weakening in the tree with a green suite.

⚠⚠ AND THE POPULATION GREW WHILE THE FIX SAT IN ONE FILE, WHICH IS WHY THIS IS A GUARD AND NOT A
BATCH OF EDITS. At 82cffd5 the count was 1 protected; at a083c67 it is 2, and the directory had
grown by twelve scripts in between. A population named in prose does not stop growing. The
allowlist below may only SHRINK: R2 fails on an entry that has been fixed, so the list cannot rot
into a permanent excuse, and R1 fails on a NEW unprotected mutator, so the count cannot climb.

⚠ DETECTION IS SYNTACTIC, NOT A GREP, AND THAT IS LOAD-BEARING HERE RATHER THAN STYLISTIC.
W1.7's own note says two of its censuses were "regex over prose and I do not stand behind them",
and this file measured why: `grep -l signal scripts/*.py` reports
w1121d-anchor-check-write-target-controls-j8w4.py as PROTECTED, and that script's only occurrences
of the word are four sentences of English in comments ("the count signal replaces the hand-kept
vocabulary"). A regex reads the documentation as the implementation. `ast` does not see comments.

WHAT COUNTS AS A MUTATOR: a script containing a `try` whose `finally` performs a write —
`.write_text` / `.write_bytes` / `.writelines` / `.write`, or `shutil`/`os` copy/move. That is the
restore, and a script that restores is a script that mutated.

WHAT COUNTS AS PROTECTED: a call to `signal.signal(...)`. This does NOT verify the handler
restores correctly or re-raises; it verifies one is installed. The shape to copy is in
`scripts/w11-expiry-subject-controls.py#restore_on_signal` — deliberately self-contained rather
than an import, so adopting it is a paste. SIGKILL still strands and nothing in Python can change
that; the defence there is a harness that refuses to score against a red baseline.

Usage:  python3 scripts/check-restore-signal-handlers.py
Exit 0 = every mutator is protected or listed; non-zero names what changed.
"""
import ast
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
SCRIPTS = REPO / "scripts"

# MUTATOR FLOOR. 41 scripts in this directory mutate-and-restore at a083c67. It is a FLOOR on the
# DETECTOR, not a target for the tree: if this walk stops recognising the shape it reports a clean
# directory, which is the one failure mode a guard like this has. Deleting scripts is legitimate —
# lower it in the same diff, with the deletions visible.
MUTATOR_FLOOR = 38

# The scripts that mutate-and-restore and do NOT yet install a handler, measured at a083c67.
# ⚠ THIS LIST MAY ONLY SHRINK. Adding to it is not a fix; R1 exists so that a new script cannot be
# written without a handler, and R2 exists so that a fixed script cannot be left listed.
UNPROTECTED = {
    "w11-card-heading-controls.py",
    "w11-cited-guard-controls.py",
    "w11-clock-figure-face-controls.py",
    "w11-console-title-controls.py",
    "w11-control-parity-controls.py",
    "w11-dangling-claim-controls.py",
    "w11-debit-allowlist-controls.py",
    "w11-doc-subject-controls.py",
    "w11-focus-controls.py",
    "w11-formatter-reach-controls.py",
    "w11-glyph-controls.py",
    "w11-ledger-identity-controls.py",
    "w11-model-tier-controls.py",
    "w11-placeholder-controls.py",
    "w11-press-controls.py",
    "w11-probe-status-controls.py",
    "w11-rendered-clock-controls.py",
    "w11-selection-controls.py",
    "w11-spa-fallback-controls.py",
    "w11-state-transition-controls.py",
    "w11-type-scale-controls.py",
    "w11-ui-manifest-controls.py",
    "w110-clockpin-controls-q4vn.py",
    "w110-page-scale-controls-q4vn.py",
    "w1112-row-hint-controls-m3r8.py",
    "w1117-motion-census-m3w8.py",
    "w1120-anchor-check-controls-h3n8.py",
    "w1121d-anchor-check-widen-controls-r5m2.py",
    "w1121d-anchor-check-write-target-controls-j8w4.py",
    "w1121e-path-invariance-controls-p9r4.py",
    "w117-issuelist-controls-q4vn.py",
    "w118-issuedetail-controls-m3w8.py",
    "w119-spacelist-controls-m3w8.py",
    "w119a-spaceview-controls-m3w8.py",
    "w17-keysweep-per-route-controls-m3r8.py",
    "w17-mounted-patterns-controls-m5x8.py",
    "w171-docs-pagewrite-controls.py",
    "w24-count-cost-5c2e.py",
}

_WRITE_ATTRS = {"write_text", "write_bytes", "writelines", "write"}
_COPY_FUNCS = {"copy", "copy2", "copyfile", "move"}


def _writes(body) -> bool:
    """True if this statement list performs a filesystem write."""
    for n in ast.walk(ast.Module(body=body, type_ignores=[])):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)):
            continue
        if n.func.attr in _WRITE_ATTRS:
            return True
        if n.func.attr in _COPY_FUNCS and isinstance(n.func.value, ast.Name) \
                and n.func.value.id in ("shutil", "os"):
            return True
    return False


def _restores_in_finally(tree: ast.AST) -> bool:
    return any(isinstance(n, ast.Try) and n.finalbody and _writes(n.finalbody)
               for n in ast.walk(tree))


def _installs_handler(tree: ast.AST) -> bool:
    """A call to `signal.signal(...)`. Comments are invisible to ast, which is the point."""
    return any(
        isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
        and n.func.attr == "signal"
        and isinstance(n.func.value, ast.Name) and n.func.value.id == "signal"
        for n in ast.walk(tree)
    )


def main() -> int:
    mutators, protected, errors = set(), set(), []
    for path in sorted(SCRIPTS.glob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError) as e:
            # R5: a file this guard cannot read is reported, never skipped. A walk that silently
            # drops what it cannot parse reports a clean directory.
            errors.append(f"R5: {path.name} could not be parsed, so it was NOT checked: {e}")
            continue
        if _restores_in_finally(tree):
            mutators.add(path.name)
            if _installs_handler(tree):
                protected.add(path.name)

    fail = list(errors)

    # R3 FLOOR FIRST, because every rule below is vacuous without a population.
    if len(mutators) < MUTATOR_FLOOR:
        fail.append(
            f"R3: found only {len(mutators)} mutate-and-restore scripts, floor is {MUTATOR_FLOOR}. "
            "A detector that stops recognising the shape reports a clean directory rather than a "
            "broken instrument. If scripts were deleted, lower the floor in the same diff.")

    # R1: a mutator with no handler that nobody has accounted for.
    for name in sorted(mutators - protected - UNPROTECTED):
        fail.append(
            f"R1: {name} mutates a tracked file and restores it in a `finally`, but installs no "
            "signal handler — a SIGTERM will strand the mutation in the working tree. Copy "
            "`restore_on_signal` from scripts/w11-expiry-subject-controls.py.")

    # R2: an entry that has been FIXED must leave the list, or the list rots into an excuse.
    for name in sorted(UNPROTECTED & protected):
        fail.append(
            f"R2: {name} now installs a handler but is still listed in UNPROTECTED. Remove the "
            "entry — this list may only shrink.")

    # R4: an entry that is no longer a mutator (deleted, renamed, or restructured) is stale.
    for name in sorted(UNPROTECTED - mutators):
        fail.append(
            f"R4: UNPROTECTED lists {name}, which is not a mutate-and-restore script here "
            "(deleted, renamed, or no longer restoring in a `finally`). Remove the entry.")

    print(f"restore-signal-handlers: {len(mutators)} mutate-and-restore scripts, "
          f"{len(protected)} protected, {len(UNPROTECTED)} listed as not yet fixed")
    if fail:
        for line in fail:
            print(f"::error::{line}" if len(sys.argv) > 1 and sys.argv[1] == "--ci" else line)
        return 1
    print("restore-signal-handlers: ok")
    return 0


sys.exit(main())
