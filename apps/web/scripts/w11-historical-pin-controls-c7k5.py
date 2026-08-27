#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE WHOLE-FILE HISTORICAL PIN CHECK (W1.1.21g, tab-c7k5).

⚠ THE DEFECT, FOUND BY RUNNING `w11-pointer-pins-controls.py` RATHER THAN READING IT. That harness
scored 9/10 with C9 FAILING — and C9 is the one control the file says it must have: "ONE CONTROL
MUST BE A MUTATION ONLY THIS GUARD CAN SEE (C9), or the pin has not been shown to earn its place
next to the seven audits already here." The pin's entire justification could not fire.

⚠⚠ WHY. `every HISTORICAL pointer names a line that no longer holds its fragment` asked
`lines[f.line - 1].includes(fragment)`. MEASURED at `5e61fde` across all six HISTORICAL pins: not
one of their fragments occurs ANYWHERE in its target file — so the predicate was false for every
line of every file and the assertion passed independently of the line number it was given. The
line was decorative. C9 puts `hover:underline` back into `IssueList.tsx`, and the rebuild of that
screen moved the quoted comment from line 357 to line 530 while the pin kept watching 357.
`restingAffordance.test.ts:26` still cites `IssueList.tsx:357` for a
`<Link className="underline-offset-2 hover:underline">`; line 357 is an `onSubmit` handler and
that Link is nowhere in the file.

⚠⚠⚠ SO THE GUARD GOT EASIER AS IT ROTTED. Line drift moves a HISTORICAL pin toward passing, never
toward failing. The question is asked of the whole FILE now, which is what a HISTORICAL entry
actually claims — this offender was fixed.

  N0  pristine — the pointer audit is green and the population floor is real
  N1  the fragment put back at a line the pin does NOT name -> the guard REDS
  N2  the SAME mutation with the whole-file arm reverted to the line check -> INVISIBLE.
      The decisive one, and it is the old behaviour reproduced rather than argued
  N3  a HISTORICAL pin pointed PAST EOF -> reported stale. Parity with the LIVE arm, which has
      always said so; measured 0 of 74 pins do this today, so N3 is what keeps it honest
  N4  vacuity — the HISTORICAL loop skips everything -> the population floor must FIRE, because
      an empty `misfiled` reads identically to a clean bill

