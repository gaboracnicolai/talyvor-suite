#!/usr/bin/env python3
"""POSITIVE CONTROLS for documentTitle.test.tsx — does each assertion actually catch anything?

Run from apps/web:   python3 scripts/w11-document-title-controls.py

WHY THIS SHAPE, AND WHAT EACH PART IS FOR — every clause is a failure this repo has already met:

  · THE CATCHER IS PREDICTED BEFORE THE RUN.  `predict` names the test(s) that must go red.  A
    control that reds SOMETHING proves the tree is alive; only a control that reds the test it was
    aimed at proves that test is the thing doing the work.  A prediction that misses is reported
    as MISPREDICTED, never quietly upgraded to CAUGHT.

  · EVERY CONTROL CARRIES A MUST-STAY-GREEN COMPANION.  A mutation that breaks the build, or that
    breaks everything, is indistinguishable from a working guard when you only look at exit codes.
    The companion is a file that MUST still pass; if it does not, the control is scored BROADSIDE
    and justifies nothing.

  · THE ANCHOR IS ASSERTED BEFORE ANY WRITE.  An edit that silently matched nothing scores
    NOT CAUGHT and reads as a dead guard.  Each control asserts its `old` appears EXACTLY ONCE.

  · FILES ARE RESTORED FROM SAVED BYTES, NEVER `git checkout`.  Every file mutated here carries
    the uncommitted fix, so a checkout would revert the merge instead of the mutation.  The sha256
    is compared before and after and a mismatch is fatal.

  · THE VERDICT IS READ FROM THE ASSERTION MESSAGE, NOT FROM THE TEST NAME.  A test that crashes
    in setup and a test that catches the mutation are the same line in a list of names.  The
    message each predicted test failed with is printed, so a reader can see WHICH assertion spoke.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent
GUARD = 'src/documentTitle.test.tsx'

CONTROLS = [
    dict(
        id='C1',
        why='the console half is not wired at all — the state main is in today',
        file='src/App.tsx',
        old='  const page = titleFor(pathname)\n  useDocumentTitle(page)\n',
        new='  const page = titleFor(pathname)\n',
        target=GUARD,
        predict=['/ledger is titled', '/admin is titled as no page', 'follows an in-app navigation'],
        companion='src/ConsoleTitle.test.tsx',
    ),
    dict(
        id='C2',
        why='the gate names the page BEHIND it — ConsoleTitle.test.tsx\'s own defect, arriving through the tab',
        file='src/components/AuthGate.tsx',
        old="  useDocumentTitle('Sign in')",
        new="  useDocumentTitle('Ledger')",
        target=GUARD,
        predict=['the sign-in card is titled Sign in'],
        companion='src/ConsoleTitle.test.tsx',
    ),
    dict(
        id='C3',
        why='the title is set once at mount and never again — correct for one route, wrong for every route walked to after it',
        file='src/documentTitle.ts',
        old='  }, [pageName])',
        new='    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [])',
        target=GUARD,
        predict=['follows an in-app navigation'],
        companion=GUARD,          # the per-address cases inside it must stay green — checked below
    ),
    dict(
        id='C4',
        why='the cold load and the SPA disagree about the product\'s name',
        file='index.html',
        old='<title>Talyvor Suite</title>',
        new='<title>Talyvor</title>',
        target=GUARD,
        predict=['is the same brand the cold load already ships'],
        companion='src/ConsoleTitle.test.tsx',
    ),
    dict(
        id='C5',
        why='the two legal pages stop naming themselves',
        file='src/routes/legalParts.tsx',
        old='  useDocumentTitle(title)\n',
        new='',
        target=GUARD,
        predict=['/privacy is titled', '/terms is titled'],
        companion='src/Legal.test.tsx',
    ),
    dict(
        id='C6',
        why='the front door stops naming itself',
        file='src/areas/marketing/Landing.tsx',
        old='  useDocumentTitle(null)\n',
        new='',
        target=GUARD,
        predict=['/marketing is titled', '/marketing/pricing is titled'],
        companion='src/ConsoleTitle.test.tsx',
    ),
    dict(
        id='C7',
        why='"no name of its own" stops meaning the brand alone and starts printing the absent name',
        file='src/documentTitle.ts',
        old='  return pageName ? `${pageName} | ${BRAND}` : BRAND',
        new='  return `${pageName} | ${BRAND}`',
        target=GUARD,
        predict=['the front door is the brand alone', '/marketing is titled'],
        companion='src/ConsoleTitle.test.tsx',
    ),
    dict(
        id='C8',
        why='THE GUARD\'S OWN VACUITY: without queryClient.clear() the first mock answers every later case, '
            'so the four gate cases render the CONSOLE and pass on a screen they never reached',
        file=GUARD,
        old='  queryClient.clear()\n',
        new='',
        target=GUARD,
        predict=['the sign-in card is titled Sign in', 'the consent screen is titled by its own header'],
        companion='src/ConsoleTitle.test.tsx',
    ),
]

FAIL_LINE = re.compile(r'^\s*×\s+(.*?)(?:\s+\d+ms)?$')
MSG_LINE = re.compile(r'^\s*→\s+(.*)$')


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(target: str):
    """Return (rc, [(failed test name, message)]) for one vitest file."""
    r = subprocess.run(
        ['npx', 'vitest', 'run', target, '--reporter=basic'],
        cwd=WEB, capture_output=True, text=True,
    )
    out = r.stdout + r.stderr
    fails, pending = [], None
    for line in out.splitlines():
        m = FAIL_LINE.match(line)
        if m:
            pending = m.group(1).strip()
            fails.append([pending, '(no message line)'])
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
            results.append((c['id'], 'ANCHOR MISSING', '', ''))
            continue

        path.write_text(text.replace(c['old'], c['new'], 1))
        assert sha(path) != before, f"{c['id']}: the write changed no bytes"
        try:
            rc, fails = run(c['target'])
            names = [f[0] for f in fails]
            hit = [p for p in c['predict'] if any(p in n2 for n2 in names)]
            missed = [p for p in c['predict'] if p not in hit]
            extra = [n2 for n2 in names if not any(p in n2 for p in c['predict'])]

            if c['companion'] == c['target']:
                # C3's companion is inside its own target: the per-address cases must stay green.
                comp_ok = not any(
                    'is titled' in n2 and 'follows an in-app navigation' not in n2 for n2 in names
                )
                comp_note = 'per-address cases in the same file'
            else:
                crc, cfails = run(c['companion'])
                comp_ok = crc == 0 and not cfails
                comp_note = c['companion']

            if not comp_ok:
                verdict = 'BROADSIDE'
            elif missed:
                verdict = 'MISPREDICTED' if hit else 'NOT CAUGHT'
            else:
                verdict = 'CAUGHT'

            msg = next((m for n2, m in fails if any(p in n2 for p in c['predict'])), '')
            results.append((c['id'], verdict, msg, f'{len(extra)} unpredicted also red'))
            print(f"\n{'='*100}\n{c['id']}  {verdict}   {c['why']}")
            print(f"  predicted: {c['predict']}")
            print(f"  red      : {names if names else '(none)'}")
            print(f"  message  : {msg}")
            print(f"  companion {comp_note}: {'GREEN' if comp_ok else 'RED — this control proves nothing'}")
        finally:
            path.write_bytes(original)
            after = sha(path)
            if after != before:
                print(f"⚠⚠ {c['file']} NOT RESTORED ({before[:12]} → {after[:12]})")
                return 2

    print(f"\n{'='*100}\nSUMMARY")
    for cid, verdict, msg, extra in results:
        print(f"  {cid}  {verdict:13} {extra:26} {msg[:70]}")
    caught = sum(1 for _, v, _, _ in results if v == 'CAUGHT')
    print(f"\n{caught}/{len(results)} CAUGHT by the predicted test, companion green.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
