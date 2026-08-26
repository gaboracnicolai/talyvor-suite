#!/usr/bin/env python3
"""POSITIVE CONTROLS for headerReflow.test.tsx — and the RED-FIRST proof.

Run from apps/web:   python3 scripts/w11-header-reflow-controls.py

⚠ READ THIS FIRST, BECAUSE IT BOUNDS WHAT THE VERDICTS BELOW MEAN. jsdom has no layout, so this
guard asserts DECLARED SHRINK ROLES, not the measurement they produce. Every control here removes
one of those declarations and asks whether the matching case speaks. A CAUGHT verdict therefore
proves the guard holds the CLASS — it does not prove the class fixes the reflow. That claim rests
on the Chrome measurement recorded in the guard's header (10 routes × 4 viewports × 2 email
lengths, before and after, instrument controlled by planting a +40px element), and this harness
cannot and does not re-check it.

Otherwise this is the repo's shape, from scripts/w11-document-title-controls.py: the catcher is
predicted before the run, each control carries a must-stay-green companion, anchors are asserted
UNIQUE before any write, files are restored from SAVED BYTES (never `git checkout` — every file
mutated carries the uncommitted fix) with sha256 compared after, and the verdict is read from the
ASSERTION MESSAGE rather than the test name.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent
GUARD = 'src/headerReflow.test.tsx'
COMPANION = 'src/ConsoleTitle.test.tsx'

CONTROLS = [
    dict(
        id='C1',
        why="MAIN'S SHAPE for the title: it goes back to a flex item that cannot shrink. RED-FIRST",
        file='apps/web/src/App.tsx',
        # ⚠ RE-ANCHORED AT W1.1.10: the title became an <h1> when the console gained its heading,
        # so this control has been unable to arm. The tag is PRESERVED in the mutation — reverting
        # it to a <div> would red the heading guards too, and then the red would not be about reflow.
        old='          <h1 className="min-w-0 truncate text-head text-ink">{page}</h1>',
        new='          <h1 className="text-head text-ink">{page}</h1>',
        predict=['lets the page title shrink'],
    ),
    dict(
        id='C2',
        why="MAIN'S SHAPE for the actions block — the 274px flex item that set the 380px floor",
        file='apps/web/src/App.tsx',
        old='          <div className="flex min-w-0 items-center gap-3">',
        new='          <div className="flex items-center gap-3">',
        predict=['lets the actions block shrink'],
    ),
    dict(
        id='C3',
        why="MAIN'S SHAPE for the email: the unbreakable token stops ellipsising",
        file='apps/web/src/components/AuthGate.tsx',
        old='      <span className="truncate text-caption text-muted" title={q.data.user.email}>',
        new='      <span className="text-caption text-muted" title={q.data.user.email}>',
        predict=['lets the signed-in email ellipsise'],
    ),
    dict(
        id='C4',
        why='the address is truncated with NO way to read it in full — information removed rather '
            'than laid out. The class is right and the affordance is gone',
        file='apps/web/src/components/AuthGate.tsx',
        old='      <span className="truncate text-caption text-muted" title={q.data.user.email}>',
        new='      <span className="truncate text-caption text-muted">',
        predict=['lets the signed-in email ellipsise'],
    ),
    dict(
        id='C5',
        why='THE SHRINK GOES TO THE WRONG PLACE: the sign-out hit target absorbs it instead of the '
            'text. Every other case still passes — only this half says which may give',
        file='apps/web/src/components/AuthGate.tsx',
        old='        className="shrink-0"\n',
        new='',
        predict=['does NOT let the sign-out control shrink'],
    ),
    dict(
        id='C6',
        why="THE GUARD'S OWN VACUITY: the probe reports SIGNED OUT, so the gate renders the "
            'sign-in card and the header never exists. A case that passes anyway never looked at '
            'a header',
        file=GUARD,
        old='          JSON.stringify({ mode: \'oidc\', authenticated: true, user: { email: \'operator@example.com\' } }),',
        new='          JSON.stringify({ mode: \'oidc\', authenticated: false }),',
        predict=['lets the page title shrink', 'lets the actions block shrink',
                 'lets the signed-in email ellipsise', 'does NOT let the sign-out control shrink'],
    ),
]

FAIL_LINE = re.compile(r'^\s*×\s+(.*?)(?:\s+\d+ms)?$')
MSG_LINE = re.compile(r'^\s*→\s+(.*)$')

ROOT = WEB.parent.parent


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(target: str):
    r = subprocess.run(
        ['npx', 'vitest', 'run', target, '--reporter=basic'], cwd=WEB, capture_output=True, text=True
    )
    out = r.stdout + r.stderr
    fails = []
    for line in out.splitlines():
        m = FAIL_LINE.match(line)
        if m:
            fails.append([m.group(1).strip(), '(no message line)'])
            continue
        m = MSG_LINE.match(line)
        if m and fails:
            fails[-1][1] = m.group(1).strip()
    return r.returncode, [tuple(f) for f in fails]


def main() -> int:
    results = []
    for c in CONTROLS:
        path = ROOT / c['file'] if c['file'].startswith('apps/') else WEB / c['file']
        original = path.read_bytes()
        before = sha(path)
        text = original.decode()

        n = text.count(c['old'])
        if n != 1:
            print(f"{c['id']}  ⚠ ANCHOR NOT UNIQUE in {c['file']}: found {n}, expected 1 — NOT RUN")
            results.append((c['id'], 'ANCHOR MISSING'))
            continue

        path.write_text(text.replace(c['old'], c['new'], 1))
        assert sha(path) != before, f"{c['id']}: the write changed no bytes"
        try:
            _, fails = run(GUARD)
            names = [f[0] for f in fails]
            hit = [p for p in c['predict'] if any(p in n2 for n2 in names)]
            missed = [p for p in c['predict'] if p not in hit]
            extra = [n2 for n2 in names if not any(p in n2 for p in c['predict'])]

            crc, cfails = run(COMPANION)
            comp_ok = crc == 0 and not cfails

            if not comp_ok:
                verdict = 'BROADSIDE'
            elif missed:
                verdict = 'MISPREDICTED' if hit else 'NOT CAUGHT'
            else:
                verdict = 'CAUGHT'

            msg = next((m for n2, m in fails if any(p in n2 for p in c['predict'])), '')
            results.append((c['id'], verdict))
            print(f"\n{'='*100}\n{c['id']}  {verdict}   {c['why']}")
            print(f"  predicted : {len(c['predict'])}, red: {len(names)}")
            print(f"  red       : {names if names else '(none)'}")
            print(f"  message   : {msg[:240]}")
            print(f"  companion {COMPANION}: {'GREEN' if comp_ok else 'RED — this control proves nothing'}")
            if extra:
                print(f"  ⚠ unpredicted also red: {extra}")
        finally:
            path.write_bytes(original)
            after = sha(path)
            assert after == before, f"{c['id']}: RESTORE FAILED for {c['file']} ({before} -> {after})"

    print(f"\n{'='*100}\nSUMMARY")
    for cid, verdict in results:
        print(f"  {cid}  {verdict}")
    caught = sum(1 for _, v in results if v == 'CAUGHT')
    print(f"  {caught}/{len(results)} CAUGHT BY THE PREDICTED TEST with the companion green")
    return 0 if caught == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
