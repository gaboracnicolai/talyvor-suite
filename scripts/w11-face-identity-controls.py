#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE FACE-IDENTITY GUARD (W1.1).

The two new tests in glyphAudit.test.tsx PASSED ON THEIR FIRST RUN — all eight served faces
name themselves correctly today — so they are suspected, not believed.

Every control below mutates the PRODUCT (theme.css, or a font BINARY) or BLINDS the guard,
asserts every anchor BEFORE any write, verifies the bytes on disk really changed, names a
MUST-RED test AND a MUST-STAY-GREEN companion, and restores the tree byte-identically
(sha256-checked for the binary).

⚠ THREE CONTROLS ARE INVERTED. C6, C7 and C8 blind ONE predicate while a known-caught
mutation is still applied: there, a GREEN is the pass, because it proves the PREDICATE did
the catching and not the scaffolding around it. Both-red is a suspect result, not a caught
one — and each inverted control is paired with the mutation its own predicate governs. C7's
first draft was paired with C5 instead, where the not-null assertion fires first, and it
read as a dead predicate that was in fact working.

⚠ C5 IS THE ONE THAT JUSTIFIES THE fvar HALF. C3 changes the DESCRIPTOR, and a pre-existing
test already pins that string — so C3 alone cannot show the axis check earns its place. C5
re-subsets the sans BINARY to a static instance with fontTools (the same 4.63.0 this repo's
woff2 parser was validated against): same filename, same family name, same coverage, no
`fvar`. Every other instrument in both packages stays green and only the axis test speaks.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME = os.path.join(ROOT, 'packages/ui/src/theme.css')
AUDIT = os.path.join(ROOT, 'apps/web/src/glyphAudit.test.tsx')
AUDIT_SRC = os.path.join(ROOT, 'apps/web/src/glyphAudit.ts')
SANS = os.path.join(ROOT, 'packages/ui/src/fonts/space-grotesk-latin.woff2')
STATIC_SANS = '/tmp/w11-static-sans.woff2'

