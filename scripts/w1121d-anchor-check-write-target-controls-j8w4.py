#!/usr/bin/env python3
"""
W1.1.21d — CONTROLS for the WRITE-TARGET rule in scripts/w1120-anchor-check-h3n8.py.

WHY A CONTROL AT ALL, WHEN THE NUMBER WENT UP AND NOTHING WENT RED
------------------------------------------------------------------
unreadable 8 → 7, anchors decided 521 → 530, and "every decidable anchor matches the tree".
**That is the result this item's own history says to distrust**: "more anchors, all healthy" is
ALSO exactly what a widening that extracts UNCHECKABLE pairs prints. So the claim under test is
not that the number moved. It is:

  W1  a corruption in the NEWLY-READ harness is NAMED in the miss block, and
  W2  the SAME corruption with the widening reverted is INVISIBLE and the harness UNREADABLE
      — which is what separates "this change sees it" from "something already did",
  W3  blinding the rule puts the census back exactly where it was,
  W4  the DECLINE is load-bearing: drop the "a write I cannot name means I decline" guard and
      `w171-docs-search-register` starts reporting FALSE MISSES against a harness that is fine.

Every mutation is restored from the ORIGINAL BYTES in a `finally` and sha256-verified back.
"""
import hashlib, io, os, re, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECK = os.path.join(REPO, 'scripts/w1120-anchor-check-h3n8.py')
SCROLL = os.path.join(REPO, 'apps/web/scripts/w11-scroll-reset-controls.py')

# the write-target fallback, as one line in _single_file
FALLBACK = "        return self.written_file"
DECLINE = """        if not names or None in names:
            return None"""
RESOLVE_DECLINE = """        paths = [self.consts.get(n) for n in names]
        if any(pth is None for pth in paths):
            return None"""


def sha(p):
    return hashlib.sha256(io.open(p, 'rb').read()).hexdigest()


def run_check():
    p = subprocess.run(['python3', CHECK], capture_output=True, text=True, cwd=REPO, timeout=900)
    out = p.stdout + p.stderr
    m = re.search(r'harnesses: (\d+)\s+anchors decided: (\d+)', out)
    u = re.search(r'COULD NOT READ (\d+) HARNESS', out)
    mi = re.search(r'⚠ (\d+) ANCHOR\(S\) NO LONGER MATCH', out)
    return {
        'rc': p.returncode,
        'anchors': int(m.group(2)) if m else None,
        'unreadable': int(u.group(1)) if u else 0,
        'misses': int(mi.group(1)) if mi else 0,
        'out': out,
    }


def edit(path, old, new):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    assert n == 1, f'expected 1 occurrence, found {n}: {old[:60]!r}'
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new, 1))


