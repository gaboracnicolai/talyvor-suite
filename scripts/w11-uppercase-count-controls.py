#!/usr/bin/env python3
"""Positive controls for caseCallSites.test.ts — the uppercase call-site count.

Every control: asserts its anchor count BEFORE any write, verifies the bytes
changed ON DISK, names a MUST-RED target AND a MUST-STAY-GREEN companion, and
restores the tree byte-identically (checked with `git diff`, not an exit code).

⚠ THE GUARD PASSED ON ITS FIRST RUN AFTER THE FIX, WHICH IS WHY THIS EXISTS.
Two of its nine tests were red before caseAudit.ts was touched and seven were
green from the start; a green assertion that has never been made to fail is
indistinguishable from one that cannot.

⚠ C10 IS THE MUTATION THAT EARNS THE UNIT.  Blinding the census's comment
blanking turns 21 into the number that caused the defect in the first place —
`#99` counted the PARAGRAPHS ABOUT the class alongside the uses of it and wrote
25.  Nothing else in either package distinguishes those two queries.

⚠ C11 IS ONE-DIRECTIONAL BY DESIGN: prose that states no count must NOT be
condemned, or this guard is just "any comment edit reds".

Usage:  python3 scripts/w11-uppercase-count-controls.py
"""
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / 'apps/web'
GUARD = 'src/caseCallSites.test.ts'
CASE = 'src/caseAudit.test.tsx'
POINTER = 'src/pointerAudit.test.ts'

CAUGHT, MISSED = 'CAUGHT', 'NOT CAUGHT'


def vitest(target: str) -> bool:
    """True == green."""
    p = subprocess.run(['npx', 'vitest', 'run', target], cwd=WEB,
                       capture_output=True, text=True)
    return p.returncode == 0


def vitest_output(target: str) -> str:
    p = subprocess.run(['npx', 'vitest', 'run', target], cwd=WEB,
                       capture_output=True, text=True)
    return p.stdout + p.stderr


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


CA = 'apps/web/src/caseAudit.ts'
GUARD_SRC = 'apps/web/src/caseCallSites.test.ts'

# ⚠ RE-ANCHORED 21 -> 32 AT W1.1.21, AND THE NUMBER WAS CHECKED BEFORE IT WAS CHANGED. The
# product genuinely grew: caseCallSites.test.ts carries a per-step change log for it (21 -> 23 at
# W1.1.1 when Overview was rebuilt into regions, 30 -> 32 at W4.6.1 step 7 when /earnings added the
# per-row `kind` label and its breakdown) and runs 9/9 GREEN at 32. So this is tracked growth, not
# a census that drifted. THE REPLACEMENTS ARE DELIBERATELY UNCHANGED: TWENTY and 25 are #99's own
# two wrong answers, and they are still wrong against 32. Re-deriving them from the new number
# would throw away the provenance that makes these two controls mean anything.
# ⚠ A COUNT WRITTEN INTO AN ANCHOR IS A CLAIM ABOUT THE TREE WITH AN EXPIRY DATE. When the product
# moved past it this control did not fail — it became unable to RUN, which reads as silence.
# `scripts/w1120-anchor-check-h3n8.py` is what noticed; nothing else did, for eleven counts.

