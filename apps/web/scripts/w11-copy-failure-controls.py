#!/usr/bin/env python3
"""
w11-copy-failure-controls.py — the positive controls for src/copyFailure.test.tsx.

Every control names, BEFORE the run, the exact test it expects to red and the exact tests it
expects to stay green. A control with no must-stay-green companion is not a control: a syntax
error reds everything and reads as eight catches.

The two call sites are mutated SEPARATELY on purpose. `/keys` renders `RevealOnce` (packages/ui) alone;
`/setup` renders `RevealOnce` AND five `CopyBlock`s (apps/web). C2 is the control that measures
the CopyBlock half is reachable at all — the first version of this campaign scored it NOT CAUGHT
because RevealOnce's one notice was answering for all six of /setup's buttons.

Restore is from a byte copy taken before anything is written, not from git — a control campaign
is evidence only if the tree it started from is provably the tree it ends on.
"""
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
ROOT = WEB.parent.parent
REVEAL = ROOT / "packages/ui/src/components/RevealOnce.tsx"
SETUP = WEB / "src/areas/lens/Setup.tsx"
TARGET = "src/copyFailure.test.tsx"

# Test-name fragments, so a prediction names a case rather than a count.
#
# ⚠ SPLIT BY ENVIRONMENT, BECAUSE THE TWO FAILURE MODES NOW HAVE TWO SEPARATE ARMS. An absent
# clipboard raises a TypeError and lands in the `catch`; a refused one rejects and lands in the
# rejection handler. C3 and C9 mutate one arm each, and each must leave the OTHER environment's
# cases green — a single "the copy failed" list would have let one broken arm hide behind the
# other. Measured: C3 written against the whole list scored NOT CAUGHT for exactly that reason.
def _cases(screen):
    d = f"/{screen} — a copy that did not happen must say so > "
    return dict(
        visible={e: [d + f"tells the reader the copy failed when the clipboard is {e}"]
                 for e in ("absent", "rejecting")},
        announce={e: [d + f"announces the failure to assistive technology when the clipboard is {e}"]
                  for e in ("absent", "rejecting")},
        working=[d + "says nothing about a failure when the copy actually works, and confirms it instead"],
    )


KEYS, SETUP_C = _cases("keys"), _cases("setup")
BOTH_VISIBLE = {e: KEYS["visible"][e] + SETUP_C["visible"][e] for e in ("absent", "rejecting")}
BOTH_ANNOUNCE = {e: KEYS["announce"][e] + SETUP_C["announce"][e] for e in ("absent", "rejecting")}
ALL_WORKING = KEYS["working"] + SETUP_C["working"]
KEYS_VISIBLE = KEYS["visible"]["absent"] + KEYS["visible"]["rejecting"]
KEYS_ANNOUNCE = KEYS["announce"]["absent"] + KEYS["announce"]["rejecting"]
KEYS_WORKING = KEYS["working"]
SETUP_VISIBLE = SETUP_C["visible"]["absent"] + SETUP_C["visible"]["rejecting"]
SETUP_ANNOUNCE = SETUP_C["announce"]["absent"] + SETUP_C["announce"]["rejecting"]
SETUP_WORKING = SETUP_C["working"]

REVEAL_GUARDED = """    try {
      void navigator.clipboard.writeText(secret).then(
        () => {
          setCopyState('copied')
          window.setTimeout(() => setCopyState('idle'), 2000)
        },
        // No auto-clear: a failure the reader has not acted on must not time out into the
        // state that looks like "not yet".
        () => setCopyState('failed'),
      )
    } catch {
      // `navigator.clipboard` is not installed outside a secure context, so the line above
      // raises a TypeError before any promise exists.
      setCopyState('failed')
    }"""
REVEAL_SHIPPED_DEFECT = """    void navigator.clipboard.writeText(secret).then(() => {
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2000)
    })"""

SETUP_GUARDED = """          try {
            void navigator.clipboard.writeText(text).then(
              () => {
                setCopyState('copied')
                window.setTimeout(() => setCopyState('idle'), 1500)
              },
              () => setCopyState('failed'),
            )
          } catch {
            setCopyState('failed')
          }"""
SETUP_SHIPPED_DEFECT = """          void navigator.clipboard?.writeText(text).then(() => {
            setCopyState('copied')
            window.setTimeout(() => setCopyState('idle'), 1500)
          })"""

SETUP_LIVE = """      <span aria-live="polite" className="sr-only">
        {copyState === 'copied' ? 'Copied to clipboard' : copyState === 'failed' ? copyFailedNote : ''}
      </span>
"""