def main():
    print('== BASELINE ==')
    base = run_check()
    print(f"   anchors={base['anchors']} unreadable={base['unreadable']} misses={base['misses']} rc={base['rc']}")
    assert base['misses'] == 0, 'baseline already has misses — every control below is uninterpretable'
    ok = 0
    total = 0

    def control(name, predict, mutations, check):
        nonlocal ok, total
        total += 1
        print(f'\n== {name}')
        print(f'   PREDICT: {predict}')
        originals = {p: io.open(p, 'rb').read() for p, _, _ in mutations}
        shas = {p: sha(p) for p in originals}
        try:
            for p, o, n in mutations:
                edit(p, o, n)
            r = run_check()
        finally:
            for p, b in originals.items():
                io.open(p, 'wb').write(b)
        for p in shas:
            assert sha(p) == shas[p], f'RESTORE FAILED for {p}'
        good, why = check(r)
        print(f"   RESULT : anchors={r['anchors']} unreadable={r['unreadable']} misses={r['misses']}")
        print(f"   VERDICT: {'OK' if good else 'CONTROL FAILED'} — {why}")
        ok += 1 if good else 0

    def reason_for(out, harness_name):
        lines = out.split('\n')
        for i, l in enumerate(lines):
            if harness_name in l and i + 1 < len(lines):
                return lines[i + 1].strip()
        return '<not listed as unreadable>'

    CORRUPT = ('("window.scrollTo(0, 0)", "window.scrollTo(0, 1)")',
               '("window.scrollTo(0, 0) /* moved */", "window.scrollTo(0, 1)")')

    control(
        'W1 an anchor in the NEWLY-READ harness is corrupted',
        'the checker NAMES it in the miss block — the widening can say no, not only yes',
        [(SCROLL, *CORRUPT)],
        lambda r: (r['misses'] == 1 and 'window.scrollTo(0, 0) /* moved */' in r['out'],
                   'the corrupted anchor is reported as a miss'
                   if r['misses'] == 1 else f"expected exactly 1 miss, got {r['misses']}"))

    control(
        'W2 the SAME corruption with the write-target fallback REVERTED',
        'INVISIBLE — 0 misses and the harness back to UNREADABLE. This is what separates "this '
        'change sees it" from "something already did"',
        [(SCROLL, *CORRUPT), (CHECK, FALLBACK, "        return None")],
        lambda r: (r['misses'] == 0 and r['unreadable'] == base['unreadable'] + 1
                   and 'w11-scroll-reset' in r['out'],
                   'the corruption is invisible and the harness reads UNREADABLE'
                   if r['misses'] == 0 else f"the corruption was still seen ({r['misses']} misses) "
                   'without the widening — the widening is not what sees it'))

    control(
        'W3 the write-target rule blinded on a clean tree',
        f"the census returns to exactly where it was: {base['anchors'] - 9} anchors, "
        f"{base['unreadable'] + 1} unreadable",
        [(CHECK, FALLBACK, "        return None")],
        lambda r: (r['anchors'] == base['anchors'] - 9 and r['unreadable'] == base['unreadable'] + 1,
                   'the rule carries exactly the 9 anchors and the 1 harness it claims'))

    # ⚠ W4 WAS WRITTEN AS "the decline is load-bearing" AND THE RUN SAID OTHERWISE. The first
    # version poisoned `None in names` and nothing moved — I had poisoned the wrong branch, the
    # same mistake this item's F1 records ("a mutation that changed a line and disabled nothing").
    # Poisoning the RIGHT branch moved nothing either, and so did poisoning both. That is the
    # measurement, and it is now what W4 asserts: the two declines are conservatism whose
    # populations are large (19 and 37 harnesses) but which change NO anchor on today's tree,
    # because no harness in either declining group also carries an edit shape. A control that
    # claims a guard catches something it does not is worse than no control.
    control(
        'W4 BOTH declines dropped — the honest claim, which is that they are unexercised today',
        'NOTHING MOVES: same anchors, same unreadable, no misses. These guard a shape no harness '
        'currently has (multi-file constants AND an edit shape), so they cannot be demonstrated '
        'live — which is a fact about them worth recording, not one to dress up',
        [(CHECK, DECLINE, "        names.discard(None)\n        if not names:\n            return None"),
         (CHECK, RESOLVE_DECLINE,
          "        paths = [self.consts.get(n) for n in names]\n"
          "        paths = [pth for pth in paths if pth is not None]\n"
          "        if not paths:\n            return None")],
        lambda r: (r['anchors'] == base['anchors'] and r['unreadable'] == base['unreadable']
                   and r['misses'] == 0,
                   'unmoved, as measured — the declines are defence in depth, not a live guard'))

    control(
        'W5 a comment in the checker reworded — MUST STAY GREEN',
        'GREEN and the census unmoved: this rule reads write calls, never prose',
        [(CHECK, '# after consts are known, because the write target is looked up through them',
                 '# consts must be known first: the write target is resolved through them')],
        lambda r: (r['anchors'] == base['anchors'] and r['unreadable'] == base['unreadable']
                   and r['misses'] == 0, 'census unmoved'))

    # ── the write-through-a-join half ─────────────────────────────────────────
    # ⚠ THIS CHANGE ADDS NO ANCHOR, WHICH IS EXACTLY WHY IT NEEDS CONTROLS. It moves
    # `w116-members` from "NO FILE HALF — 2 constants and none attributable" to "NO SHAPE HALF —
    # the file is known (Members.tsx)". Nothing in the counts moves, so a broken version of it
    # looks identical to a working one on the summary line.
    MEM = os.path.join(REPO, 'scripts/w116-members-controls-7q4m.py')
    JOINWRITE = """        parts: list[ast.AST] = []
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "join"):
            parts = list(node.args)"""
    JOINWRITE_OFF = """        parts: list[ast.AST] = []
        if False and (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "join"):
            parts = list(node.args)"""

    control(
        'K1 the write-through-a-join case blinded',
        'w116-members goes back to NO FILE HALF — the verdict is the observable here, not the '
        'anchor count, because this change adds no anchor',
        [(CHECK, JOINWRITE, JOINWRITE_OFF)],
        lambda r: ('NO FILE HALF' in reason_for(r['out'], 'w116-members')
                   and r['anchors'] == base['anchors'],
                   reason_for(r['out'], 'w116-members')[:80]))

    # ⚠ K2 IS THE ONE THAT MATTERS: it must follow the WRITE, not the order of the constants.
    # w116-members names Members.tsx and Members.test.tsx, and the test file is the suite it hands
    # to `npx vitest run` — never a file it edits. Point the writes at the test file instead and
    # the verdict must follow.
    control(
        'K2 the harness is made to write a DIFFERENT file than the one it names first',
        'the verdict names Keys.tsx. If it still said Members.tsx it would be reading the '
        'constant order, not the write, and would attribute anchors to a file nothing edits',
        # ⚠ the SCREEN constant is repointed rather than the two write sites, because the
        # write appears twice and an edit that matches twice is refused by this harness — and
        # repointing at a THIRD real file (not at TESTFILE) keeps the two constants distinct, so
        # the verdict cannot come from a single-constant fallback instead of from the write.
        [(MEM, 'SCREEN = "apps/web/src/areas/lens/Members.tsx"',
               'SCREEN = "apps/web/src/areas/lens/Keys.tsx"')],
        lambda r: ('Keys.tsx' in reason_for(r['out'], 'w116-members'),
                   reason_for(r['out'], 'w116-members')[:80]))

    # ⚠ K3 IS A UNIT CONTROL AND THE TWO ATTEMPTS BEFORE IT ARE WHY. The guard under test is
    # "`os.path.join(a, b)` with TWO operands naming a file is not a write I can attribute". No
    # harness has that shape, so both attempts to construct it in a real harness moved OTHER rules
    # instead of this one: rebinding the function-local `tree` is invisible to `_prescan` (module
    # body only), and adding a module-level `tree = TESTFILE` made the harness readable through a
    # different path and produced a miss that had nothing to do with the guard. **A control that
    # perturbs three rules to test one is not a control.** Calling `_write_name` directly isolates
    # it, and says out loud that this guard is conservatism with no live population today.
    total += 1
    print('\n== K3 the join-write ambiguity guard, called directly (no harness perturbed)')
    print("   PREDICT: two operands naming a file -> None; one -> that one. No harness has the "
          "two-operand shape today, so this is the only way to exercise it without moving "
          "unrelated rules — and that it has no live population is itself the finding")
    import importlib.util as _ilu, ast as _ast
    _spec = _ilu.spec_from_file_location('acu', CHECK)
    _m = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_m)
    _ex = _m.Extractor('X = "apps/web/src/areas/lens/Members.tsx"\n'
                       'Y = "apps/web/src/areas/lens/Keys.tsx"\n', _m.ROOT)
    _two = _ast.parse('os.path.join(X, Y)', mode='eval').body
    _one = _ast.parse('os.path.join(scratch, X)', mode='eval').body
    _r2, _r1 = _ex._write_name(_two), _ex._write_name(_one)
    _good = _r2 is None and _r1 == 'X'
    print(f"   RESULT : two-operand -> {_r2!r}   one-operand -> {_r1!r}")
    print(f"   VERDICT: {'OK' if _good else 'CONTROL FAILED'} — "
          f"{'ambiguity refused, the unambiguous case attributed' if _good else 'the guard does not behave as claimed'}")
    ok += 1 if _good else 0

    # ── the tuple-unpacking half ──────────────────────────────────────────────
    CG = os.path.join(REPO, 'scripts/w11-cited-guard-controls.py')
    TUPLE_ARM = """        if (isinstance(t, ast.Tuple) and isinstance(node.value, ast.Tuple)
                and len(t.elts) == len(node.value.elts)
                and all(isinstance(e, ast.Name) for e in t.elts)):
            return [(e.id, v) for e, v in zip(t.elts, node.value.elts)]"""
    TUPLE_OFF = """        if False and (isinstance(t, ast.Tuple) and isinstance(node.value, ast.Tuple)
                and len(t.elts) == len(node.value.elts)
                and all(isinstance(e, ast.Name) for e in t.elts)):
            return [(e.id, v) for e, v in zip(t.elts, node.value.elts)]"""
    PATH_RESTRICTION = """                and (lambda x: x is not None and resolve(x, self.home) is not None)(self._str(v))]"""
    PATH_UNRESTRICTED = """                and True]"""
    K8_NEW = "'\\t\\treturn strings.HasSuffix(fi.Name(), \".go\") && !strings.HasSuffix(fi.Name(), \"_test.go\")'"
    K8_STALE = "'re := regexp.MustCompile(`a\\\\.mux\\\\.Handle(?:Func)?\\\\(\"([^\"]+)\"`)'"

    control(
        'J1 tuple-unpacked path constants no longer bind',
        'w11-cited-guard goes UNREADABLE and 11 anchors are lost — LENS, SAME, CITED = BFF / … is '
        'the only place it declares the files it edits',
        [(CHECK, TUPLE_ARM, TUPLE_OFF)],
        lambda r: (r['anchors'] == base['anchors'] - 11 and 'w11-cited-guard' in r['out']
                   and r['unreadable'] == base['unreadable'] + 1,
                   f"-11 anchors, the harness unreadable again"
                   if r['anchors'] == base['anchors'] - 11 else
                   f"expected {base['anchors']-11}, got {r['anchors']}"))

    control(
        'J2 K8\'s stale anchor put back, WITH this change',
        'NAMED as a miss. This is the anchor #274 orphaned when it replaced the regex-over-source '
        'mountedPatterns with an AST walk',
        [(CG, K8_NEW, K8_STALE)],
        lambda r: (r['misses'] >= 1 and 'cited-guard' in r['out'],
                   f"{r['misses']} miss(es) named" if r['misses'] else 'not seen'))

    # ⚠ J3 IS WHY THIS MERGE IS ONE FINDING AND NOT TWO. The stale anchor had been sitting there
    # since #274, and the instrument that exists to catch exactly that could not READ this harness
    # — so the same mutation is INVISIBLE without the tuple-unpacking support.
    control(
        'J3 K8\'s stale anchor put back, with this change REVERTED',
        'INVISIBLE, and the harness UNREADABLE — which is precisely the state the tree was in '
        'between #274 and today',
        [(CG, K8_NEW, K8_STALE), (CHECK, TUPLE_ARM, TUPLE_OFF)],
        lambda r: (r['misses'] == 0 and 'w11-cited-guard' in r['out'],
                   'invisible without this change — that is how it survived'
                   if r['misses'] == 0 else f"still seen ({r['misses']})"))

    # ⚠ J4 IS THE CONTROL FOR A MISTAKE I MADE AND CORRECTED MID-RUN. The first version of the
    # tuple rule bound EVERY unpacked name, and `w11-pointer-pins` writes
    # `CAUGHT, MISSED = 'CAUGHT', 'NOT CAUGHT'` — two LABELS, unpacked exactly like a path pair.
    # That put 'NOT CAUGHT' in consts and produced THREE false misses against real test files.
    # The existing SENTINEL rejection cannot catch it: `^[A-Z][A-Z0-9_]{3,}$` has no space in the
    # class. Widening the sentinel would have been the WRONG repair — an all-caps phrase is a
    # shape real source text can have.
    control(
        'J4 the tuple rule binds every unpacked name, not only the ones naming a file',
        "THREE false misses come back — 'NOT CAUGHT' from `CAUGHT, MISSED = …` reported as an "
        'anchor absent from src/caseAudit.test.tsx and src/restingAffordance.test.ts',
        [(CHECK, PATH_RESTRICTION, PATH_UNRESTRICTED)],
        lambda r: (r['misses'] == 3 and 'NOT CAUGHT' in r['out'],
                   f"{r['misses']} false misses — the restriction is load-bearing"
                   if r['misses'] == 3 else f"expected 3, got {r['misses']}"))

    # ── the dropped-head half ─────────────────────────────────────────────────
    # ⚠ #294 SHIPPED THE JOIN BRANCH DROPPING ITS FIRST ARGUMENT, AND THE DIV BRANCH ONE SCREEN
    # BELOW IT CARRIES THE WARNING IN CAPITALS: "JOIN, DO NOT DISCARD THE LEFT … `UI /
    # 'vitest.config.ts'` read as bare 'vitest.config.ts' resolved onto apps/web's copy and
    # reported a miss against a file the harness never touches." Same bug, same file, one branch
    # apart, written second by somebody who had read the first. These two controls reproduce BOTH
    # outcomes rather than describing them.
    MP = os.path.join(REPO, 'scripts/w17-mounted-patterns-controls-m5x8.py')
    HEAD_JOINED = "            parts = [self._str(a) for a in node.args]"
    HEAD_DROPPED = "            parts = [None] + [self._str(a) for a in node.args[1:]]"
    SAME_REAL = 'SAME = os.path.join(BFF, "sameorigin_test.go")'
    SAME_COLLIDING = 'SAME = os.path.join(BFF, "vitest.config.ts")'

    control(
        'I1 the join branch drops its first argument — the #294 bug exactly as it shipped',
        'w17-mounted-patterns goes UNREADABLE and 4 anchors are lost: BFF = join(ROOT,"apps/bff") '
        'then LENS = join(BFF,"lens.go") yields the bare "lens.go", which resolves nowhere',
        [(CHECK, HEAD_JOINED, HEAD_DROPPED)],
        lambda r: (r['anchors'] == base['anchors'] - 4 and 'w17-mounted-patterns' in r['out']
                   and r['unreadable'] == base['unreadable'] + 1,
                   f"-4 anchors and the harness unreadable again"
                   if r['anchors'] == base['anchors'] - 4 else
                   f"expected {base['anchors']-4}, got {r['anchors']}"))

    # ⚠ I2 IS THE ONE THAT MATTERS. Unreadable was the LUCKY outcome of the #294 bug — `lens.go`
    # exists under none of the roots, so it resolved to nothing. Point the same join at a tail
    # that DOES exist at another root and the bug stops being quiet.
    control(
        'I2 the head dropped, with a tail that exists at ANOTHER root',
        'a MISS is reported against vitest.config.ts — a file this harness never touches. That is '
        'the Div branch\'s recorded failure, reproduced in the join branch',
        [(CHECK, HEAD_JOINED, HEAD_DROPPED), (MP, SAME_REAL, SAME_COLLIDING)],
        lambda r: (r['misses'] >= 1 and 'vitest.config.ts' in r['out'],
                   f"{r['misses']} miss against a file the harness never touches"
                   if r['misses'] else 'no miss — the collision did not reproduce'))

    control(
        'I3 the SAME colliding tail with the head JOINED — MUST STAY CLEAN',
        'no miss: join(BFF,"vitest.config.ts") is apps/bff/vitest.config.ts, which does not exist, '
        'so the triple is dropped rather than checked against the wrong file. This is the half '
        'that shows the fix is the fix, and not that the collision stopped existing',
        [(MP, SAME_REAL, SAME_COLLIDING)],
        lambda r: (r['misses'] == 0 and 'vitest.config.ts' not in r['out'],
                   'the collision resolves to nothing and is dropped'))

    # ── the os.path.join half ─────────────────────────────────────────────────
    PROSE = os.path.join(REPO, 'apps/web/scripts/w18-prose-class-controls.py')
    JOIN_ARM = """        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "join" and len(node.args) >= 2):"""
    JOIN_OFF = """        if (False and isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "join" and len(node.args) >= 2):"""
    REFUSAL = """        spliced = regex_spliced_names(ast.parse(h.read_text()))
        if spliced:"""
    REFUSAL_OFF = """        spliced = []
        if spliced:"""
    # ⚠ COPIED FROM THE SOURCE, NOT RETYPED. The first version of this control wrote the anchor
    # in single quotes and the harness writes it in double quotes with a real `\n` escape, so the
    # edit found 0 occurrences and the control died before it tested anything. A control that
    # retypes its needle is testing its own typing.
    PROSE_ANCHOR = '"  ts: stripComments,\\n  tsx: stripComments,"'
    PROSE_BROKEN = '"  ts: stripComments,\\n  tsx: stripCommentsZZ,"' 

    control(
        'H1 an anchor in the newly-read w18-prose-class is corrupted',
        'the checker NAMES it under MISSES',
        [(PROSE, PROSE_ANCHOR, PROSE_BROKEN)],
        lambda r: (r['misses'] >= 1 and 'prose-class' in r['out'],
                   f"{r['misses']} miss(es), named" if r['misses'] else 'not seen'))

    control(
        'H2 the SAME corruption with os.path.join support REVERTED',
        'INVISIBLE, and the harness reads UNREADABLE again',
        [(PROSE, PROSE_ANCHOR, PROSE_BROKEN), (CHECK, JOIN_ARM, JOIN_OFF)],
        # ⚠ +2, NOT +1, AND THE CHANGE IS DELIBERATE: blinding the join branch now un-reads
        # w18-prose-class AND w17-mounted-patterns, because the head-join repair carried the
        # second one. Written as a delta so the next unrelated widening does not break it.
        lambda r: (r['misses'] == 0 and 'w18-prose-class' in r['out']
                   and r['unreadable'] == base['unreadable'] + 2,
                   'invisible without the rule, harness unreadable again'
                   if r['misses'] == 0 else f"still seen ({r['misses']}) — not this rule"))

    control(
        'H3 os.path.join support blinded on a clean tree',
        'ten anchors fewer and two harnesses more unreadable than this run\'s baseline — the '
        'join branch carries w18-prose-class AND (since the head-join repair) w17-mounted-patterns',
        [(CHECK, JOIN_ARM, JOIN_OFF)],
        lambda r: (r['anchors'] == base['anchors'] - 10 and r['unreadable'] == base['unreadable'] + 2,
                   f"-10 anchors, +2 unreadable from {base['anchors']}/{base['unreadable']}"
                   if r['anchors'] == base['anchors'] - 10 else
                   f"expected {base['anchors']-10}, got {r['anchors']}"))

    # ⚠ H4 IS THE ONE TO READ. #291 added a refusal for harnesses that splice with `re.sub`, and
    # measured its harm on a HYPOTHETICAL two-step: teach _str about os.path.join AND add
    # `pattern` to the vocabulary. Half of that two-step is now REAL — this merge — and the
    # refusal has gone from discarding 1 candidate to discarding 15, every one a regex full of
    # `\(` and `\.` escapes that cannot appear literally in a CSS file. A guard written before
    # the change that would trip it, now tripping.
    control(
        'H4 os.path.join support with the #291 regex refusal REVERTED',
        'the face-identity regexes become MISSES — the refusal was preventive when it merged and '
        'is load-bearing now, on a widening that landed after it',
        [(CHECK, REFUSAL, REFUSAL_OFF)],
        lambda r: (r['misses'] >= 7 and 'theme.css' in r['out'],
                   f"{r['misses']} false misses against a font-identity guard"
                   if r['misses'] >= 7 else f"expected >=7, got {r['misses']}"))

    control(
        'H5 a comment beside the join branch reworded — MUST STAY GREEN',
        'census unmoved',
        # ⚠ RE-AIMED: this control's needle was the comment the head-join repair rewrote, so it
        # died on `expected 1 occurrence, found 0` before testing anything. Aimed at a line the
        # repair did not touch.
        [(CHECK, '# purpose — an interpolated anchor is not statically decidable and must not be guessed at.',
                 '# purpose: an interpolated anchor is not statically decidable and must not be guessed at.')],
        lambda r: (r['anchors'] == base['anchors'] and r['unreadable'] == base['unreadable']
                   and r['misses'] == 0, 'census unmoved'))

    # ── the counted-names half ────────────────────────────────────────────────
    # ⚠ 537 ANCHORS AND STILL "every decidable anchor matches the tree" IS THE RESULT THIS ITEM
    # SAYS TO DISTRUST, so what is tested is not the number: G1 requires a corruption in the
    # newly-read harness to be NAMED, and G2 requires the SAME corruption to be INVISIBLE with the
    # rule reverted.
    MONEY2 = os.path.join(REPO, 'apps/web/scripts/w1118-money-name-controls-h3n8.py')
    COUNT_ARM = "                idx = next((i for i, n in enumerate(names) if n in self.counted_names), None)"
    VOCAB_ARM = '    ANCHOR_NAMES = frozenset({"old", "find", "anchor"})'
    MONEY_ANCHOR = '("const MONEY_SEGMENT = /^(usd|cents|cost|price)s?$/i",\n       "const MONEY_SEGMENT = /^(cents|cost|price)s?$/i")'
    MONEY_BROKEN = '("const MONEY_SEGMENT = /^(usd|cents|cost|price)s?$/i ZZ_CORRUPTED",\n       "const MONEY_SEGMENT = /^(cents|cost|price)s?$/i")'

    control(
        'G1 an anchor in the newly-read w1118-money-name is corrupted',
        'the checker NAMES it under MISSES — the rule can say no, not only yes',
        [(MONEY2, MONEY_ANCHOR, MONEY_BROKEN)],
        lambda r: (r['misses'] >= 1 and 'money-name' in r['out'] and 'ZZ_CORRUPTED' in r['out'],
                   f"{r['misses']} miss(es), the corrupted anchor named"
                   if r['misses'] else 'the corruption was not seen'))

    control(
        'G2 the SAME corruption with the counted-names rule REVERTED',
        'INVISIBLE, and the harness reads UNREADABLE again. This is what separates "this rule '
        'sees it" from "something already did"',
        [(MONEY2, MONEY_ANCHOR, MONEY_BROKEN), (CHECK, COUNT_ARM, "                idx = None")],
        lambda r: (r['misses'] == 0 and 'w1118-money-name' in r['out']
                   and r['unreadable'] == base['unreadable'] + 1,
                   'invisible without the rule, and the harness is unreadable again'
                   if r['misses'] == 0 else f"still seen ({r['misses']} misses) — the rule is not what sees it"))

    # ⚠ G3 AND G4 WERE WRITTEN WITH ABSOLUTE NUMBERS AND THIS SESSION'S NEXT MERGE BROKE BOTH.
    # `_str` learned `os.path.join`, every count moved by +6, and two controls that were measuring
    # a rule correctly reported failure. They are DELTAS from the run's own baseline now: what
    # each rule CARRIES is the invariant, and it survives every unrelated widening.
    control(
        'G3 the counted-names rule blinded on a clean tree',
        'exactly 7 anchors fewer and 1 harness more unreadable than this run\'s baseline — the '
        'rule carries precisely what it claims, whatever the absolute census happens to be',
        [(CHECK, COUNT_ARM, "                idx = None")],
        lambda r: (r['anchors'] == base['anchors'] - 7 and r['unreadable'] == base['unreadable'] + 1,
                   f"-7 anchors, +1 unreadable from {base['anchors']}/{base['unreadable']}"
                   if r['anchors'] == base['anchors'] - 7 else
                   f"expected {base['anchors']-7}, got {r['anchors']}"))

    # ⚠ G4 IS THE CONTROL THAT MAKES "KEEP BOTH" A MEASUREMENT INSTEAD OF CAUTION. The tidy answer
    # is that the count signal replaces the hand-kept vocabulary. It does not: the vocabulary
    # carries 11 anchors the count signal never sees.
    control(
        'G4 ANCHOR_NAMES emptied, leaving the counted-names rule alone',
        'ELEVEN anchors fewer than both rules together. Neither subsumes the other, and deleting '
        'the older one would lose real coverage in the direction that looks like a simplification',
        [(CHECK, VOCAB_ARM, '    ANCHOR_NAMES = frozenset()')],
        lambda r: (r['anchors'] == base['anchors'] - 11,
                   f"-11 from {base['anchors']} — the vocabulary is still load-bearing"
                   if r['anchors'] == base['anchors'] - 11 else
                   f"expected {base['anchors']-11}, got {r['anchors']}"))

    control(
        'G5 a comment beside the rule reworded — MUST STAY GREEN',
        'census unmoved: the evidence is a call the harness makes, never prose',
        [(CHECK, '# ⚠ IT LOOKS AT NO STRING\'S CONTENTS, which is the line this file draws everywhere: the',
                 '# ⚠ NO STRING CONTENTS ARE READ, which is the line this file draws everywhere: the')],
        lambda r: (r['anchors'] == base['anchors'] and r['unreadable'] == base['unreadable']
                   and r['misses'] == 0, 'census unmoved'))

    # ── the why-unreadable half ───────────────────────────────────────────────
    # ⚠ THESE ARE THE CONTROLS THAT MATTER FOR A DIAGNOSTIC, because a diagnostic fails by being
    # PLAUSIBLE rather than by being absent. Each takes a harness the checker reads today, breaks
    # exactly ONE of the two halves, and requires the named reason to be the one that broke.
    SR = os.path.join(REPO, 'apps/web/scripts/w11-scroll-reset-controls.py')
    MONEY = os.path.join(REPO, 'apps/web/scripts/w1118-money-name-controls-h3n8.py')

    control(
        'E1 a readable harness loses only its SHAPE half',
        'reported as NO SHAPE HALF, naming the file it still knows (src/App.tsx). The file half is '
        'intact, so an answer blaming the file would be plausible and wrong',
        [(SR, 'for old, new in edits:', 'for a, b in edits:'),
         (SR, 'for old, _ in c["edits"]:', 'for a, _ in c["edits"]:')],
        lambda r: ('NO SHAPE HALF' in reason_for(r['out'], 'w11-scroll-reset')
                   and 'src/App.tsx' in reason_for(r['out'], 'w11-scroll-reset'),
                   reason_for(r['out'], 'w11-scroll-reset')[:90]))

    control(
        'E2 the same harness loses only its FILE half',
        'reported as NO FILE HALF with the count (2 constants) AND the note that a shape IS '
        'matched — the half that survived has to be named too, or the reader widens the wrong one',
        [(SR, 'APP.write_text(apply_edits(src, c["edits"]))',
             '_unused = apply_edits(src, c["edits"])')],
        lambda r: ('NO FILE HALF' in reason_for(r['out'], 'w11-scroll-reset')
                   and 'A shape IS matched' in reason_for(r['out'], 'w11-scroll-reset'),
                   reason_for(r['out'], 'w11-scroll-reset')[:90]))

    # ⚠ E3 WAS WRITTEN AGAINST AN OLDER TREE AND HAD TO BE RE-AIMED, WHICH IS THE COUNTED-NAMES
    # RULE SHOWING UP IN ITS OWN CONTROLS. It used to break only w1118-money-name's file constant
    # and expect NEITHER HALF, because that harness had no shape. It has one now — the `.count(o)`
    # signal — so breaking the file alone yields NO FILE HALF, and the control was scoring a
    # failure against a diagnosis that was right. Both halves are broken now, which is what
    # NEITHER HALF has always meant.
    control(
        'E3 a harness loses BOTH halves at once',
        'NEITHER HALF — the third verdict is reachable, not two and a decoration. The file '
        'constant is broken AND both `.count(o)` sites are hidden, since one surviving count call '
        'is enough to keep the shape',
        [(MONEY, 'FF = WEB / "src" / "figureFace.test.ts"',
                 'FF = WEB / "src" / "figureFaceZZ.test.ts"'),
         (MONEY, 'if not all(original.count(o) == 1 for o, _ in edits):',
                 'if not all(original.count(str(o)) == 1 for o, _ in edits):'),
         (MONEY, 'print(f"{cid} ANCHOR MISS: sites occur {[original.count(o) for o, _ in edits]}, want all 1 "',
                 'print(f"{cid} ANCHOR MISS: sites occur {[original.count(str(o)) for o, _ in edits]}, want all 1 "')],
        lambda r: ('NEITHER HALF' in reason_for(r['out'], 'w1118-money-name'),
                   reason_for(r['out'], 'w1118-money-name')[:90]))

    # ⚠ THE VACUITY FLOOR, AND FOR A DIAGNOSTIC IT IS THE IMPORTANT ONE. A `why` that collapses to
    # one sentence is INDISTINGUISHABLE FROM A GOOD ONE at a glance: the output still has a reason
    # under every harness, still reads as an answer, and tells the reader nothing. Blind it and
    # every harness gets the same verdict.
    control(
        'E4 why_unreadable collapsed to a single verdict',
        'the reasons stop discriminating — all six identical. Nothing else in this file would '
        'notice, because a uniform diagnosis looks exactly like a working one',
        [(CHECK, '    files = len(ex.file_consts)\n    shaped = bool(ex.edit_shapes or ex.anchor_index)',
                 '    return "NEITHER HALF — collapsed"\n    files = len(ex.file_consts)\n    shaped = bool(ex.edit_shapes or ex.anchor_index)')],
        lambda r: (len({l.strip() for l in r['out'].split('\n')
                        if l.startswith('    N') and 'HALF' in l}) == 1,
                   'all reasons collapsed to one, as predicted — this is what the floor below catches'))

    # ⚠⚠ E5 HAS NOW BEEN RESTATED TWICE, AND THE SECOND TIME IS THE INTERESTING ONE. It first
    # asserted THREE distinct verdicts on the clean tree; reading `w1118-money-name` removed the
    # only NO SHAPE HALF and it became two. Reading `w18-prose-class` has now removed the only
    # NEITHER HALF and it is ONE. **The real tree no longer discriminates at all — which is
    # exactly what a collapsed `why_unreadable` looks like.** E4's counter-example and the true
    # tree are now indistinguishable from each other, so a floor watching the TREE can no longer
    # tell them apart, and the discrimination has to be carried by a CONSTRUCTED population:
    # E1 → NO SHAPE HALF, E2 → NO FILE HALF, E3 → NEITHER HALF, each from a deliberate mutation.
    # ⚠ This is a diagnostic getting LESS testable as the thing it diagnoses gets better, and it
    # is worth knowing before somebody reads a single uniform verdict as a healthy signal.
    control(
        'E5 every verdict on the real tree is one of the three known kinds — MUST STAY TRUE',
        'the real tree now yields ONE kind (all four remaining are NO FILE HALF), so this can no '
        'longer assert discrimination — that is E1/E2/E3\'s job on a constructed population. What '
        'it still catches is a verdict that is neither of the three: an empty string, a fallback, '
        'a stack trace',
        [(CHECK, '# after consts are known, because the write target is looked up through them',
                 '# consts first: the write target resolves through them')],
        lambda r: (all(l.strip().startswith(('NO FILE HALF', 'NO SHAPE HALF', 'NEITHER HALF'))
                       for l in r['out'].split('\n')
                       if l.startswith('    ') and l.strip() and not l.strip().startswith(('#', 'a ')))
                   and r['unreadable'] > 0,
                   'every verdict printed is one of the three known kinds'))

    # ⚠ E6 IS A CONTROL ON A REPAIR THIS CHANGE FORCED ELSEWHERE, and it is the one worth reading.
    # Adding the per-harness reason changed the UNREADABLE block's format, and the widen-controls
    # harness detected membership with the literal `f"{rel}: 0 anchors extracted"`. Eight of its
    # seventeen controls started reporting `0/2 of the harnesses that arm expect go UNREADABLE
    # again` about a checker that was working perfectly. That detector is now a PARSE that checks
    # itself against the count in the block's own header; this control moves the format again and
    # requires it to RAISE rather than quietly return a short set.
    total += 1
    print('\n== E6 the UNREADABLE block format moved again — the sibling detector must REFUSE')
    print("   PREDICT: unreadable_set() raises. It used to match a magic sentence and answered "
          "'not unreadable' when the sentence moved — the direction that reports a harness as "
          "readable when it is not")
    import subprocess as _sp
    _orig = io.open(CHECK, 'rb').read()
    _sha = sha(CHECK)
    try:
        edit(CHECK, 'unreadable.append(f"{rel}\\n    {why_unreadable(ex)}")',
                    'unreadable.append(f"* {rel}\\n    {why_unreadable(ex)}")')
        pr = _sp.run(['python3', os.path.join(REPO, 'scripts/w1121d-anchor-check-widen-controls-r5m2.py')],
                     capture_output=True, text=True, cwd=REPO, timeout=1800)
        raised = "UNREADABLE block's format moved" in (pr.stdout + pr.stderr)
    finally:
        io.open(CHECK, 'wb').write(_orig)
    assert sha(CHECK) == _sha, 'RESTORE FAILED for the checker'
    print(f"   RESULT : detector raised = {raised}")
    print(f"   VERDICT: {'OK' if raised else 'CONTROL FAILED'} — "
          f"{'it refuses instead of guessing' if raised else 'it still answered from a broken parse'}")
    ok += 1 if raised else 0

    # ── the regex-anchor half ─────────────────────────────────────────────────
    # ⚠ THE TWO-STEP BELOW IS NOT INVENTED FOR THE CONTROL — IT IS THE OBVIOUS NEXT MOVE, and each
    # half of it looks locally reasonable. `w11-face-identity` reads UNREADABLE because `_str`
    # cannot evaluate `os.path.join(ROOT, …)` and because its edit tuples call the anchor
    # `pattern`. Teach _str one and add the other to the vocabulary and the census reads 550
    # anchors / 5 unreadable — progress — while manufacturing 14 misses against a font-identity
    # guard whose anchors are all present and whose own re.findall assertion passes on every one.
    JOIN_STEP = ('        # Path("…") / pathlib.Path("…")\n'
                 '        if isinstance(node, ast.Call) and len(node.args) == 1:')
    JOIN_WIDE = ('        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)\n'
                 '                and node.func.attr == "join" and len(node.args) >= 2):\n'
                 '            parts = [self._str(a) for a in node.args[1:]]\n'
                 '            if all(x is not None for x in parts):\n'
                 '                return "/".join(parts)\n' + JOIN_STEP)
    VOCAB = '    ANCHOR_NAMES = frozenset({"old", "find", "anchor"})'
    VOCAB_WIDE = '    ANCHOR_NAMES = frozenset({"old", "find", "anchor", "pattern"})'
    GUARD = """        spliced = regex_spliced_names(ast.parse(h.read_text()))
        if spliced:"""
    GUARD_OFF = """        spliced = []
        if spliced:"""
    SPLICE_SET = 'RE_SPLICE = frozenset({"sub", "subn"})'

    control(
        'P1 the two-step widening applied, WITH the regex refusal in place',
        'ZERO misses. The extractor now reaches those anchors and the refusal DISCARDS them, '
        'which is the point: reaching them is not the same as being able to decide them',
        [(CHECK, JOIN_STEP, JOIN_WIDE), (CHECK, VOCAB, VOCAB_WIDE)],
        lambda r: (r['misses'] == 0 and 'ANCHOR ON REGEXES' in r['out'],
                   'refused, not reported as broken'
                   if r['misses'] == 0 else f"{r['misses']} false misses got through"))

    control(
        'P2 the SAME two-step with the regex refusal REVERTED — the harm, measured',
        '14 misses appear, every one against packages/ui/src/theme.css and every one a regex whose '
        'escapes cannot appear literally in a CSS file. This is what the refusal prevents',
        [(CHECK, JOIN_STEP, JOIN_WIDE), (CHECK, VOCAB, VOCAB_WIDE), (CHECK, GUARD, GUARD_OFF)],
        lambda r: (r['misses'] == 14 and 'theme.css' in r['out'],
                   'the 14 false misses reappear without the refusal — it is what stops them'
                   if r['misses'] == 14 else f"expected 14, got {r['misses']}"))

    # ⚠⚠ P3's ORIGINAL CLAIM WAS TRUE AT #291 AND IS FALSE NOW, AND THIS MERGE IS WHAT FALSIFIED
    # IT. It asserted that blinding the refusal costs no anchor, "because it discards candidates
    # nothing could decide anyway" — true while `_str` could not evaluate `os.path.join`, since
    # w11-face-identity's paths did not resolve and its regexes were never paired with a file.
    # `_str` can evaluate it now, so the refusal discards 15 candidates that WOULD be decided, and
    # blinding it yields 14 misses instead of none. **A guard that was preventive when it merged
    # became load-bearing three merges later, without anything touching the guard.** The claim is
    # restated rather than deleted, because the pair of dates is the point.
    control(
        'P3 the refusal blinded on a clean tree',
        'FOURTEEN misses now, where #291 measured none. The candidates it discards are no longer '
        'undecidable — os.path.join support resolves their paths — so the refusal is what stands '
        'between the census and 14 false misses on a font-identity guard',
        [(CHECK, GUARD, GUARD_OFF)],
        lambda r: (r['misses'] == 14 and 'theme.css' in r['out'],
                   f"{r['misses']} misses — the refusal is now load-bearing, and was not at #291"
                   if r['misses'] == 14 else f"expected 14, got {r['misses']}"))

    control(
        'P4 RE_SPLICE widened to include `search` — the narrowing, and it IS load-bearing',
        'w17-keysweep-per-route is flagged and its 3 real anchors are discarded. It uses '
        're.search(expect, f) on test OUTPUT while splicing literally, so keying on any re.* call '
        'deletes real coverage in the direction that looks like nothing happened',
        [(CHECK, SPLICE_SET, 'RE_SPLICE = frozenset({"sub", "subn", "search"})')],
        lambda r: (r['anchors'] < base['anchors'] and 'keysweep' in r['out'],
                   f"anchors {base['anchors']} -> {r['anchors']}, coverage lost as predicted"
                   if r['anchors'] < base['anchors'] else 'the narrowing appears to change nothing'))

    # ── the census-self-inclusion half ────────────────────────────────────────
    # ⚠ THESE TWO REPRODUCE THE DEFECT THIS TAB WALKED INTO, RATHER THAN DESCRIBING IT. The file
    # you are reading was first called `w1121d-write-target-controls-j8w4.py`, matched the
    # harness glob, and pushed the census to 75 with its own baseline reading `unreadable=8`
    # against a tree that had 7 — after the warning about exactly that was already written down
    # in this item. W6 renames it back and requires the census to HOLD — the same number with the
    # file renamed as without it.
    #
    # ⚠⚠ THE PIN WAS A LITERAL `74` AND A LEGITIMATE NEW HARNESS BROKE IT (tab-p9r4, W1.1.21d).
    # `scripts/w1121d-prediction-check-controls-p9r4.py` landed, matched the glob as any control
    # harness does, and the census moved to 75 — so W6 read CONTROL FAILED against a checker
    # behaving exactly as designed. That is defect 1 on this item's own list ("A HARDCODED
    # EXPECTED ASSERTION COUNT … pinned 53 where the sweep collects 54"), sitting inside a control
    # written after the list.
    #
    # ⚠ THE PROPERTY W6 TESTS WAS NEVER THE NUMBER — it is INVARIANCE: the census must be the same
    # with this file renamed as with it named conventionally. Measured in the same run, that
    # cannot go stale when the harness population legitimately grows. The sibling pin one file
    # over was written `base_anchors >= 558` and survived the same change untouched; this one was
    # written `== 74` and did not. A baseline's SHAPE decides whether it ages.
    #
    # ⚠ AND IT KEEPS A VACUITY FLOOR, because "before == after" is satisfied by 0 == 0 — which is
    # exactly the blinded-glob world the checker's own MIN_HARNESSES exists for.
    def rename_control(dst_name):
        src = os.path.abspath(__file__)
        dst = os.path.join(os.path.dirname(src), dst_name)
        os.rename(src, dst)
        return src, dst

    def censused(out):
        m = re.search(r'harnesses: (\d+)', out)
        return int(m.group(1)) if m else -1

    total += 1
    print('\n== W6 this control file renamed OUT of the `anchor-check` convention')
    print('   PREDICT: the census HOLDS — the same count renamed as unrenamed. Before this change '
          'the same rename took it UP by one: the instrument counting itself, in the direction '
          'that looks like progress')
    before = censused(run_check()['out'])
    src, dst = rename_control('w1121d-write-target-controls-j8w4.py')
    try:
        r = run_check()
    finally:
        os.rename(dst, src)
    n = censused(r['out'])
    good = n == before and before >= 70 and 'RUNS this checker' in r['out']
    print(f"   RESULT : harnesses={n} (unrenamed: {before}) anchors={r['anchors']} unreadable={r['unreadable']}")
    print(f"   VERDICT: {'OK' if good else 'CONTROL FAILED'} — "
          f"{'excluded by what it does, not what it is called' if good else 'the census absorbed a control for the checker'}")
    ok += 1 if good else 0

    # ⚠ AND THE OTHER DIRECTION, which is the one a raw text search gets wrong.
    total += 1
    print('\n== W7 a real harness that mentions the checker IN A COMMENT — MUST STAY IN THE CENSUS')
    print('   PREDICT: `w11-uppercase-count-controls.py` is still censused. Excluding on the raw '
          'text instead of on a string CONSTANT drops it, and a genuine harness leaving the census '
          'is the direction that looks like nothing happened')
    r = run_check()
    excluded = re.findall(r'excluded from the census — [^:]+: (\S+)', r['out'])
    # ⚠ THE `len(excluded) == 3` HALF WAS A PINNED POPULATION AND IT BROKE ON A LEGITIMATE
    # ADDITION (tab-p9r4, W1.1.21e): `w1121e-path-invariance-controls-p9r4.py` landed, RUNS this
    # checker, and was correctly excluded BY BEHAVIOUR — so the excluded set became four and W7
    # read "a real harness was dropped" about a checker doing exactly the right thing. That is
    # defect 1 on this item's list for the third time in one merge (W6's `n == 74`, S10's
    # `harnesses: 78`, and here), which is worth more than any of them individually: THE SHAPE
    # RECURS BECAUSE IT IS THE OBVIOUS THING TO WRITE.
    #
    # W7's property is not how many files are excluded — it is that the ONE harness which merely
    # MENTIONS the checker in a comment is not among them. The vacuity floor is separate and is
    # what stops "excluded nothing" scoring as success.
    good = 'w11-uppercase-count-controls.py' not in excluded and len(excluded) >= 3
    print(f"   RESULT : {len(excluded)} excluded: {excluded}")
    print(f"   VERDICT: {'OK' if good else 'CONTROL FAILED'} — "
          f"{'the comment-only mention is still checked' if good else 'a real harness was dropped'}")
    ok += 1 if good else 0

    print(f'\n== {ok}/{total} CONTROLS BEHAVED AS PREDICTED ==')
    return 0 if ok == total else 1


sys.exit(main())
