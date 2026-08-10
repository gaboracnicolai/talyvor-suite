#!/usr/bin/env python3
"""Positive controls for pointerAudit.test.ts — the file:line pin.

Every control: asserts its anchor count BEFORE any write, verifies the bytes
changed ON DISK, names a MUST-RED target AND a MUST-STAY-GREEN companion, and
restores the tree byte-identically (checked with `git diff`, not an exit code).

⚠ WHY A MUST-STAY-GREEN COMPANION IS NOT OPTIONAL.  `319335c`'s C3 ran as a
BROKEN BUILD and would have scored as a catch — an unbalanced tag reds every
target, so "the guard failed" and "everything failed" are the same observation
until something is required to stay green.

⚠ AND ONE CONTROL MUST BE A MUTATION ONLY THIS GUARD CAN SEE (C9), or the pin
has not been shown to earn its place next to the seven audits already here.

Usage:  python3 scripts/w11-pointer-pins-controls.py
"""
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / 'apps/web'
GUARD = 'src/pointerAudit.test.ts'
CASE = 'src/caseAudit.test.tsx'
RESTING = 'src/restingAffordance.test.ts'

CAUGHT, MISSED = 'CAUGHT', 'NOT CAUGHT'


def vitest(target: str) -> bool:
    """True == green."""
    p = subprocess.run(['npx', 'vitest', 'run', target], cwd=WEB,
                       capture_output=True, text=True)
    return p.returncode == 0


def tree_clean_except(paths) -> bool:
    p = subprocess.run(['git', 'diff', '--name-only'], cwd=REPO,
                       capture_output=True, text=True)
    changed = {l for l in p.stdout.split('\n') if l}
    return changed <= set(paths)


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
            raise AssertionError(f'ANCHOR {self.rel}: {self.old[:50]!r} found {n}x, want {self.expect}x')
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