FAMILY = 'every served face NAMES ITSELF as the family theme.css points at it for'
RANGE = 'a face declared as a weight RANGE really is variable across it'
WEIGHT = 'each static mono face IS the weight theme.css declares it to be'
DESCRIPTOR = 'the mono weights are three separate files and the sans is a range'
PARSES = 'parses every @font-face the stylesheet declares, and reaches both families'
COVERS = 'an ordinary character is served by both families'
TNUM = 'the mono faces implement no tnum, and the sans does'
LOCAL = 'every face is served locally — no third-party font host on an authenticated console'
BOTH = 'theme.css declares @font-face for both families'


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def sha(p):
    with open(p, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def build_static_sans():
    """A REAL static instance of the shipped sans: no fvar, same name, same glyphs."""
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    f = TTFont(SANS)
    assert 'fvar' in f, 'the shipped sans is already static — this control has no premise'
    instancer.instantiateVariableFont(f, {'wght': 400}, inplace=True)
    assert 'fvar' not in f, 'instancing left an fvar — the control would not test what it claims'
    assert f['name'].getDebugName(1).startswith('Space Grotesk'), 'instancing renamed the family'
    f.flavor = 'woff2'
    f.save(STATIC_SANS)


def run_tests():
    """{test title: 'pass'|'fail'} across both suites that read the faces."""
    out = {}
    for cwd, spec in (
        (os.path.join(ROOT, 'apps/web'), 'src/glyphAudit.test.tsx'),
        (os.path.join(ROOT, 'packages/ui'), 'src/__tests__/typeface.test.tsx'),
    ):
        subprocess.run(
            ['npx', 'vitest', 'run', spec, '--reporter=json', '--outputFile=/tmp/w11ctl.json'],
            cwd=cwd, capture_output=True, text=True,
        )
        try:
            data = json.load(open('/tmp/w11ctl.json', encoding='utf-8'))
        except Exception:
            out['__SUITE_DID_NOT_REPORT__:' + spec] = 'fail'
            continue
        for res in data.get('testResults', []):
            for a in res.get('assertionResults', []):
                out[a['title']] = 'pass' if a['status'] == 'passed' else 'fail'
    return out


# (name, text edits, binary swap, must_red, must_green, inverted, why)
CONTROLS = [
    (
        'C1 the sans served from the MONO binary',
        [(THEME, r"src: url\('\./fonts/space-grotesk-latin\.woff2'\) format\('woff2'\);",
          "src: url('./fonts/ibm-plex-mono-400-latin.woff2') format('woff2');", 1)],
        None,
        [FAMILY],
        [WEIGHT, PARSES, LOCAL, BOTH],
        False,
        'THE ESCAPE THIS MERGE EXISTS FOR — the whole interface in monospace. Before the guard '
        'this left 1,010 tests green; the wOF2 magic check and the weight check still cannot '
        'see it, which is why they are the companions.',
    ),
    (
        'C2 the 600 mono served from the 500 binary',
        [(THEME, r"src: url\('\./fonts/ibm-plex-mono-600-latin\.woff2'\) format\('woff2'\);",
          "src: url('./fonts/ibm-plex-mono-500-latin.woff2') format('woff2');", 1)],
        None,
        [WEIGHT],
        [FAMILY, RANGE, DESCRIPTOR, PARSES],
        False,
        'the control that created woff2WeightClass, re-run. The new family test must NOT '
        'double-count it: "IBM Plex Mono Medium" is an honest prefix of the declared family.',
    ),
    (
        'C3 the sans DESCRIPTOR widened to 400 900 over a 300-700 axis',
        [(THEME, r'font-weight: 400 700;\n  font-display: swap;\n  src: '
                 r"url\('\./fonts/space-grotesk-latin\.woff2'\)",
          "font-weight: 400 900;\n  font-display: swap;\n  src: "
          "url('./fonts/space-grotesk-latin.woff2')", 1)],
        None,
        [RANGE],
        [FAMILY, WEIGHT, PARSES],
        False,
        'a descriptor promising four weights the file cannot draw. ⚠ NOT AN ISOLATING CONTROL: '
        'the pre-existing DESCRIPTOR test pins that string too and also reds. C5 is what shows '
        'the axis check catches something nothing else can.',
    ),
    (
        'C4 one @font-face removed from theme.css',
        [(THEME, r"@font-face \{\n  font-family: 'Space Grotesk';\n  font-style: normal;\n"
                 r'  font-weight: 400 700;\n  font-display: swap;\n  src: '
                 r"url\('\./fonts/space-grotesk-latin-ext\.woff2'\) format\('woff2'\);\n"
                 r'  unicode-range: [^}]*\}\n', '', 1)],
        None,
        [FAMILY, PARSES],
        [WEIGHT],
        False,
        'a source-derived guard cannot see a SHRINKING input set unless a count is pinned; '
        'expect(faces.length).toBe(8) is that pin.',
    ),
    (
        'C5 the sans BINARY re-subset to a static instance',
        [],
        (SANS, STATIC_SANS),
        [RANGE],
        [FAMILY, WEIGHT, DESCRIPTOR, PARSES, COVERS, TNUM, LOCAL, BOTH],
        False,
        'THE ISOLATING CONTROL. Same filename, same family name, same coverage, no fvar — the '
        'exact shape of a well-meant re-subset. Every other instrument in BOTH packages stays '
        'green and only the axis test speaks: faux bold on every heading, silently.',
    ),
    (
        'C6 family predicate blinded, with C1 still applied',
        [(THEME, r"src: url\('\./fonts/space-grotesk-latin\.woff2'\) format\('woff2'\);",
          "src: url('./fonts/ibm-plex-mono-400-latin.woff2') format('woff2');", 1),
         (AUDIT, r'actual === f\.declared \|\| actual\.startsWith\(`\$\{f\.declared\} `\),',
          'actual === actual,', 1)],
        None,
        [],
        [FAMILY],
        True,
        'INVERTED — a GREEN family test here is the pass: it proves the comparison, not the '
        'scaffolding, is what caught C1. (The axis test stays red on the same mutation for its '
        'own true reason — the mono binary has no fvar — and that is expected, not a failure.)',
    ),
    (
        'C7 min/max comparison blinded, with C3 still applied',
        [(THEME, r'font-weight: 400 700;\n  font-display: swap;\n  src: '
                 r"url\('\./fonts/space-grotesk-latin\.woff2'\)",
          "font-weight: 400 900;\n  font-display: swap;\n  src: "
          "url('./fonts/space-grotesk-latin.woff2')", 1),
         (AUDIT, r'wght!\.min <= lo && wght!\.max >= hi,', 'true,', 1)],
        None,
        [],
        [RANGE],
        True,
        'INVERTED — a GREEN axis test proves the min/max COMPARISON caught C3. ⚠ paired with C3 '
        'and not C5 on purpose: C5 deletes fvar outright, so the not-null assertion above fires '
        'first and blinding min/max would leave the test red for a reason that is not the one '
        'under test. The first draft made exactly that mistake and read as a dead predicate.',
    ),
    (
        'C8 the fvar READ blinded, with C5 still applied',
        [(AUDIT_SRC, r'  if \(!fvar\) return null\n',
          "  if (!fvar) return [{ tag: 'wght', min: 100, def: 400, max: 1000 }]\n", 1)],
        (SANS, STATIC_SANS),
        [],
        [RANGE, FAMILY, WEIGHT, DESCRIPTOR, PARSES],
        True,
        'INVERTED — the other half of C5. Handing the test an invented axis when the file has '
        'none turns it green again, which proves the verdict comes from READING THE BINARY and '
        'not from the descriptor arithmetic around it.',
    ),
]


def main():
    build_static_sans()
    originals = {THEME: read(THEME), AUDIT: read(AUDIT), AUDIT_SRC: read(AUDIT_SRC)}
    sans_sha = sha(SANS)

    print('BASELINE (clean tree) — the new tests must be GREEN before any of this means anything')
    base = run_tests()
    for t in (FAMILY, RANGE, WEIGHT, DESCRIPTOR, PARSES, COVERS, TNUM, LOCAL, BOTH):
        assert base.get(t) == 'pass', f'baseline not green for {t!r}: {base.get(t)}'
    print('  ok: baseline green, and every companion title resolves to a real test\n')

    results = []
    for name, edits, swap, must_red, must_green, inverted, why in CONTROLS:
        # ── ASSERT EVERY ANCHOR BEFORE ANY WRITE. A half-applied control reports a working
        # guard as blind, which is how a real instrument gets deleted.
        staged = {}
        for path, pattern, repl, expect in edits:
            src = staged.get(path, originals[path])
            n = len(re.findall(pattern, src))
            assert n == expect, f'{name}: anchor count {n} != {expect} for {pattern[:70]!r}'
            staged[path] = re.sub(pattern, repl, src, count=1)
        for path, mutated in staged.items():
            assert mutated != originals[path], f'{name}: edit produced identical bytes'
            write(path, mutated)
        if swap:
            shutil.copy2(swap[1], swap[0])
        # ── and verify ON DISK, because an edit that never applied wears the shape of a
        # guard that never fired.
        for path in staged:
            assert read(path) != originals[path], f'{name}: on-disk text unchanged'
        if swap:
            assert sha(SANS) != sans_sha, f'{name}: on-disk binary unchanged'

        got = run_tests()

        for path, text in originals.items():
            write(path, text)
        if swap:
            subprocess.run(['git', 'checkout', '--', SANS], cwd=ROOT, check=True)
            assert sha(SANS) == sans_sha, f'{name}: binary NOT restored'

        red = sorted(t for t, v in got.items() if v == 'fail')
        ok_red = all(got.get(t) == 'fail' for t in must_red)
        ok_green = all(got.get(t) == 'pass' for t in must_green)
        if inverted:
            verdict = 'CAUGHT' if ok_green else 'NOT CAUGHT'
        else:
            verdict = 'CAUGHT' if (ok_red and ok_green) else 'NOT CAUGHT'
        results.append((name, verdict))
        print(f'{verdict:11} {name}')
        print(f'            red: {red if red else "(none)"}')
        print(f'            must-red {must_red} -> {ok_red} | must-green {len(must_green)} -> {ok_green}')
        print(f'            {why}\n')

    for path, text in originals.items():
        write(path, text)
    subprocess.run(['git', 'checkout', '--', SANS], cwd=ROOT, check=True)
    assert sha(SANS) == sans_sha
    # Restored means "back to what this branch holds", not "back to HEAD": AUDIT and
    # AUDIT_SRC carry this merge's own change. The binary is checked against HEAD by sha.
    for path, text in originals.items():
        assert read(path) == text, f'{path} not restored'
    print('restored — all four mutated paths match their pre-control bytes; sans sha', sha(SANS)[:12])

    after = run_tests()
    for t in (FAMILY, RANGE, WEIGHT, DESCRIPTOR):
        assert after.get(t) == 'pass', f'tree not restored: {t!r} is {after.get(t)}'
    print('post-restore: green\n')

    caught = sum(1 for _, v in results if v == 'CAUGHT')
    print(f'== {caught}/{len(results)} CONTROLS CAUGHT ==')
    return 0 if caught == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