# (id, description, [edits], must-stay-green companion, expected verdict)
CONTROLS = [
    ('C1', 'put #99’s TWENTY back at the top of caseAudit.ts — off by one, the `other` dropped',
     [(CA, 'problem: 32 uppercase class lists in', 'problem: TWENTY uppercase class lists in')],
     CASE, CAUGHT),

    ('C2', 'put #99’s 25 back beside TRANSFORM_CLASSES — the word count, not the use count',
     [(CA, '`uppercase` (32 class lists apply it)', '`uppercase` (25 class lists apply it)')],
     CASE, CAUGHT),

    # ⚠ THE PRODUCT-SIDE CONTROL.  Nothing else in either package counts these, so a real
    # surface change silently invalidating a sentence is exactly the drift this guard is for.
    ('C3', 'a 33rd call site lands — `uppercase` added to a real class list in TrackArea',
     [('apps/web/src/areas/track/TrackArea.tsx',
       '<span className="text-caption text-faint">live · membership-scoped</span>',
       '<span className="text-caption uppercase text-faint">live · membership-scoped</span>')],
     CASE, CAUGHT),

    ('C4', 'a NEW unpinned count sentence in a product comment — the set floor, addition',
     [('packages/ui/src/components/Pill.tsx', 'export function Pill(',
       '// Two uppercase class lists ship from this file.\nexport function Pill(')],
     CASE, CAUGHT),

    ('C5', 'DELETE a classified claim — drop the cardinal from CaseSafe’s sentence, set floor, deletion',
     [('packages/ui/src/components/CaseSafe.tsx',
       'while twenty other `uppercase` class lists', 'while other `uppercase` class lists')],
     CASE, CAUGHT),

    # ⚠ PAST IS NOT A FREE PASS.  A past-tense count cannot be checked against today's census,
    # so it is checked against the census this merge measured at `dc0bd07` and recorded.
    ('C6', 'a PAST claim’s number is edited — MuNumeral’s twenty becomes thirty',
     [('packages/ui/src/components/MuNumeral.tsx',
       'while twenty other `uppercase` class lists', 'while thirty other `uppercase` class lists')],
     CASE, CAUGHT),

    ('C7', 'blind the census — the token test never matches, so the product reads as having none',
     [(GUARD_SRC, 'if (!TOKEN.test(fragment)) continue\n          if (NAMES_THE_CLASS',
       'if (true) continue\n          if (NAMES_THE_CLASS')],
     CASE, CAUGHT),

    ('C8', 'remove a NAMES_THE_CLASS entry — an unclassified naming occurrence must not pass',
     [(GUARD_SRC, "  'apps/web/src/eyebrowAudit.ts|uppercase':",
       "  'apps/web/src/eyebrowAudit.ts|UNUSED-KEY':")],
     CASE, CAUGHT),

    ('C9', 'add a NAMES_THE_CLASS entry matching nothing — a stale classification is a lie',
     [(GUARD_SRC, "const NAMES_THE_CLASS: Record<string, string> = {",
       "const NAMES_THE_CLASS: Record<string, string> = {\n  'apps/web/src/App.tsx|uppercase': 'matches nothing on disk',")],
     CASE, CAUGHT),

    # ⚠ THE MUTATION ONLY THIS GUARD CAN SEE, and the one that earns the UNIT rather than the
    # number: counting the prose ABOUT the class alongside the uses of it is precisely the query
    # that produced `#99`'s 25, and today it produces 71.
    ('C10', 'blind the census’s comment blanking — count the paragraphs about the class too',
     [(GUARD_SRC,
       "    blankComments(readFileSync(file, 'utf8'))\n      .split('\\n')\n      .forEach((line, i) => {\n        for (const m of line.matchAll(/['\"`]([^'\"`]*)['\"`]/g)) {\n          const fragment = m[1].replace(/\\s+/g, ' ').trim()\n          if (!TOKEN.test(fragment)) continue\n          if (NAMES_THE_CLASS",
       "    readFileSync(file, 'utf8')\n      .split('\\n')\n      .forEach((line, i) => {\n        for (const m of line.matchAll(/['\"`]([^'\"`]*)['\"`]/g)) {\n          const fragment = m[1].replace(/\\s+/g, ' ').trim()\n          if (!TOKEN.test(fragment)) continue\n          if (NAMES_THE_CLASS")],
     CASE, CAUGHT),

    # ⚠ ONE-DIRECTIONAL BY DESIGN: a comment edit that states no count must NOT be condemned.
    ('C11', 'meta-control: reword prose that carries no number — must NOT be caught',
     [(CA, ' * The `uppercase` and the µ are in different places',
       ' * The `uppercase` and the µ sit in different places')],
     CASE, MISSED),
]


def main():
    if not tree_clean_except([]):
        print('⚠ working tree is dirty before the run — commit or stash first')
        print(subprocess.run(['git', 'status', '--porcelain'], cwd=REPO,
                             capture_output=True, text=True).stdout)
        return 2

    print('baseline: guard green? ', end='', flush=True)
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