# (id, description, [edits], must-stay-green companion, expected verdict)
CONTROLS = [
    ('C1', 'revert caseAudit.ts:11 to the stale MuNumeral.tsx:19',
     [('apps/web/src/caseAudit.ts', '(CaseSafe.tsx:85).', '(MuNumeral.tsx:19).')], CASE, CAUGHT),

    ('C2', 'revert the DEVELOPER-FACING failure message in test-setup.ts:181',
     [('apps/web/src/test-setup.ts', 'normal-case span (CaseSafe.tsx:85 is the shape)',
       'normal-case span (MuNumeral.tsx:19 is the shape)')], CASE, CAUGHT),

    ('C3', 'revert caseAudit.ts:42 to the stale Landing.tsx:72',
     [('apps/web/src/caseAudit.ts', 'Landing.tsx:78 is `<span', 'Landing.tsx:72 is `<span')], CASE, CAUGHT),

    # ⚠ THE CONTROL THAT EARNS THE GUARD.  Pointers do not rot by being edited; they
    # rot when somebody inserts a line ABOVE the thing they name.  This is that, and
    # nothing else in either package can see it.
    ('C4', 'insert ONE blank line above Landing.tsx:78 — the real drift mechanism',
     [('apps/web/src/areas/marketing/Landing.tsx',
       '      </span>\n      <span className="font-figure text-eyebrow uppercase text-faint">',
       '      </span>\n\n      <span className="font-figure text-eyebrow uppercase text-faint">')], CASE, CAUGHT),

    ('C5', 'add an UNCLASSIFIED pointer — the set floor, addition direction',
     [('apps/web/src/placeholderAudit.ts', ' * ── WHY IT READS THE DOM ',
       ' * (compare Button.tsx:37.)\n *\n * ── WHY IT READS THE DOM ')], CASE, CAUGHT),

    ('C6', 'DELETE a classified pointer — the set floor, deletion direction',
     [('apps/web/src/placeholderAudit.ts', '`Keys.tsx:96` passes', 'that component passes')], CASE, CAUGHT),

    # ⚠ INVERTED, AND PAIRED WITH THE MUTATION ITS OWN PREDICATE GOVERNS.
    # ⚠ THIS CONTROL FIRST RAN AGAINST C1 AND SCORED "CAUGHT" WITH THE PREDICATE BLINDED,
    # which reads as a dead instrument and is not.  C1 edits the pointer TEXT, so it moves
    # the census KEY and the set-equality test condemns it before the fragment comparison
    # is ever reached — an assertion above the blinded one fires first, the exact shape
    # `298b659` paid for.  The LIVE fragment check governs the case where the key is
    # UNCHANGED and the target line moved underneath it: that is C4, and only C4.
    ('C7', 'blind the LIVE predicate WITH C4 applied — must go quiet',
     [('apps/web/src/areas/marketing/Landing.tsx',
       '      </span>\n      <span className="font-figure text-eyebrow uppercase text-faint">',
       '      </span>\n\n      <span className="font-figure text-eyebrow uppercase text-faint">'),
      ('apps/web/src/pointerAudit.test.ts', 'if (!body.includes(pin.fragment)) {', 'if (false) {')],
     CASE, MISSED),

    # ⚠ AND THE SAME PAIRING FOR THE OTHER DIRECTION: blinding the HISTORICAL comparison
    # must make C9 go quiet.  Without this, "3 of 11 are HISTORICAL" is a claim no control
    # supports — a new classifier is blind to its own inverse until something exercises it.
    ('C8', 'blind the HISTORICAL predicate WITH C9 applied — must go quiet',
     [('apps/web/src/areas/track/IssueList.tsx',
       'without a resting affordance". It was not the only one: this cell is the link,',
       'without a resting affordance" (hover:underline). It was not the only one: the link,'),
      ('apps/web/src/pointerAudit.test.ts',
       'if (body !== undefined && body.includes(pin.fragment)) {', 'if (false) {')],
     RESTING, MISSED),

    # ⚠ A MUTATION ONLY THIS GUARD CAN SEE.  Line 357 is inside a comment, and
    # restingAffordance.test.ts blanks comments before it looks — so its own subject
    # matter, planted at its own quoted line, is invisible to it and visible here.
    ('C9', 'a HISTORICAL pointer becomes true again (hover:underline back at IssueList.tsx:357)',
     [('apps/web/src/areas/track/IssueList.tsx',
       'without a resting affordance". It was not the only one: this cell is the link,',
       'without a resting affordance" (hover:underline). It was not the only one: the link,')],
     RESTING, CAUGHT),

    # ⚠ ONE-DIRECTIONAL BY DESIGN: prose that touches no pointer must NOT be condemned.
    ('C10', 'meta-control: a comment edit that moves no pointer — must NOT be caught',
     [('apps/web/src/caseAudit.ts', ' * The `uppercase` and the µ are in different places',
       ' * The `uppercase` and the µ live in different places')], CASE, MISSED),
]


def main():
    if not tree_clean_except([]):
        print('⚠ working tree is dirty before the run — commit or stash first')
        print(subprocess.run(['git', 'status', '--porcelain'], cwd=REPO,
                             capture_output=True, text=True).stdout)
        return 2

    print(f'baseline: guard green? ', end='', flush=True)
    base = vitest(GUARD)
    print('YES' if base else 'NO — a control run against a red baseline measures nothing')
    if not base:
        return 2

    rows, bad = [], 0
    for cid, desc, edits, companion, expect in CONTROLS:
        objs = [Edit(*e) for e in edits]
        try:
            for o in objs:
                o.apply()
            guard_green = vitest(GUARD)
            comp_green = vitest(companion)
            verdict = MISSED if guard_green else CAUGHT
            # ⚠ a companion that goes red turns "the guard fired" into "everything fired"
            if not comp_green:
                verdict = f'SUSPECT (companion {companion} went red)'
        finally:
            for o in reversed(objs):
                o.revert()
        restored = tree_clean_except([])
        ok = (verdict == expect) and restored
        bad += 0 if ok else 1
        rows.append((cid, 'OK ' if ok else 'FAIL', expect, verdict, restored, desc))

    print()
    w = max(len(r[5]) for r in rows)
    for cid, ok, expect, verdict, restored, desc in rows:
        print(f'{cid:4} {ok}  want={expect:10} got={verdict:10} restored={restored}  {desc[:w]}')
    print()
    print(f'{len(rows) - bad}/{len(rows)} controls behaved as specified')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
