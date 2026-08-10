#!/usr/bin/env python3
"""POSITIVE CONTROLS for noFlashTheme.test.ts — does each assertion actually catch anything?

Run from apps/web:   python3 scripts/w11-no-flash-theme-controls.py

The shape is this repo's, from scripts/w11-document-title-controls.py, and it is copied rather
than imported because every clause below is a failure mode this queue has already met:

  · THE CATCHER IS PREDICTED BEFORE THE RUN. A control that reds SOMETHING proves the tree is
    alive; only one that reds the test it was aimed at proves that test does the work. A missed
    prediction is reported MISPREDICTED, never quietly upgraded to CAUGHT.
  · EVERY CONTROL CARRIES A MUST-STAY-GREEN COMPANION. `src/documentTitle.test.tsx` also reads
    index.html — it asserts the `<title>` brand — so a mutation that breaks the FILE rather than
    the BEHAVIOUR reds it too and is scored BROADSIDE, justifying nothing.
  · THE ANCHOR IS ASSERTED UNIQUE BEFORE ANY WRITE. An edit that matched nothing scores
    NOT CAUGHT and reads as a dead guard.
  · FILES ARE RESTORED FROM SAVED BYTES, NEVER `git checkout` — index.html carries the
    uncommitted fix, so a checkout would revert the merge instead of the mutation. sha256 is
    compared after every restore and a mismatch is fatal.
  · THE VERDICT IS READ FROM THE ASSERTION MESSAGE, not the test name: a test that crashes in
    setup and a test that catches the mutation are the same line in a list of names.

  · AND C1 IS RUN AGAINST THE WHOLE PROJECT, not only its target. The claim this merge makes is
    that NOTHING in this repo ran the no-flash script; `--full` on C1 is what makes that claim
    falsifiable instead of asserted.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent
GUARD = 'src/noFlashTheme.test.ts'
COMPANION = 'src/documentTitle.test.tsx'

# main's shape: ONE try around both reads, and a catch arm that hard-codes light.
MAIN_SHAPE_OLD = """        var t = null
        try {
          t = localStorage.getItem('talyvor-theme')
        } catch (e) {
          /* Site data refused. That means there is no stored choice to read. It does not
             mean the reader chose the pale one. */
        }
        if (t !== 'light' && t !== 'dark') {
          t = 'light'
          try {
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark'
          } catch (e2) {
            /* No matchMedia at all. Nothing left to ask, and the attribute must still be
               set: theme.css declares every token under [data-theme], so an unset one
               renders the product with no canvas, no ink and no accent. */
          }
        }
        document.documentElement.setAttribute('data-theme', t)
"""

MAIN_SHAPE_NEW = """        try {
          var t = localStorage.getItem('talyvor-theme')
          if (t !== 'light' && t !== 'dark') {
            t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          }
          document.documentElement.setAttribute('data-theme', t)
        } catch (e) {
          document.documentElement.setAttribute('data-theme', 'light')
        }
