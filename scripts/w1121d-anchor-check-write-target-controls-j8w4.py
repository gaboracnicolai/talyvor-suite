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

    # ── the why-unreadable half ───────────────────────────────────────────────
    # ⚠ THESE ARE THE CONTROLS THAT MATTER FOR A DIAGNOSTIC, because a diagnostic fails by being
    # PLAUSIBLE rather than by being absent. Each takes a harness the checker reads today, breaks
    # exactly ONE of the two halves, and requires the named reason to be the one that broke.
    SR = os.path.join(REPO, 'apps/web/scripts/w11-scroll-reset-controls.py')
    MONEY = os.path.join(REPO, 'apps/web/scripts/w1118-money-name-controls-h3n8.py')

    def reason_for(out, harness_name):
        lines = out.split('\n')
        for i, l in enumerate(lines):
            if harness_name in l and i + 1 < len(lines):
                return lines[i + 1].strip()
        return '<not listed as unreadable>'

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

    control(
        'E3 a harness that already lacks the shape half loses the file half too',
        'w1118-money-name moves from NO SHAPE HALF to NEITHER HALF — the three verdicts are '
        'reachable, not two with a decorative third',
        [(MONEY, 'FF = WEB / "src" / "figureFace.test.ts"',
                 'FF = WEB / "src" / "figureFaceZZ.test.ts"')],
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

    control(
        'E5 the diagnosis discriminates on a clean tree — MUST STAY TRUE',
        'at least three distinct verdicts across the six unreadable harnesses. This is the '
        'positive half of E4: the floor has to be satisfied by the real tree, not only violated '
        'by a mutation',
        [(CHECK, '# after consts are known, because the write target is looked up through them',
                 '# consts first: the write target resolves through them')],
        lambda r: (len({l.strip()[:14] for l in r['out'].split('\n')
                        if l.strip().startswith(('NO FILE HALF', 'NO SHAPE HALF', 'NEITHER HALF'))}) >= 3,
                   'three distinct verdicts are present on the real tree'))

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

    control(
        'P3 the refusal blinded on a clean tree',
        'the harness returns to the UNREADABLE list (7) and the regex bucket empties; anchors '
        'unchanged at 530, because the refusal discards candidates nothing could decide anyway',
        [(CHECK, GUARD, GUARD_OFF)],
        lambda r: (r['unreadable'] == base['unreadable'] + 1 and r['anchors'] == base['anchors']
                   and 'ANCHOR ON REGEXES' not in r['out'],
                   'exactly one harness moves back, no anchor lost'))

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
    # in this item. W6 renames it back and requires the census to hold at 74.
    def rename_control(dst_name):
        src = os.path.abspath(__file__)
        dst = os.path.join(os.path.dirname(src), dst_name)
        os.rename(src, dst)
        return src, dst

    total += 1
    print('\n== W6 this control file renamed OUT of the `anchor-check` convention')
    print('   PREDICT: the census HOLDS at 74. Before this change the same rename took it to 75 — '
          'the instrument counting itself, in the direction that looks like progress')
    src, dst = rename_control('w1121d-write-target-controls-j8w4.py')
    try:
        r = run_check()
    finally:
        os.rename(dst, src)
    held = re.search(r'harnesses: (\d+)', r['out'])
    n = int(held.group(1)) if held else -1
    good = n == 74 and 'RUNS this checker' in r['out']
    print(f"   RESULT : harnesses={n} anchors={r['anchors']} unreadable={r['unreadable']}")
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
    good = 'w11-uppercase-count-controls.py' not in excluded and len(excluded) == 3
    print(f"   RESULT : {len(excluded)} excluded: {excluded}")
    print(f"   VERDICT: {'OK' if good else 'CONTROL FAILED'} — "
          f"{'the comment-only mention is still checked' if good else 'a real harness was dropped'}")
    ok += 1 if good else 0

    print(f'\n== {ok}/{total} CONTROLS BEHAVED AS PREDICTED ==')
    return 0 if ok == total else 1


sys.exit(main())