# ⚠ THE COMPONENT MAP, MEASURED BY C2 RATHER THAN ASSUMED. `/keys` renders `RevealOnce` alone;
# `/setup` renders `RevealOnce` AND five `CopyBlock`s. The first version of these predictions had
# `/setup` standing for CopyBlock, and C2 — reverting CopyBlock to exactly the code that shipped —
# reddened NOTHING, because RevealOnce's notice was answering for all six buttons. The guard now
# counts one notice per button; these predictions name the real renderers.
CONTROLS = [
    dict(
        name="C1 RevealOnce reverted to the shipped unguarded copy()",
        file=REVEAL, old=REVEAL_GUARDED, new=REVEAL_SHIPPED_DEFECT,
        reds=KEYS_VISIBLE + KEYS_ANNOUNCE + SETUP_VISIBLE + SETUP_ANNOUNCE,
        greens=KEYS_WORKING + SETUP_WORKING,
        why="the /keys defect exactly as it shipped. It reaches /setup too because that screen "
            "renders RevealOnce as well — which is why C2, not this one, is what proves the "
            "CopyBlock half is measured at all",
    ),
    dict(
        name="C2 Setup CopyBlock reverted to the shipped `?.` copy()",
        file=SETUP, old=SETUP_GUARDED, new=SETUP_SHIPPED_DEFECT,
        reds=SETUP_VISIBLE + SETUP_ANNOUNCE,
        greens=KEYS_VISIBLE + KEYS_ANNOUNCE + KEYS_WORKING + SETUP_WORKING,
        why="THE ONE THAT REWROTE THIS FILE. Every /keys case must stay green — a guard that "
            "reds on /keys when only CopyBlock moved is measuring the wrong component",
    ),
    dict(
        name="C3 RevealOnce reports SUCCESS on a failed copy",
        file=REVEAL, old="        () => setCopyState('failed'),", new="        () => setCopyState('copied'),",
        reds=BOTH_VISIBLE["rejecting"] + BOTH_ANNOUNCE["rejecting"],
        greens=BOTH_VISIBLE["absent"] + BOTH_ANNOUNCE["absent"] + ALL_WORKING,
        why="a handler that RUNS and says the wrong thing — the mutation an `is there a .catch` "
            "guard sails past. ONLY the rejecting cases may move: the absent case reaches the "
            "`catch` arm, which this control does not touch",
    ),
    dict(
        name="C4 RevealOnce reports FAILURE on a copy that worked",
        file=REVEAL, old="          setCopyState('copied')\n          window.setTimeout(() => setCopyState('idle'), 2000)",
        new="          setCopyState('failed')",
        reds=KEYS_WORKING + SETUP_WORKING,
        greens=KEYS_VISIBLE + KEYS_ANNOUNCE + SETUP_VISIBLE + SETUP_ANNOUNCE,
        why="THE INVERSE. A component that always claimed failure passes every failure case in "
            "this file; only the in-sweep working control can see it. Without this run the "
            "positive control is itself unmeasured",
    ),
    dict(
        name="C5 RevealOnce announces the failure but paints nothing",
        file=REVEAL,
        old="        {copyState === 'failed' ? <p className=\"text-body text-ink\">{copyFailedNote}</p> : null}",
        new="        {null}",
        reds=KEYS_VISIBLE + SETUP_VISIBLE,
        greens=KEYS_ANNOUNCE + SETUP_ANNOUNCE + KEYS_WORKING + SETUP_WORKING,
        why="half a fix. getByText finds sr-only text as readily as painted text, so without the "
            "`.sr-only` exclusion this would score as a whole one",
    ),
    dict(
        name="C6 RevealOnce paints the failure but announces nothing",
        file=REVEAL, old="copyState === 'failed' ? copyFailedNote : ''", new="''",
        reds=KEYS_ANNOUNCE + SETUP_ANNOUNCE,
        greens=KEYS_VISIBLE + SETUP_VISIBLE + KEYS_WORKING + SETUP_WORKING,
        why="the exact inverse of C5. Together they prove the two halves are non-redundant — "
            "neither case can pass on the other's evidence",
    ),
    dict(
        name="C9 RevealOnce reports SUCCESS when the clipboard is not installed at all",
        file=REVEAL,
        old="      // raises a TypeError before any promise exists.\n      setCopyState('failed')",
        new="      // raises a TypeError before any promise exists.\n      setCopyState('copied')",
        reds=BOTH_VISIBLE["absent"] + BOTH_ANNOUNCE["absent"],
        greens=BOTH_VISIBLE["rejecting"] + BOTH_ANNOUNCE["rejecting"] + ALL_WORKING,
        why="C3'S PARTNER, and the inverse of its blind direction. The non-secure-origin arm is "
            "the one the Chrome measurement was about; without this run nothing proves a case "
            "can tell that arm from the rejecting one",
    ),
    dict(
        name="C7 INVERTED — RevealOnce's failure note, same classes reordered",
        file=REVEAL, old="<p className=\"text-body text-ink\">{copyFailedNote}</p>",
        new="<p className=\"text-ink text-body\">{copyFailedNote}</p>",
        reds=[],
        greens=KEYS_VISIBLE + KEYS_ANNOUNCE + KEYS_WORKING + SETUP_VISIBLE + SETUP_ANNOUNCE + SETUP_WORKING,
        why="MUST STAY GREEN. Real bytes change and no behaviour does, so a campaign that reds "
            "here is reporting on its own edits rather than on the product",
    ),
    dict(
        name="C8 Setup CopyBlock loses its live region",
        file=SETUP, old=SETUP_LIVE, new="",
        reds=SETUP_ANNOUNCE,
        greens=SETUP_VISIBLE + SETUP_WORKING + KEYS_VISIBLE + KEYS_ANNOUNCE + KEYS_WORKING,
        why="the announcement half at the OTHER call site, and the narrowest control here: only "
            "the /setup announce cases may move",
    ),
]


