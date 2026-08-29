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

WHAT COUNTS AS A MUTATOR — TWO DETECTORS, AND THE SECOND IS A CORRECTION TO THIS FILE'S FIRST
VERSION RATHER THAN AN ADDITION.

  NARROW: a script containing a `try` whose `finally` performs a write — `.write_text` /
  `.write_bytes` / `.writelines` / `.write`, or `shutil`/`os` copy/move.

  WIDE: a script that both READS file content (`.read_text` / `.read_bytes`) and WRITES it,
  whether or not there is a `try` anywhere.

⚠ THE FIRST VERSION OF THIS GUARD SHIPPED WITH THE NARROW DETECTOR ONLY, AND IT WAS BLIND TO THE
MORE DANGEROUS HALF. Measured by tab-r7k2 out of talyvor-code W3.63 (bfa11f4): scripts that
snapshot, mutate and restore ON THE HAPPY PATH WITH NO `try` AT ALL are not UNPROTECTED to the
narrow definition — they are INVISIBLE — and they strand the tree on ANY EXCEPTION, not merely on
a signal. TWO scripts in this directory are genuinely that shape. R6 below is their rule.

⚠⚠ AND THE FIRST WIDENING OVERSTATED IT BY A FACTOR OF FIVE, WHICH IS WHY `_writing_functions`
EXISTS. Keyed on a write CALL syntactically inside the `finally`, this repo showed ELEVEN
happy-path scripts; TEN of them restore INDIRECTLY (`finally: restore()`, `finally: revert(...)`)
and were misclassified. R6's message would have told a reader there is 'no try/finally at all'
about ten scripts that have one. Estate-wide the same correction takes 27 down to 13.

⚠ THE READ SET IS `{read_text, read_bytes}` AND WIDENING IT IS NOT AN IMPROVEMENT. Re-derived with
`{read_text, read_bytes, read, readlines}` the estate count goes 27 -> 109 and stops agreeing with
anything; a wider net is a DIFFERENT census, not a better one, and it needs a correspondingly
larger NOT_MUTATORS list to stay honest. The narrow read set reproduces tab-r7k2's figures exactly
(suite 11, docs 5, track 10, lens 1).

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

# ⚠⚠ ONE FLOOR PER DETECTOR, AND THIS IS THE MOST IMPORTANT LINE IN THE FILE.
#
# A SINGLE FLOOR OVER THE UNION OF TWO DETECTORS IS SATISFIED BY EITHER DETECTOR ALONE. Measured
# by tab-r7k2 in bfa11f4: stubbing the WIDE detector to `return False` came back GREEN, because
# the narrow one held the union count up — so the widened definition, the entire point of having
# two, could have silently reverted with the guard green. A vacuity floor over a union is not a
# vacuity floor. Controls G10/G11 blind each detector separately for exactly this reason.
#
# Both are FLOORS ON THE DETECTOR, not targets for the tree: a walk that stops recognising its
# shape reports a clean directory. Deleting scripts is legitimate — lower the floor in the same
# diff, with the deletions visible.
NARROW_FLOOR = 51   # 54 restore-in-`finally` scripts at 5de27e3, INCLUDING indirect restores
WIDE_FLOOR = 44     # 47 read-and-write scripts at 5de27e3

# The scripts that mutate-and-restore and do NOT yet install a handler, measured at a083c67.
# ⚠ THIS LIST MAY ONLY SHRINK. Adding to it is not a fix; R1 exists so that a new script cannot be
# written without a handler, and R2 exists so that a fixed script cannot be left listed.
UNPROTECTED = {
    "w11-audit-gate-controls.py",
    "w11-card-heading-controls.py",
    "w11-card-heading-drift-controls-c7k5.py",
    "w11-cited-guard-controls.py",
    "w11-clock-figure-face-controls.py",
    "w11-console-title-controls.py",
    "w11-control-parity-controls.py",
    "w11-dangling-claim-controls.py",
    "w11-debit-allowlist-controls.py",
    "w11-doc-subject-controls.py",
    "w11-env-documented-controls.py",
    "w11-eyebrow-controls.py",
    "w11-focus-controls.py",
    "w11-formatter-reach-controls.py",
    "w11-glyph-controls.py",
    "w11-ledger-identity-controls.py",
    "w11-model-tier-controls.py",
    "w11-placeholder-controls.py",
    "w11-plane-controls.py",
    "w11-pointer-pins-controls.py",
    "w11-press-c1-controls-c7k5.py",
    "w11-press-controls.py",
    "w11-probe-status-controls.py",
    "w11-rendered-clock-controls.py",
    "w11-selection-controls.py",
    "w11-spa-fallback-controls.py",
    "w11-state-transition-controls.py",
    "w11-type-scale-controls.py",
    "w11-ui-manifest-controls.py",
    "w11-uppercase-count-controls.py",
    "w110-clockpin-controls-q4vn.py",
    "w110-page-scale-controls-q4vn.py",
    "w1112-row-hint-controls-m3r8.py",
    "w1114-cardinal-controls.py",
    "w1117-motion-census-derivation-controls-c7k5.py",
    "w1117-motion-census-m3w8.py",
    "w1120-anchor-check-controls-h3n8.py",
    "w1121d-anchor-check-widen-controls-r5m2.py",
    "w1121d-anchor-check-write-target-controls-j8w4.py",
    "w1121d-prediction-check-controls-p9r4.py",
    "w1121e-path-invariance-controls-p9r4.py",
    "w1121f-anchor-check-fstring-controls-c7k5.py",
    "w1121h-anchor-check-prose-controls-c7k5.py",
    "w117-issuelist-controls-q4vn.py",
    "w118-issuedetail-controls-m3w8.py",
    "w119-spacelist-controls-m3w8.py",
    "w119a-spaceview-controls-m3w8.py",
    "w17-keysweep-per-route-controls-m3r8.py",
    "w17-mounted-patterns-controls-m5x8.py",
    "w171-docs-pagewrite-controls.py",
    "w24-count-cost-5c2e.py",
}