"""

CONTROLS = [
    dict(
        id='C1',
        why='index.html reverted to main: ONE try around both reads, catch arm hard-codes light',
        file='index.html',
        old=MAIN_SHAPE_OLD,
        new=MAIN_SHAPE_NEW,
        predict=['honours prefers-color-scheme when the browser REFUSES site data'],
        full=True,
    ),
    dict(
        id='C2',
        why='the stored choice is never read — the OS preference decides every load',
        file='index.html',
        old="          t = localStorage.getItem('talyvor-theme')",
        # ⚠ THE CALL IS KEPT, ONLY ITS RESULT IS DISCARDED. A first draft replaced the whole
        # expression and ALSO removed the key literal from the script, so the premise assertion
        # ("the inline script mentions the theme key") fired alongside the two predicted cases —
        # a CAUGHT that could not say which of the two changes it caught.
        new="          t = localStorage.length === -1 ? localStorage.getItem('talyvor-theme') : null",
        predict=['lets a stored choice beat the OS preference',
                 'reads a stored dark on an OS that prefers light'],
    ),
    dict(
        id='C3',
        why='THE NAIVE FIX: the catches are split but the SECOND read is left unguarded, so an '
            'engine with no matchMedia throws out of the IIFE and sets no attribute at all',
        file='index.html',
        old="""          try {
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark'
          } catch (e2) {""",
        new="""          if (window.matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark'
          if (t === 'never') {""",
        predict=['still sets an attribute when storage is refused AND matchMedia does not exist'],
    ),
    dict(
        id='C4',
        why='index.html reads a DIFFERENT key from the one lib/theme.ts writes — the drift that '
            'hard-coding the literal in the guard exists to catch',
        file='index.html',
        old="localStorage.getItem('talyvor-theme')",
        new="localStorage.getItem('talyvor-theme-v2')",
        predict=['lets a stored choice beat the OS preference',
                 'reads a stored dark on an OS that prefers light'],
    ),
    dict(
        id='C5',
        why="THE GUARD'S OWN VACUITY: the harness stops executing the product's bytes. If any "
            'case were green on ambient state rather than on the script, it would survive this',
        file=GUARD,
        old='  new Function(INLINE[0])()',
        new='  void INLINE',
        predict=['honours prefers-color-scheme when the browser REFUSES site data',
                 'still answers light when the browser refuses site data and the OS says light',
                 'lets a stored choice beat the OS preference',
                 'reads a stored dark on an OS that prefers light',
                 'falls to the OS preference when storage works and holds nothing',
                 'still sets an attribute when storage is refused AND matchMedia does not exist',
                 'ignores a stored value that is neither light nor dark'],
    ),
    dict(
        id='C6',
        why='a SECOND attribute-less <script> joins index.html, so "the first match" stops being '
            'the only match — the premise assertion is what must speak',
        file='index.html',
        old='  </head>',
        new='    <script>\n      /* a second inline script */\n    </script>\n  </head>',
        predict=['is the one script this file runs'],
    ),
]

FAIL_LINE = re.compile(r'^\s*×\s+(.*?)(?:\s+\d+ms)?$')
MSG_LINE = re.compile(r'^\s*→\s+(.*)$')


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(target: str | None):
    """Return (rc, [(failed test name, message)]) for one vitest file, or the whole project."""
    cmd = ['npx', 'vitest', 'run', '--reporter=basic']
    if target:
        cmd.insert(3, target)
    r = subprocess.run(cmd, cwd=WEB, capture_output=True, text=True)
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
        path = WEB / c['file']
        original = path.read_bytes()
        before = sha(path)
        text = original.decode()

        n = text.count(c['old'])
        if n != 1:
            print(f"{c['id']}  ⚠ ANCHOR NOT UNIQUE in {c['file']}: found {n}, expected 1 — NOT RUN")
            results.append((c['id'], 'ANCHOR MISSING', ''))
            continue

        path.write_text(text.replace(c['old'], c['new'], 1))
        assert sha(path) != before, f"{c['id']}: the write changed no bytes"
        try:
            rc, fails = run(GUARD)
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
            results.append((c['id'], verdict, msg))
            print(f"\n{'='*100}\n{c['id']}  {verdict}   {c['why']}")
            print(f"  predicted : {len(c['predict'])} case(s)")
            print(f"  red       : {names if names else '(none)'}")
            print(f"  message   : {msg[:220]}")
            print(f"  companion {COMPANION}: {'GREEN' if comp_ok else 'RED — this control proves nothing'}")
            if extra:
                print(f"  ⚠ unpredicted also red: {extra}")

            if c.get('full'):
                # THE CLAIM UNDER TEST: nothing else in this repo runs the no-flash script.
                frc, ffails = run(None)
                others = sorted({n2 for n2, _ in ffails
                                 if not any(p in n2 for p in c['predict'])})
                print(f"  FULL PROJECT under {c['id']}: rc={frc}, {len(ffails)} red")
                print(f"    other tests red: {others if others else '(none — only this guard sees it)'}")
        finally:
            path.write_bytes(original)
            after = sha(path)
            assert after == before, f"{c['id']}: RESTORE FAILED for {c['file']} ({before} -> {after})"

    print(f"\n{'='*100}\nSUMMARY")
    for cid, verdict, msg in results:
        print(f"  {cid}  {verdict}")
    caught = sum(1 for _, v, _ in results if v == 'CAUGHT')
    print(f"  {caught}/{len(results)} CAUGHT BY THE PREDICTED TEST with the companion green")
    return 0 if caught == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
