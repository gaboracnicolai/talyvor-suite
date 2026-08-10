#!/usr/bin/env python3
"""POSITIVE CONTROLS for the plane audit (W1.1, tab-4f7c).

Every control asserts its ANCHOR — the exact bytes, and how many of them — BEFORE it writes, and
restores the tree byte-identically afterwards (verified with `git diff --quiet`, not an exit code).

⚠ A CONTROL THAT BREAKS THE BUILD IS NOT A CONTROL. A syntax error reds every target and reads as
a caught mutation, so each control names the target it must RED and a companion target that must
stay GREEN, and a control that reds both is reported SUSPECT rather than CAUGHT.

⚠ AND `NOT CAUGHT` IS AMBIGUOUS BY ITSELF: it means either a blind guard or an edit that changed
no behaviour. So every control prints the first line of the failure it produced, and the harness
refuses to score a control whose anchor count it did not verify.
"""
import subprocess, sys, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WEB = ['npx', 'vitest', 'run']
UI = ['npx', 'vitest', 'run']


def run(cmd, cwd):
    p = subprocess.run(cmd, cwd=os.path.join(ROOT, cwd), capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr)


def first_failure(out):
    for line in out.splitlines():
        s = line.strip()
        if s.startswith('→') or s.startswith('AssertionError') or 'Error:' in s:
            return s[:160]
    return '(no failure line)'


class Control:
    def __init__(self, name, path, old, new, red, green, why, count=1):
        self.name, self.path, self.old, self.new = name, path, old, new
        self.red, self.green, self.why, self.count = red, green, why, count


def apply(c):
    full = os.path.join(ROOT, c.path)
    src = open(full).read()
    n = src.count(c.old)
    if n != c.count:
        raise SystemExit(f'ANCHOR FAILED for {c.name}: {c.path} has {n} copies of the anchor, expected {c.count}')
    open(full, 'w').write(src.replace(c.old, c.new))
    return src


def restore(c, original):
    open(os.path.join(ROOT, c.path), 'w').write(original)
    rc, _ = run(['git', 'diff', '--quiet', '--', c.path], '.')
    if rc != 0:
        raise SystemExit(f'RESTORE FAILED for {c.name}: {c.path} still differs from HEAD')


TARGETS = {
    'plane-test': (['npx', 'vitest', 'run', 'src/planeAudit.test.tsx'], 'apps/web'),
    'web-all': (['npx', 'vitest', 'run'], 'apps/web'),
    'console': (['npx', 'vitest', 'run', 'src/ConsoleTitle.test.tsx', 'src/areas/lens/Overview.test.tsx'], 'apps/web'),
    'contrast': (['npx', 'vitest', 'run', 'src/__tests__/contrast.test.ts'], 'packages/ui'),
    'tokens': (['npx', 'vitest', 'run', 'src/__tests__/tokens.test.ts'], 'packages/ui'),
    'neutral-web': (['npx', 'vitest', 'run', 'src/EmptyStates.test.tsx', 'src/lib/productState.test.ts'], 'apps/web'),
}