# HAPPY_PATH_ONLY holds the scripts the WIDE detector found that restore WITHOUT a `try` at all.
# They are a WORSE failure than an entry in UNPROTECTED, not a lesser one: an unprotected `finally`
# strands only on a signal, these strand on ANY exception. Measured at 5de27e3 — 11 of them, and
# the first version of this guard could not see a single one.
#
# ⚠ THIS LIST MAY ONLY SHRINK, and it is kept SEPARATE from UNPROTECTED deliberately: folding the
# two would let a script leave the harder list by acquiring a handler while still having no
# `finally`. R2b fails on an entry that has gained one; R4b on one the detector no longer finds.
HAPPY_PATH_ONLY = {
    "w11-display-sweep-controls.py",
}

# NOT_MUTATORS holds scripts the WIDE detector catches that do not actually restore a tracked
# file — a wide net manufactures false positives, and parking one here without a REASON is a hole
# rather than a classification. R7 fails on an unexplained entry; R4 fails on one that is no
# longer a candidate. It is empty today: every one of the 11 the wide net found here is a genuine
# happy-path restore, verified by reading them.
NOT_MUTATORS: dict[str, str] = {}

_WRITE_ATTRS = {"write_text", "write_bytes", "writelines", "write"}
_COPY_FUNCS = {"copy", "copy2", "copyfile", "move"}
_READ_ATTRS = {"read_text", "read_bytes"}


def _write_call(n: ast.AST) -> bool:
    if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)):
        return False
    if n.func.attr in _WRITE_ATTRS:
        return True
    return (n.func.attr in _COPY_FUNCS and isinstance(n.func.value, ast.Name)
            and n.func.value.id in ("shutil", "os"))


def _writes(body) -> bool:
    """True if this statement list performs a filesystem write."""
    return any(_write_call(n) for n in ast.walk(ast.Module(body=body, type_ignores=[])))


def _reads_and_writes(tree: ast.AST) -> bool:
    """The WIDE net: the script both reads file content and writes it, `try` or no `try`."""
    reads = any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr in _READ_ATTRS for n in ast.walk(tree))
    return reads and any(_write_call(n) for n in ast.walk(tree))


def _writing_functions(tree: ast.AST) -> set:
    """Names of functions defined in this module whose body performs a write.

    ⚠ THIS EXISTS BECAUSE THE FIRST VERSION OF THIS DETECTOR WAS WRONG ABOUT TEN OF ELEVEN
    SCRIPTS, AND THE FAILURE MESSAGE IT WOULD HAVE PRINTED WAS A FALSE STATEMENT ABOUT THEM.
    `_writes(finalbody)` looks for a write CALL syntactically inside the `finally`. These scripts
    restore INDIRECTLY — `finally: restore()`, `finally: revert(...)`, `finally: git_restore()` —
    so the walk saw a `finally` with no write in it and classified them as having no `try` at all.
    Ten of the eleven this repo's wide net first flagged are that shape; exactly one
    (w11-spa-cache-controls.py) genuinely has no `try`.

    One level of indirection is deliberately all this resolves. It is a syntactic guard, not an
    interpreter, and a restore reached through two hops would be reported as happy-path — wrongly,
    but LOUDLY and in the direction that asks a human to look, which is the safe direction here.
    """
    out = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and _writes(n.body):
            out.add(n.name)
    return out


def _restores_in_finally(tree: ast.AST) -> bool:
    writers = _writing_functions(tree)
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Try) and n.finalbody):
            continue
        if _writes(n.finalbody):
            return True
        # INDIRECT: the `finally` calls a function defined here that writes.
        for c in ast.walk(ast.Module(body=n.finalbody, type_ignores=[])):
            if isinstance(c, ast.Call):
                f = c.func
                name = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else None)
                if name in writers:
                    return True
    return False