def run_target():
    p = subprocess.run(
        ["npx", "vitest", "run", TARGET, "--reporter=verbose"],
        cwd=WEB, capture_output=True, text=True,
    )
    out = p.stdout + p.stderr
    failed, passed = set(), set()
    for line in out.splitlines():
        s = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
        m = re.match(r"^[×✗]\s+(?:src/\S+\s+>\s+)?(.+?)(?:\s+\d+ms)?$", s)
        if m:
            failed.add(m.group(1).strip())
            continue
        m = re.match(r"^[✓√]\s+(?:src/\S+\s+>\s+)?(.+?)(?:\s+\d+ms)?$", s)
        if m:
            passed.add(m.group(1).strip())
    msgs = [re.sub(r"\x1b\[[0-9;]*m", "", l).strip()
            for l in out.splitlines() if "AssertionError" in l]
    return failed, passed, msgs, out


def match(names, seen):
    """The reporter prints `<describe> > <test>`, which is exactly how a prediction is written."""
    return set(names) & set(seen)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="w11-copy-ctl-"))
    pristine = {}
    for f in (REVEAL, SETUP):
        pristine[f] = tmp / f.name
        shutil.copy2(f, pristine[f])

    # ASSERT EVERY ANCHOR BEFORE ANY WRITE. A half-applied campaign restores a tree that never
    # existed, and the run after it is a measurement of the harness.
    for c in CONTROLS:
        src = c["file"].read_text()
        if src.count(c["old"]) != 1:
            print(f"ABORT: {c['name']} — anchor appears {src.count(c['old'])} times, not once")
            return 2

    print("BASELINE (no mutation) — every case must be green")
    failed, passed, _, out = run_target()
    if failed or not passed:
        print(f"ABORT: baseline is not clean. failed={sorted(failed)}")
        print(out[-3000:])
        return 2
    print(f"  {len(passed)} green, 0 red\n")

    score = 0
    for c in CONTROLS:
        f = c["file"]
        src = f.read_text()
        f.write_text(src.replace(c["old"], c["new"], 1))
        assert f.read_text() != src, "control did not change the file"
        failed, passed, msgs, out = run_target()
        if not failed and not passed:
            verdict = "BROKEN — the run produced no test results (a crash is not a catch)"
        else:
            want_red = match(c["reds"], failed)
            want_green_broken = match(c["greens"], failed)
            all_red_named = len(want_red) == len(c["reds"])
            ok = all_red_named and not want_green_broken
            verdict = "CAUGHT by the predicted case" if ok else "NOT AS PREDICTED"
            if not ok:
                verdict += f"\n      predicted red, did not red: {sorted(set(c['reds']) - want_red)}"
                verdict += f"\n      predicted green, went red: {sorted(want_green_broken)}"
        print(f"{c['name']}\n   {c['why']}\n   -> {verdict}")
        print(f"      red={len(failed)} green={len(passed)}")
        for m in msgs[:2]:
            print(f"      msg: {m[:180]}")
        print()
        if verdict.startswith("CAUGHT"):
            score += 1
        shutil.copy2(pristine[f], f)
        assert f.read_text() == pristine[f].read_text(), "restore failed"

    # The tree must end byte-identical to the tree it started from.
    for f in (REVEAL, SETUP):
        assert f.read_text() == pristine[f].read_text(), f"{f} not restored"
    failed, passed, _, _ = run_target()
    print(f"RESTORED — {len(passed)} green, {len(failed)} red (must be 0 red)")
    print(f"\n{score}/{len(CONTROLS)} controls behaved exactly as predicted")
    return 0 if score == len(CONTROLS) and not failed else 1


if __name__ == "__main__":
    sys.exit(main())
