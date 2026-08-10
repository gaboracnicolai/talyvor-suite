#!/usr/bin/env python3
"""POSITIVE CONTROLS for authProbeLoop.test.tsx — and the RED-FIRST proof.

Run from apps/web:   python3 scripts/w11-auth-probe-loop-controls.py

This guard was written AFTER the fix, so "it reds on the unfixed tree" is a claim that has to be
demonstrated rather than asserted: C1 restores main's shape byte for byte and IS the red-first
run. The shape is this repo's, from scripts/w11-document-title-controls.py.

  · THE CATCHER IS PREDICTED BEFORE THE RUN; a missed prediction is MISPREDICTED, never CAUGHT.
  · EVERY CONTROL CARRIES A MUST-STAY-GREEN COMPANION. `src/AuthGate.test.tsx` builds its OWN
    QueryClient, so it is blind to all of this BY CONSTRUCTION — which is exactly what makes it
    the right companion: it proves the mutation broke the BEHAVIOUR and not the FILE.
  · ANCHORS ASSERTED UNIQUE BEFORE ANY WRITE; files restored from SAVED BYTES, never
    `git checkout` (every file mutated carries the uncommitted fix); sha256 compared after.
  · THE VERDICT IS READ FROM THE ASSERTION MESSAGE, not the test name.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent
GUARD = 'src/authProbeLoop.test.tsx'
COMPANION = 'src/AuthGate.test.tsx'

RAW = "useQuery({ queryKey: ['auth-me'], queryFn: api.me, staleTime: 60_000 })"

BEHAVIOURAL = [
    'falls through to the app',
    'does not re-probe the dead BFF without bound',
    'reaches a settled error rather than fetching for ever',
    'says what is wrong on the surface',
]

# ⚠ CORRECTED TWICE, AND BOTH CORRECTIONS ARE THE RESULT. C4 makes every request SUCCEED, which
# removes the failing-probe premise. I first predicted all four failure cases, then two. Measured,
# the cases that actually red are these two — and the TWO THAT DO NOT are the honest finding:
#
#   · 'falls through to the app'                 stays GREEN — the app renders Overview whether or
#                                                not the probe failed. It asserts the app is on
#                                                screen, not that a failure put it there.
#   · 'does not re-probe the dead BFF...'        stays GREEN — with a probe that answers there is
#                                                no loop to count, so the bound is met trivially.
#
# Neither is wrong, and neither is deleted: they are what makes C1 and C2 red. But on their own
# they are not evidence about a FAILING probe, and this comment says so instead of the harness
# implying it. The two below are the ones that cannot pass without a real failure.
VACUITY_VISIBLE = [
    'reaches a settled error rather than fetching for ever',
    'says what is wrong on the surface',
]

CONTROLS = [
    dict(
        id='C1',
        why='MAIN\'S SHAPE: SessionChip declares the probe itself again. This is the red-first run',
        file='src/components/AuthGate.tsx',
        old='export function SessionChip() {\n  const q = useAuthMeReader()',
        new='export function SessionChip() {\n  const q = ' + RAW,
        predict=BEHAVIOURAL + ['has exactly one raw declaration of the probe'],
    ),
    dict(
        id='C2',
        why='the reader keeps the shared hook but the hook stops opting out of retryOnMount — '
            'the one property the whole fix is',
        file='src/lib/authMe.ts',
        old='    retryOnMount: false,\n',
        new='',
        predict=BEHAVIOURAL,
    ),
    dict(
        id='C3',
        why='A SECOND COPY OF THE SEAM: Setup.tsx declares the probe itself again. It is not on '
            'the route the behavioural cases render, so ONLY the enumeration can speak',
        file='src/areas/lens/Setup.tsx',
        old='  const me = useAuthMeReader()',
        new='  const me = ' + RAW,
        predict=['has exactly one raw declaration of the probe'],
    ),
    dict(
        id='C4',
        why='THE GUARD\'S OWN VACUITY: the cases stop failing every request, so the failing-probe '
            'premise disappears. Any case that passes anyway was never about a failing probe',
        file=GUARD,
        old="      calls.push(String(input))\n      throw new TypeError('Failed to fetch')",
        new="      calls.push(String(input))\n      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })",
        predict=VACUITY_VISIBLE,
    ),
    dict(
        id='C5',
        why='THE FIX TAKEN TOO FAR: the reader stops fetching at all (enabled: false). Every '
            'failure case above still passes — the must-stay-green half is what refuses it',
        file='src/lib/authMe.ts',
        old='    retryOnMount: false,\n',
        new='    retryOnMount: false,\n    enabled: false,\n',
        predict=['still probes on a PUBLIC page'],
    ),
]

FAIL_LINE = re.compile(r'^\s*×\s+(.*?)(?:\s+\d+ms)?$')
MSG_LINE = re.compile(r'^\s*→\s+(.*)$')


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
        path = WEB / c['file']
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
            print(f"  message   : {msg[:260]}")
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