def _installs_handler(tree: ast.AST) -> bool:
    """A call to `signal.signal(...)`. Comments are invisible to ast, which is the point."""
    return any(
        isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
        and n.func.attr == "signal"
        and isinstance(n.func.value, ast.Name) and n.func.value.id == "signal"
        for n in ast.walk(tree)
    )


def main() -> int:
    narrow, wide, protected, errors = set(), set(), set(), []
    for path in sorted(SCRIPTS.glob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError) as e:
            # R5: a file this guard cannot read is reported, never skipped. A walk that silently
            # drops what it cannot parse reports a clean directory.
            errors.append(f"R5: {path.name} could not be parsed, so it was NOT checked: {e}")
            continue
        if _restores_in_finally(tree):
            narrow.add(path.name)
        if _reads_and_writes(tree):
            wide.add(path.name)
        if (path.name in narrow or path.name in wide) and _installs_handler(tree):
            protected.add(path.name)

    fail = list(errors)

    # R3 FLOORS FIRST, PER DETECTOR, because every rule below is vacuous without a population and
    # a union floor would let either detector die unnoticed.
    if len(narrow) < NARROW_FLOOR:
        fail.append(
            f"R3: the `finally`-restore detector found only {len(narrow)} scripts, floor is "
            f"{NARROW_FLOOR}. A detector that stops recognising its shape reports a clean "
            "directory rather than a broken instrument.")
    if len(wide) < WIDE_FLOOR:
        fail.append(
            f"R3b: the read-and-write detector found only {len(wide)} scripts, floor is "
            f"{WIDE_FLOOR}. This floor is SEPARATE from the one above on purpose: a single floor "
            "over the union is satisfied by either detector alone, so the wide half could revert "
            "to silence with the guard green.")

    # R1: a `finally`-restoring script with no handler that nobody has accounted for.
    for name in sorted(narrow - protected - UNPROTECTED):
        fail.append(
            f"R1: {name} mutates a tracked file and restores it in a `finally`, but installs no "
            "signal handler — a SIGTERM will strand the mutation in the working tree. The shape "
            "to copy is in scripts/w11-expiry-subject-controls.py#restore_on_signal.")

    # R6: restoring only on the HAPPY PATH is worse than an unprotected `finally`, not better —
    # it strands the tree on any exception, not merely on a signal.
    for name in sorted(wide - narrow - NOT_MUTATORS.keys() - HAPPY_PATH_ONLY):
        fail.append(
            f"R6: {name} reads and writes tracked files but restores them on the HAPPY PATH only "
            "— there is no `try`/`finally` at all, so any exception strands the mutation. Wrap the "
            "restore in a `finally` AND install a handler, or classify it in NOT_MUTATORS with a "
            "reason.")

    # R2: an entry that has been FIXED must leave the list, or the list rots into an excuse.
    for name in sorted(UNPROTECTED & protected):
        fail.append(
            f"R2: {name} now installs a handler but is still listed in UNPROTECTED. Remove the "
            "entry — this list may only shrink.")
    for name in sorted(HAPPY_PATH_ONLY & narrow):
        fail.append(
            f"R2b: {name} now restores in a `finally` but is still listed in HAPPY_PATH_ONLY. "
            "Remove the entry — this list may only shrink.")

    # R4: an entry that is no longer a candidate (deleted, renamed, restructured) is stale.
    for name in sorted(UNPROTECTED - narrow):
        fail.append(
            f"R4: UNPROTECTED lists {name}, which is not a `finally`-restoring script here. "
            "Remove the entry.")
    for name in sorted(HAPPY_PATH_ONLY - wide):
        fail.append(
            f"R4b: HAPPY_PATH_ONLY lists {name}, which the read-and-write detector no longer "
            "finds. Remove the entry.")
    for name in sorted(set(NOT_MUTATORS) - wide):
        fail.append(
            f"R4c: NOT_MUTATORS lists {name}, which the read-and-write detector no longer finds. "
            "Remove the entry.")

    # R7: an unexplained exemption is a hole, not a classification.
    for name, why in sorted(NOT_MUTATORS.items()):
        if not why.strip():
            fail.append(
                f"R7: NOT_MUTATORS lists {name} with no reason. An entry nobody had to justify is "
                "a hole in the population, not a classification.")

    print(f"restore-signal-handlers: {len(narrow)} restore-in-`finally`, {len(wide)} read-and-write, "
          f"{len(protected)} protected; {len(UNPROTECTED)} awaiting a handler, "
          f"{len(HAPPY_PATH_ONLY)} awaiting a `finally`, {len(NOT_MUTATORS)} classified not-mutators")
    if fail:
        ci = len(sys.argv) > 1 and sys.argv[1] == "--ci"
        for line in fail:
            print(f"::error::{line}" if ci else line)
        return 1
    print("restore-signal-handlers: ok")
    return 0


sys.exit(main())