Every file is restored from saved bytes and sha256-verified in a finally.
"""
import hashlib
import pathlib
import subprocess
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent
ROOT = WEB.parent.parent
AUDIT = WEB / "src/pointerAudit.test.ts"
ISSUELIST = WEB / "src/areas/track/IssueList.tsx"

TEST_NAME = "every HISTORICAL pointer names a file that no longer holds its fragment"
FLOOR_NAME = "expect(examined).toBeGreaterThan(4)"

# ⚠ THE LINE THE PIN DOES *NOT* NAME. The pin watches IssueList.tsx:357; this comment is at 530,
# which is exactly the gap that disarmed C9. Putting the fragment here is invisible to a
# line-scoped check and visible to a file-scoped one — which is the whole claim under test.
PROSE_ANCHOR = 'without a resting affordance". It was not the only one: this cell is the link,'
PROSE_WITH_FRAGMENT = ('without a resting affordance" (hover:underline). It was not the only one: '
                       'the link,')

WHOLE_FILE_ARM = """      const at = lines
        .map((body, i) => (body.includes(pin.fragment) ? i + 1 : 0))
        .filter((n) => n > 0)
      if (at.length > 0) {"""
LINE_SCOPED_ARM = """      const at = lines[f.line - 1].includes(pin.fragment) ? [f.line] : []
      if (at.length > 0) {"""
EOF_ARM = """      if (lines[f.line - 1] === undefined) {"""
EOF_ARM_OFF = """      if (false) {"""
# The pin whose line is moved past EOF. Only the KEY's line number changes, so the entry stays
# a real HISTORICAL pin rather than disappearing from the population.
PIN_KEY = "'apps/web/src/restingAffordance.test.ts:26|apps/web/src/areas/track/IssueList.tsx:357'"
PIN_KEY_EOF = "'apps/web/src/restingAffordance.test.ts:26|apps/web/src/areas/track/IssueList.tsx:99999'"
CITE = "apps/web/src/areas/track/IssueList.tsx:357"
CITE_EOF = "apps/web/src/areas/track/IssueList.tsx:99999"
LOOP_ARM = "      if (!pin || pin.kind !== 'HISTORICAL') continue"
LOOP_OFF = "      if (true) continue"


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def audit() -> tuple[int, str]:
    r = subprocess.run(["npx", "vitest", "run", "src/pointerAudit.test.ts"], cwd=WEB,
                       capture_output=True, text=True, timeout=900)
    return r.returncode, r.stdout + r.stderr


def reds(out: str) -> bool:
    return TEST_NAME in out and ("FAIL" in out or "AssertionError" in out)


def swap(path: pathlib.Path, old: str, new: str, cid: str) -> None:
    text = path.read_text(encoding="utf8")
    n = text.count(old)
    if n != 1:
        raise AssertionError(
            f"{cid}: the mutation anchor occurs {n} time(s) in {path.name}, expected exactly 1. "
            "This control has gone stale — it would otherwise change nothing and score a pass.")
    path.write_text(text.replace(old, new, 1), encoding="utf8")


def main() -> int:
    files = [AUDIT, ISSUELIST, WEB / "src/restingAffordance.test.ts"]
    saved = {p: (p.read_bytes(), sha(p)) for p in files}
    results: list[tuple[str, bool, str]] = []

    def record(cid, ok, detail):
        results.append((cid, ok, detail))
        print(f"  {'OK  ' if ok else '*** FAILED ***'}  {cid}\n        {detail}")

    def restore():
        for p, (b, _s) in saved.items():
            p.write_bytes(b)

    try:
        rc, out = audit()
        record("N0  pristine — the pointer audit is green and carries a population floor",
               rc == 0 and FLOOR_NAME in AUDIT.read_text(encoding="utf8"),
               f"exit={rc}, floor present={FLOOR_NAME in AUDIT.read_text(encoding='utf8')}")

        # ── N1 / N2, the decisive pair ────────────────────────────────────────────────────────
        swap(ISSUELIST, PROSE_ANCHOR, PROSE_WITH_FRAGMENT, "N1")
        rc, out = audit()
        record("N1  the fragment back at a line the pin does NOT name -> the guard REDS",
               rc != 0 and reds(out),
               f"exit={rc}, the HISTORICAL case named={reds(out)} — line 530, while the pin "
               "watches 357")

        swap(AUDIT, WHOLE_FILE_ARM, LINE_SCOPED_ARM, "N2")
        rc, out = audit()
        record("N2  SAME mutation, arm reverted to the line check -> INVISIBLE",
               rc == 0,
               f"exit={rc} (expected 0) — the old behaviour reproduced, not argued: a "
               "line-scoped HISTORICAL pin cannot see its own subject move")
        restore()

        # ── N3 past-EOF parity ────────────────────────────────────────────────────────────────
        swap(AUDIT, PIN_KEY, PIN_KEY_EOF, "N3")
        swap(WEB / "src/restingAffordance.test.ts", CITE, CITE_EOF, "N3")
        rc, out = audit()
        red_eof = "past EOF" in out
        swap(AUDIT, EOF_ARM, EOF_ARM_OFF, "N3")
        rc2, out2 = audit()
        record("N3  a HISTORICAL pin pointed PAST EOF -> reported stale; arm blinded -> silent",
               rc != 0 and red_eof and rc2 == 0,
               f"with the arm: exit={rc} named={red_eof}; blinded: exit={rc2} (expected 0) — "
               "parity with the LIVE arm, which has always said so")
        restore()

        # ── N4 vacuity ────────────────────────────────────────────────────────────────────────
        swap(AUDIT, LOOP_ARM, LOOP_OFF, "N4")
        rc, out = audit()
        record("N4  vacuity: the HISTORICAL loop skips everything -> the floor must FIRE",
               rc != 0 and "examined" in out,
               f"exit={rc} — an empty `misfiled` reads identically to a clean bill, which is "
               "why the floor is on the POPULATION and not on the verdict")
        restore()
    finally:
        restore()
        clean = all(sha(p) == s for p, (_b, s) in saved.items())
        print(f"\n  all files restored, sha256-verified: {clean}")
        if not clean:
            results.append(("RESTORE", False, "a file did not restore byte-identically"))

    bad = [c for c, ok, _d in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} controls behaved as specified")
    if bad:
        print("NOT PROVEN: " + ", ".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