CONTROLS = [
    Control(
        'C1 the defect itself — NavItem icon back to the refused role',
        'packages/ui/src/components/NavItem.tsx',
        'className="shrink-0 text-muted"', 'className="shrink-0 text-faint"',
        red='plane-test', green='console',
        why='the pair this merge exists for: faint on the tint, 3.97:1 light / 3.63:1 dark',
    ),
    Control(
        'C2 blind the ancestor walk — every plane becomes the body default',
        'apps/web/src/planeAudit.ts',
        '  const found = nearestToken(el, \'bg\')\n  return found ?? { token: DEFAULT_PLANE, from: null }',
        '  nearestToken(el, \'bg\')\n  return { token: DEFAULT_PLANE, from: null }',
        red='web-all', green='neutral-web',
        why='the single edit that switches the interesting half off; MUST_AUDIT_A_DECLARED_PLANE is the catcher',
    ),
    Control(
        'C3 blind the predicate — nothing is ever an offender',
        'apps/web/src/planeAudit.ts',
        "  if (!isTextPlane(plane)) {",
        "  if (role !== '\\u0000') return null\n  if (!isTextPlane(plane)) {",
        red='plane-test', green='neutral-web',
        why='judge is the half the floor CANNOT see — its direct unit tests are the catcher',
    ),
    Control(
        'C4 kill the observer',
        'apps/web/src/planeAudit.ts',
        'export function installPlaneAudit(): void {\n  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })',
        'export function installPlaneAudit(): void {\n  if (scan) return',
        red='web-all', green='neutral-web',
        why='a dead observer reports every surface clean — the floor is the only catcher',
    ),
    Control(
        'C5 permit a pair that fails — faint on the tint',
        'packages/ui/src/planes.ts',
        "  'accent-tint': ['ink', 'muted'],", "  'accent-tint': ['ink', 'muted', 'faint'],",
        red='contrast', green='console',
        why='the PERMITTED direction: a permitted pair must clear the floor',
    ),
    Control(
        'C6 refuse a pair that passes — ink on the tint',
        'packages/ui/src/planes.ts',
        "  'accent-tint': ['ink', 'muted'],", "  'accent-tint': ['muted'],",
        red='contrast', green='tokens',
        why='the REFUSED direction: this is what stops the table becoming an exemption list',
    ),
    Control(
        'C7 drop the fourth plane from the classification',
        'packages/ui/src/planes.ts',
        "  'accent-tint': ['ink', 'muted'],\n", '',
        red='web-all', green='contrast',
        why='the product renders text on it at 10 sites; unclassified must be an offender, not a pass',
    ),
    Control(
        'C8 drop a plane the matrix already scores',
        'packages/ui/src/planes.ts',
        "  sidebar: ['ink', 'muted', 'faint', 'accent'],\n", '',
        red='contrast', green='tokens',
        why='every BACKGROUND must also be a classified plane — the two sets cannot drift',
    ),
    # ── THE SAME THREE MUTATIONS, SCORED AGAINST A TARGET THAT CANNOT SEE planeAudit.test.tsx ──
    #
    # ⚠ C2/C4/C7 above were each CAUGHT — by a UNIT TEST of the very function they mutated, which
    # is not what the comments in planeAudit.ts claim. A verdict that names a catcher the control
    # never exercised is the failure mode this repo has paid for before, so each is re-run here
    # against `console` (ConsoleTitle + Overview — two files IN the floor table and neither of them
    # a test of this module). If the floor is real, it fires here with the unit tests absent.
    Control(
        'C2b blind the ancestor walk — is the FLOOR the catcher, or only the unit test?',
        'apps/web/src/planeAudit.ts',
        "  const found = nearestToken(el, 'bg')\n  return found ?? { token: DEFAULT_PLANE, from: null }",
        "  nearestToken(el, 'bg')\n  return { token: DEFAULT_PLANE, from: null }",
        red='console', green='neutral-web',
        why='MUST_AUDIT_A_DECLARED_PLANE, with no test of planeOf in the run',
    ),
    Control(
        'C4b kill the observer — is the FLOOR the catcher on a real surface?',
        'apps/web/src/planeAudit.ts',
        'export function installPlaneAudit(): void {\n  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })',
        'export function installPlaneAudit(): void {\n  if (scan) return',
        red='console', green='neutral-web',
        why='a dead observer on two real surfaces, with no test of this module in the run',
    ),
    Control(
        'C7b drop the fourth plane — does a REAL SURFACE report the unclassified plane?',
        'packages/ui/src/planes.ts',
        "  'accent-tint': ['ink', 'muted'],\n", '',
        red='console', green='neutral-web',
        why='the ten rendered sites, seen through the console shell rather than through a fixture',
    ),
]


def main():
    only = sys.argv[1:] or None
    results = []
    for c in CONTROLS:
        if only and not any(c.name.startswith(o) for o in only):
            continue
        original = apply(c)
        try:
            rc_red, out_red = run(*TARGETS[c.red])
            rc_green, out_green = run(*TARGETS[c.green])
        finally:
            restore(c, original)
        if rc_red != 0 and rc_green == 0:
            verdict = 'CAUGHT'
        elif rc_red != 0 and rc_green != 0:
            verdict = 'SUSPECT (both targets red — may be a broken build, not a caught mutation)'
        else:
            verdict = 'NOT CAUGHT'
        results.append((c.name, verdict, c.red, first_failure(out_red), c.why))
        print(f'{verdict:12s}  {c.name}')
        print(f'              target={c.red}  {first_failure(out_red)}')
    rc, _ = run(['git', 'diff', '--quiet'], '.')
    print()
    print('tree restored byte-identically' if rc == 0 else 'TREE IS DIRTY AFTER THE CAMPAIGN')
    caught = sum(1 for r in results if r[1] == 'CAUGHT')
    print(f'{caught}/{len(results)} caught')
    json.dump([{'control': r[0], 'verdict': r[1], 'target': r[2], 'failure': r[3], 'why': r[4]} for r in results],
              open('/tmp/w11-plane-controls.json', 'w'), indent=2)
    return 0 if caught == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
