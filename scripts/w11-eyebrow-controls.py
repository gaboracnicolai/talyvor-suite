#!/usr/bin/env python3
"""POSITIVE CONTROLS for the eyebrow audit (W1.1, tab-3d5f).

Every control asserts its ANCHOR — the exact bytes, and how many of them — BEFORE it writes,
verifies the bytes actually CHANGED ON DISK, and restores the tree byte-identically afterwards
(verified with `git diff --quiet`, not an exit code).

⚠ A CONTROL THAT BREAKS THE BUILD IS NOT A CONTROL. A syntax error reds every target and reads as
a caught mutation, so each control names the target it must RED and a companion that must stay
GREEN, and a control that reds both is reported SUSPECT rather than CAUGHT.

⚠ `NOT CAUGHT` IS AMBIGUOUS BY ITSELF — a blind guard and a behaviourally inert edit look the
same. Each control therefore states what it PREDICTS, and the harness prints prediction vs
observation so a surprise is visible rather than absorbed.

⚠ THE TWO RULES ARE DELIBERATELY SEPARATED IN THE TARGETS. `eyebrow-test` is the source rule plus
the fixture-driven predicate tests; `overview` / `members` / `pm` are SURFACE tests, where only the
running DOM audit and its floor can speak. A control caught by `eyebrow-test` alone says nothing
about the DOM half, and vice versa — which is the whole reason both exist.
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TARGETS = {
    'eyebrow-test': (['npx', 'vitest', 'run', 'src/eyebrowAudit.test.tsx'], 'apps/web'),
    'overview': (['npx', 'vitest', 'run', 'src/areas/lens/Overview.test.tsx'], 'apps/web'),
    'members': (['npx', 'vitest', 'run', 'src/areas/lens/Members.test.tsx'], 'apps/web'),
    'pm': (['npx', 'vitest', 'run', 'src/areas/docs/pm.test.tsx'], 'apps/web'),
    'resting': (['npx', 'vitest', 'run', 'src/restingAffordance.test.ts'], 'apps/web'),
    'case': (['npx', 'vitest', 'run', 'src/caseAudit.test.tsx'], 'apps/web'),
}


def run(name):
    cmd, cwd = TARGETS[name]
    p = subprocess.run(cmd, cwd=os.path.join(ROOT, cwd), capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def first_failure(out):
    for line in out.splitlines():
        s = line.strip()
        if s.startswith('→') or s.startswith('AssertionError'):
            return s[:150]
    for line in out.splitlines():
        if 'Error' in line:
            return line.strip()[:150]
    return '(no failure line)'


class Control:
    def __init__(self, name, path, old, new, red, green, predict, count=1):
        self.name, self.path, self.old, self.new = name, path, old, new
        self.red, self.green, self.predict, self.count = red, green, predict, count


CONTROLS = [
    # ── the product, really broken ────────────────────────────────────────────────────────────
    Control(
        'C1 a rendered eyebrow loses its uppercase',
        'apps/web/src/areas/lens/Overview.tsx',
        '<span className="font-figure text-eyebrow uppercase text-muted">',
        '<span className="font-figure text-eyebrow text-muted">',
        red='overview', green='resting',
        predict='CAUGHT by the DOM audit on the surface; the source rule reds too (both see it)',
        count=2,
    ),
    # ── the case ONLY the source rule can reach ───────────────────────────────────────────────
    Control(
        'C2 a new eyebrow in a branch no fixture renders',
        'apps/web/src/areas/lens/Members.tsx',
        "                      'font-figure text-eyebrow uppercase',",
        "                      'font-figure text-eyebrow uppercase',\n"
        "                      m.role === 'nobody-has-this-role' ? 'font-figure text-eyebrow' : '',",
        red='eyebrow-test', green='members',
        predict='SOURCE-ONLY: eyebrow-test reds, the Members surface stays green — the DOM '
                'cannot see an arm no fixture takes. This is why the source rule exists.',
    ),
    # ── the asymmetry between the two rules, made visible ─────────────────────────────────────
    Control(
        'C3 an eyebrow genuinely inherits its uppercase from a parent',
        'apps/web/src/areas/lens/Members.tsx',
        # ⚠ RE-INDENTED 14 -> 18 IN Members.tsx (W1.1.21c, tab-r5m2). A span-shaped anchor carries
        # its own leading whitespace, so a re-indent that changed no behaviour unanchored this
        # control silently. Verified by hand against Members.tsx.
        "                  <span\n                    className={cn(\n                      'font-figure text-eyebrow uppercase',\n                      m.role === 'owner' ? 'font-semibold text-ink' : 'text-muted',\n                    )}\n                  >\n                    {m.role}\n                  </span>",
        '                  <span className="uppercase">\n                    <span\n                      className={cn(\n                        \'font-figure text-eyebrow\',\n                        m.role === \'owner\' ? \'font-semibold text-ink\' : \'text-muted\',\n                      )}\n                    >\n                      {m.role}\n                    </span>\n                  </span>',
        red='eyebrow-test', green='members',
        predict='THE DOCUMENTED ASYMMETRY, NOT A DEFECT. The eyebrow really is uppercase — it '
                'inherits from the wrapper — so the DOM rule must stay GREEN on the surface '
                'while the strict source rule reds. If members also reds, the DOM rule is not '
                'modelling inheritance and the claim in eyebrowAudit.ts is false.',
    ),
    # ── the case ONLY the DOM rule can reach, which is what C13 is measured against ───────────
    Control(
        'C14 an eyebrow assembled so no literal carries the token',
        'apps/web/src/areas/lens/Members.tsx',
        "                      'font-figure text-eyebrow uppercase',",
        "                      'font-figure ' + 'text-' + 'eyebrow',",
        red='members', green='eyebrow-test',
        predict='DOM-ONLY: no quoted fragment contains the token, so the source rule is blind '
                'by construction (its stated limit). The running audit reds on the surface. '
                'This is the defect class the offender report in test-setup is the only catcher of.',
    ),
    # ── the DOM predicate ─────────────────────────────────────────────────────────────────────
    Control(
        'C4 eyebrowOffendersIn is blinded to return nothing',
        'apps/web/src/eyebrowAudit.ts',
        '  const out: EyebrowOffender[] = []\n  for (const el of Array.from(root.querySelectorAll',
        '  const out: EyebrowOffender[] = []\n  if (out.length === 0) return out\n'
        '  for (const el of Array.from(root.querySelectorAll',
        red='eyebrow-test', green='overview',
        predict='CAUGHT by the fixture predicate tests ONLY. The floor is computed from a '
                'separate walk and CANNOT see this — one catcher each, neither alone.',
    ),
    Control(
        'C5 isEyebrow is blinded to false',
        'apps/web/src/eyebrowAudit.ts',
        "  return (el.getAttribute('class') ?? '').split(/\\s+/).includes(EYEBROW_CLASS)",
        '  return false',
        red='eyebrow-test', green='resting',
        predict='CAUGHT twice — the predicate tests AND the floor (no eyebrow is counted '
                'anywhere), so overview should red as well.',
    ),
    Control(
        'C6 the observer is never installed (a dead audit)',
        'apps/web/src/eyebrowAudit.ts',
        '  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })',
        '  /* installed nothing */',
        red='overview', green='eyebrow-test',
        predict='FLOOR-ONLY: the surface reds because the file audited no eyebrow; the fixture '
                'tests call the predicate directly and stay green. This is the floor’s reason to exist.',
    ),
    # ── the seam both audits share ────────────────────────────────────────────────────────────
    Control(
        'C7 transformInEffect is blinded — the single edit that switches BOTH audits off',
        'apps/web/src/caseAudit.ts',
        "    const declared = declaredTransformOn(e)\n    if (declared !== null) return { transform: declared, from: e }",
        "    const declared = declaredTransformOn(e)\n    if (declared === null) return { transform: 'none', from: null }",
        red='eyebrow-test', green='resting',
        predict='CAUGHT by the eyebrow predicate tests AND by caseAudit’s own tests. Pinned '
                'because it is the shared seam — if only one of the two rules noticed, they '
                'would not really share a definition.',
    ),
    # ── the source rule’s own machinery ───────────────────────────────────────────────────────
    Control(
        'C8 the source predicate is blinded to false',
        'apps/web/src/eyebrowAudit.test.tsx',
        '  if (!new RegExp(`(^|\\\\s)${EYEBROW_CLASS}(\\\\s|$)`).test(fragment)) return false',
        '  return false\n  if (!new RegExp(`(^|\\\\s)${EYEBROW_CLASS}(\\\\s|$)`).test(fragment)) return false',
        red='eyebrow-test', green='overview',
        predict='CAUGHT by the both-directions predicate test. The sweep and its floor assert '
                'the WALK and never the MATCH, so they cannot see this.',
    ),
    Control(
        'C9 the source walk is emptied',
        'apps/web/src/eyebrowAudit.test.tsx',
        '  walk(root)\n  return out.sort()',
        '  return []',
        red='eyebrow-test', green='overview',
        predict='CAUGHT by the sweep floor (FILES.length > 60). A walker rooted at nothing '
                'reports zero offenders, which is what a clean product also reports.',
    ),
    Control(
        'C10 the comment blanking is dropped',
        'apps/web/src/eyebrowAudit.test.tsx',
        "  blankComments(readFileSync(file, 'utf8'))",
        "  (readFileSync(file, 'utf8'))",
        red='eyebrow-test', green='overview',
        predict='CAUGHT: caseAudit.ts quotes an eyebrow class list inside a doc comment to '
                'explain itself, so without blanking the guard condemns the documentation. A '
                'REAL occurrence, not a planted one.',
    ),
    Control(
        'C11 a stale classification entry is added',
        'apps/web/src/eyebrowAudit.test.tsx',
        "const NAMES_THE_CLASS: Record<string, string> = {",
        "const NAMES_THE_CLASS: Record<string, string> = {\n"
        "  'apps/web/src/caseAudit.ts|text-eyebrow no-such-thing': 'a fragment that is not there',",
        red='eyebrow-test', green='overview',
        predict='CAUGHT as STALE. The table must not become a place to put things that fail.',
    ),
    Control(
        'C12 a floor entry names a file that does not exist',
        'apps/web/src/eyebrowAudit.ts',
        "  'src/areas/lens/Members.test.tsx':",
        "  'src/areas/lens/MembersRenamed.test.tsx':",
        red='eyebrow-test', green='overview',
        predict='CAUGHT: a renamed test file would otherwise silently stop being a floor, '
                'because the entry would simply never match.',
    ),
    # ── the wiring ────────────────────────────────────────────────────────────────────────────
    Control(
        'C13 the offender report is removed from test-setup (audit runs, nobody reads it)',
        'apps/web/src/test-setup.ts',
        '  const uncased = takeEyebrowOffenders()\n  if (uncased.length > 0) {',
        '  const uncased = takeEyebrowOffenders()\n  if (false && uncased.length > 0) {',
        red='overview', green='eyebrow-test',
        predict='NOT CAUGHT while the product is clean, and that is the honest answer — the '
                'report is silent either way. Recorded as a documented gap; the source rule is '
                'the backstop that still speaks if a real defect lands.',
    ),
]


def apply(c):
    full = os.path.join(ROOT, c.path)
    src = open(full).read()
    n = src.count(c.old)
    if n != c.count:
        raise SystemExit(f'ANCHOR FAILED for {c.name}: {c.path} has {n} copies, expected {c.count}')
    new = src.replace(c.old, c.new, 1) if c.count == 1 else src.replace(c.old, c.new)
    if new == src:
        raise SystemExit(f'EDIT DID NOT CHANGE ANYTHING for {c.name}')
    open(full, 'w').write(new)
    on_disk = open(full).read()
    if on_disk == src:
        raise SystemExit(f'BYTES DID NOT CHANGE ON DISK for {c.name}')
    return src


def restore(c, original):
    open(os.path.join(ROOT, c.path), 'w').write(original)
    p = subprocess.run(['git', 'diff', '--quiet', '--', c.path], cwd=ROOT)
    if p.returncode != 0:
        raise SystemExit(f'RESTORE FAILED for {c.name}: {c.path} still differs')


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    p = subprocess.run(['git', 'diff', '--quiet'], cwd=ROOT)
    if p.returncode != 0:
        print('⚠ working tree is dirty relative to the index — controls need a known start')
    results = []
    for c in CONTROLS:
        if only and not c.name.startswith(only):
            continue
        original = apply(c)
        try:
            rc_red, out_red = run(c.red)
            rc_green, out_green = run(c.green)
        finally:
            restore(c, original)
        if rc_red != 0 and rc_green != 0:
            verdict = 'SUSPECT (both targets red — may be a broken build, not a caught mutation)'
        elif rc_red != 0:
            verdict = 'CAUGHT'
        else:
            verdict = 'NOT CAUGHT'
        results.append((c, verdict, first_failure(out_red), rc_green))
        print(f'\n{"="*100}\n{c.name}\n  target {c.red}: {"RED" if rc_red else "green"}   '
              f'companion {c.green}: {"RED" if rc_green else "green"}\n  VERDICT: {verdict}')
        print(f'  predicted: {c.predict}')
        if rc_red != 0:
            print(f'  failure:   {first_failure(out_red)}')

    print(f'\n\n{"="*100}\nSUMMARY')
    caught = sum(1 for _, v, _, _ in results if v == 'CAUGHT')
    for c, v, fail, _ in results:
        print(f'  {v:12}  {c.name}')
    print(f'\n  {caught}/{len(results)} CAUGHT')
    # ⚠ SCOPED TO THE TREE UNDER TEST. An unscoped `git diff` includes THIS FILE, so editing
    # the harness made it report a failed restore — a fact about the instrument wearing the
    # shape of a fact about the controls.
    #
    # ⚠⚠ AND `apps packages` WAS STILL THE WRONG SCOPE (W1.1.21c, tab-r5m2). It excludes THIS
    # harness, which lives at scripts/, and includes the SIX sibling harnesses under
    # apps/web/scripts/ — so a session repairing a stale anchor in any of them, which is exactly
    # the work this campaign keeps doing, gets `restored: False` from a tree that restored
    # perfectly. That is the same shape the comment above was written about, one directory over.
    #
    # The scope is DERIVED from the controls now: the only files this run may have written are the
    # ones the controls name. The floor is not decoration — with no controls the diff would cover
    # nothing, exit 0, and report a clean restore having compared nothing at all.
    touched = sorted({c.path for c in CONTROLS})
    assert touched, 'no control names a file — this check would pass having compared nothing'
    p = subprocess.run(['git', 'diff', '--quiet', '--', *touched], cwd=ROOT)
    print(f'  tree under test ({len(touched)} file(s)) restored byte-identically: '
          f'{p.returncode == 0}')


if __name__ == '__main__':
    main()
