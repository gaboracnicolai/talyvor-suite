#!/usr/bin/env python3
"""Positive controls for apps/web/scripts/check-audit-gate.mjs — the single enforcement
point shared by all seven DOM audits.

Every control: asserts its anchor count BEFORE any write, verifies the bytes changed ON
DISK, names a MUST-RED target AND a MUST-STAY-GREEN companion, and restores the tree
byte-identically (checked with `git diff`, not an exit code).

⚠ C1 IS THE WHOLE ITEM AND ITS COMPANION IS THE POINT. Blinding the gate must red this
check while the vitest suite STAYS GREEN — "the guard fired" and "everything fired" are
the same observation otherwise, and here the must-stay-green half is also the finding:
nothing else in the repo can see it.

⚠ C6 EARNS THE NEGATIVE HALF. Without an empty probe that must PASS, "the armed run
failed" cannot be told apart from "vitest is broken", which is exactly how `319335c`'s
C3 nearly scored a broken build as a catch.

⚠ C2 AND C6 ARE WHY THIS HARNESS EXISTS AT ALL. Both scored NOT CAUGHT on the first run
against a check whose green output looked correct: it asked "did this audit name itself"
by grepping the vitest output for `src/caseAudit.ts`, and vitest prints that path in the
STACK TRACE for every audit that is INSTALLED, reported or not. The check was reading its
own subject matter's stack frames. It now matches each report block's opening PHRASE.

Usage:  python3 scripts/w11-audit-gate-controls.py
"""
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / 'apps/web'
COMPANION = 'src/caseAudit.test.tsx'

CAUGHT, MISSED = 'CAUGHT', 'NOT CAUGHT'


def gate() -> bool:
    """True == the audit-gate check passed."""
    p = subprocess.run(['node', 'scripts/check-audit-gate.mjs'], cwd=WEB,
                       capture_output=True, text=True)
    return p.returncode == 0


def gate_message() -> str:
    p = subprocess.run(['node', 'scripts/check-audit-gate.mjs'], cwd=WEB,
                       capture_output=True, text=True)
    return (p.stdout + p.stderr).strip().split('\n')[0]


def vitest(target: str) -> bool:
    p = subprocess.run(['npx', 'vitest', 'run', target], cwd=WEB,
                       capture_output=True, text=True)
    return p.returncode == 0


def tree_clean() -> bool:
    p = subprocess.run(['git', 'status', '--porcelain'], cwd=REPO,
                       capture_output=True, text=True)
    return p.stdout.strip() == ''


class Edit:
    """One anchored substitution, applied and reverted from the file's own bytes."""

    def __init__(self, rel, old, new, expect=1):
        self.path = REPO / rel
        self.rel, self.old, self.new, self.expect = rel, old, new, expect
        self.backup = None

    def apply(self):
        text = self.path.read_text()
        n = text.count(self.old)
        if n != self.expect:
            raise AssertionError(f'ANCHOR {self.rel}: {self.old[:60]!r} found {n}x, want {self.expect}x')
        self.backup = text
        new = text.replace(self.old, self.new)
        if new == text:
            raise AssertionError(f'NO-OP edit in {self.rel}')
        self.path.write_text(new)
        if self.path.read_text() != new:
            raise AssertionError(f'WRITE DID NOT LAND: {self.rel}')

    def revert(self):
        if self.backup is not None:
            self.path.write_text(self.backup)


SETUP = 'apps/web/src/test-setup.ts'
CHECK = 'apps/web/scripts/check-audit-gate.mjs'

# (id, description, [edits], expected verdict)
CONTROLS = [
    # ⚠ THE FINDING ITSELF. One predicate, seven audits, and the companion must stay green.
    ('C1', 'blind the gate — one predicate silences all seven audits',
     [(SETUP, "if (problems.length > 0) throw new Error", "if (false) throw new Error")],
     CAUGHT),

    ('C2', 'silence ONE audit’s report block — focus stops naming itself',
     [(SETUP, 'if (unringed.length > 0) {', 'if (unringed.length > 0 && false) {')],
     CAUGHT),

    ('C3', 'an EIGHTH report block appears — the pinned set and the source count disagree',
     [(SETUP, '  if (problems.length > 0) throw new Error',
       "  if (problems.length < 0) problems.push('')\n  if (problems.length > 0) throw new Error")],
     CAUGHT),

    # ⚠ C4 SCORES NOT CAUGHT AND IS SHIPPED AS DOCUMENTED-INERT. The yield was written in
    # because the audits scan on a MICROTASK and caseAudit.ts records a shape where that
    # matters — a stepper whose states are rendered and replaced in ONE synchronous block is
    # sampled only at the last one. MEASURED: this fixture renders ONCE, so removing the yield
    # changes nothing and the guard is right to stay quiet. A NOT CAUGHT that is behaviourally
    # inert is a limit worth recording, not a result to bury.
    ('C4', 'drop the probe’s yield — inert for a single-render fixture, and measured so',
     [(CHECK, "    await new Promise((r) => setTimeout(r, 0))\n", "")],
     MISSED),

    ('C5', 'break the EMPTY probe — a failing harness must not read as a caught offender',
     [(CHECK, "    expect(document.body.textContent).toBe('')",
       "    expect(document.body.textContent).toBe('not empty')")],
     CAUGHT),

    ('C6', 'empty the armed fixture — an armed probe with no offender must not read as a pass',
     [(CHECK, '<span class="uppercase">µLXC</span>', '<span>lxc</span>')],
     CAUGHT),

    # ⚠ ONE-DIRECTIONAL BY DESIGN: prose that changes no behaviour must NOT be condemned.
    ('C7', 'meta-control: reword a comment in test-setup.ts — must NOT be caught',
     [(SETUP, '// ⚠ BOTH audits are read in ONE hook and reported together.',
       '// ⚠ BOTH audits are read in a SINGLE hook and reported together.')],
     MISSED),
]


def main():
    if not tree_clean():
        print('⚠ working tree is dirty before the run — commit or stash first')
        print(subprocess.run(['git', 'status', '--porcelain'], cwd=REPO,
                             capture_output=True, text=True).stdout)
        return 2

    print('baseline: audit-gate green? ', end='', flush=True)
    if not gate():
        print('NO — a control run against a red baseline measures nothing')
        return 2
    print('YES')

    rows, bad = [], 0
    for cid, desc, edits, expect in CONTROLS:
        objs = [Edit(*e) for e in edits]
        msg = ''
        try:
            for o in objs:
                o.apply()
            green = gate()
            verdict = MISSED if green else CAUGHT
            if not green:
                msg = gate_message()[:78]
            comp_green = vitest(COMPANION)
            # ⚠ a companion that goes red turns "the guard fired" into "everything fired"
            if not comp_green:
                verdict = f'SUSPECT (companion {COMPANION} went red)'
        finally:
            for o in reversed(objs):
                o.revert()
        restored = tree_clean()
        ok = (verdict == expect) and restored
        bad += 0 if ok else 1
        rows.append((cid, 'OK ' if ok else 'FAIL', expect, verdict, restored, desc, msg))

    print()
    for cid, ok, expect, verdict, restored, desc, msg in rows:
        print(f'{cid:4} {ok}  want={expect:10} got={verdict:10} restored={restored}  {desc}')
        if msg:
            print(f'       ↳ {msg}')
    print()
    print(f'{len(rows) - bad}/{len(rows)} controls behaved as specified')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
