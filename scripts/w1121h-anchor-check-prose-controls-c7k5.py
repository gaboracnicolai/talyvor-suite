#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE PROSE-vs-VALUE SELF-EXCLUSION RULE (W1.1.21h, tab-c7k5).

⚠ THE DEFECT, AND I HIT IT BY ACCIDENT RATHER THAN BY LOOKING FOR IT. `_is_control_for_this_checker`
excluded any harness carrying the checker's stem in ANY string Constant. **A DOCSTRING IS A STRING
CONSTANT.** A new harness of mine named the checker in its module docstring, as prose, and was
silently dropped from the census — which stayed at 79 where it should have read 80. A number that
does not move is not a number anybody checks.

⚠⚠ THE RULE'S OWN COMMENT SAYS WHY IT SLIPPED THROUGH. It reasons about prose in a "COMMENT", and
its control (W7 in `w1121d-anchor-check-write-target-controls-j8w4.py`) plants a `#` comment —
which Python represents as NOTHING. The rule and its control agreed about the one form of prose the
rule already handled, and neither had an opinion about the other. **The intent was always "what the
file DOES": a control RUNS the checker, so it uses the path as a VALUE. Prose that happens to be a
Constant is a bare expression statement and computes nothing.**

  R0  baseline — the census count, and a harness that genuinely RUNS the checker stays excluded
  R1  a planted harness naming the checker in its DOCSTRING -> CENSUSED
  R2  the same harness with the fix REVERTED -> EXCLUDED. The decisive one: the old behaviour
      reproduced rather than argued
  R3  a planted harness that uses the path as a VALUE -> EXCLUDED, before and after. The fix must
      not open the door it was narrowing
  R4  a planted harness naming the checker in a `#` COMMENT -> CENSUSED. W7's case, still true
  R5  vacuity — the prose set forced empty -> R1's harness is excluded again, so the new set is
      what does the work

Planted files are deleted in a finally and their absence is verified.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECKER = ROOT / "scripts" / "w1120-anchor-check-h3n8.py"
STEM = "w1120-anchor-check"

PROSE_ARM = """    prose = {id(n.value) for n in ast.walk(tree)
             if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
             and isinstance(n.value.value, str)}"""
PROSE_OFF = "    prose = set()"
# The pre-fix predicate, verbatim in effect: every string Constant counts.
FIX_ARM = "               and CHECKER_STEM in n.value and id(n) not in prose"
FIX_OFF = "               and CHECKER_STEM in n.value"

# ⚠ EVERY PLANT CARRIES A REAL, CURRENT ANCHOR so it is READABLE. A plant with no decidable anchor
# lands in the UNREADABLE list instead, and "it is not in the census" and "it is in the census and
# unreadable" are different answers to the question these controls ask.
ANCHOR = '("apps/web/src/App.tsx", "export const CONSOLE_ROUTES", "export const ROUTES_X", 1)'

PLANT_DOCSTRING = f'''#!/usr/bin/env python3
"""A planted harness (W1.1.21h control). It mentions {STEM}-h3n8.py as PROSE and runs nothing."""
CONTROLS = [{ANCHOR}]
'''
PLANT_VALUE = f'''#!/usr/bin/env python3
"""A planted harness (W1.1.21h control) that genuinely RUNS the checker."""
import subprocess, sys
CHECKER = "scripts/{STEM}-h3n8.py"
CONTROLS = [{ANCHOR}]
subprocess.run([sys.executable, CHECKER])
'''
PLANT_COMMENT = f'''#!/usr/bin/env python3
"""A planted harness (W1.1.21h control)."""
# It mentions {STEM}-h3n8.py in a comment, the way w11-uppercase-count-controls.py does.
CONTROLS = [{ANCHOR}]
'''


def prose_only_harnesses() -> list[str]:
    """Censused harnesses that name the checker ONLY in prose — the population this rule protects.

    ⚠ DERIVED, NOT PINNED, AND THE FIRST CUT OF THIS FILE PINNED IT. R2 and R5 asserted the census
    returned to a hardcoded `base` when the fix was reverted. That held while exactly ONE harness
    depended on the rule; the very next merge added a second (`w11-press-c1-controls-c7k5.py`,
    whose docstring names the checker) and both controls FAILED reporting 79 where they wanted 80
    — against a fix that was working. **This file's own PR said "two changes at once cancel in a
    count" and then pinned a count.** The set is measured here instead, so it reports how many
    harnesses ride on this rule rather than going stale the moment another one does.
    """
    import ast as _ast
    out = []
    for q in sorted((ROOT / "scripts").glob("w1*controls*.py")) + \
            sorted((ROOT / "apps/web/scripts").glob("w1*controls*.py")):
        if "anchor-check" in q.name:
            continue
        try:
            tree = _ast.parse(q.read_text(encoding="utf8"))
        except SyntaxError:
            continue
        prose = {id(n.value) for n in _ast.walk(tree)
                 if isinstance(n, _ast.Expr) and isinstance(n.value, _ast.Constant)
                 and isinstance(n.value.value, str)}
        hits = [n for n in _ast.walk(tree) if isinstance(n, _ast.Constant)
                and isinstance(n.value, str) and STEM in n.value]
        if hits and all(id(n) in prose for n in hits):
            out.append(q.name)
    return out


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def census() -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(CHECKER)], cwd=ROOT,
                       capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    m = re.search(r"harnesses: (\d+)", out)
    return (int(m.group(1)) if m else -1), out


def censused(out: str, name: str) -> bool:
    """In the census means: NOT in the excluded list. Parsed from the excluded lines rather than
    inferred from the count, because two changes at once would cancel in a count."""
    excluded = re.findall(r"excluded from the census — [^:]+: (\S+\.py)", out)
    return name not in excluded


def swap(path: pathlib.Path, old: str, new: str, cid: str) -> None:
    text = path.read_text(encoding="utf8")
    n = text.count(old)
    if n != 1:
        raise AssertionError(
            f"{cid}: the mutation anchor occurs {n} time(s) in {path.name}, expected exactly 1. "
            "This control has gone stale — it would otherwise change nothing and score a pass.")
    path.write_text(text.replace(old, new, 1), encoding="utf8")


def main() -> int:
    saved = {CHECKER: (CHECKER.read_bytes(), sha(CHECKER))}
    plants: list[pathlib.Path] = []
    results: list[tuple[str, bool, str]] = []

    def record(cid, ok, detail):
        results.append((cid, ok, detail))
        print(f"  {'OK  ' if ok else '*** FAILED ***'}  {cid}\n        {detail}")

    def plant(stem: str, body: str) -> pathlib.Path:
        p = ROOT / "scripts" / f"w11-{stem}-controls-c7k5probe.py"
        p.write_text(body, encoding="utf8")
        plants.append(p)
        return p

    def restore():
        CHECKER.write_bytes(saved[CHECKER][0])
        for p in plants:
            if p.exists():
                p.unlink()
        plants.clear()

    try:
        base, out = census()
        record("R0  baseline — and a harness that genuinely RUNS the checker stays excluded",
               base > 0 and not censused(out, "w1121e-path-invariance-controls-p9r4.py"),
               f"census={base}; w1121e excluded="
               f"{not censused(out, 'w1121e-path-invariance-controls-p9r4.py')}")

        # ── R1 / R2, the decisive pair ────────────────────────────────────────────────────────
        p = plant("prose-probe", PLANT_DOCSTRING)
        n1, out = census()
        in1 = censused(out, p.name)
        record("R1  the checker named in a DOCSTRING -> CENSUSED",
               in1 and n1 == base + 1,
               f"census={n1} (expected {base + 1}), in census={in1} — prose is not a call")

        riders = prose_only_harnesses()          # the plant is one of them, by construction
        want_reverted = base + 1 - len(riders)
        swap(CHECKER, FIX_ARM, FIX_OFF, "R2")
        n2, out = census()
        in2 = censused(out, p.name)
        record("R2  the SAME harness with the fix reverted -> EXCLUDED",
               (not in2) and n2 == want_reverted,
               f"census={n2} (expected {want_reverted} = {base}+1−{len(riders)}), in census={in2}"
               f" — the old behaviour reproduced: every harness that names the checker only in "
               f"prose is silently dropped, and the count moves by exactly that population. "
               f"Riders today: {riders}")
        CHECKER.write_bytes(saved[CHECKER][0])

        # ── R5 vacuity, while the plant is still there ────────────────────────────────────────
        swap(CHECKER, PROSE_ARM, PROSE_OFF, "R5")
        n5, out = census()
        record("R5  vacuity: the prose set forced empty -> excluded again",
               not censused(out, p.name) and n5 == want_reverted,
               f"census={n5} (expected {want_reverted}) — the new set is what does the work, not "
               "the rewrite around it")
        restore()

        # ── R3 the door stays shut ────────────────────────────────────────────────────────────
        pv = plant("value-probe", PLANT_VALUE)
        n3, out = census()
        record("R3  the path used as a VALUE -> still EXCLUDED",
               not censused(out, pv.name) and n3 == base,
               f"census={n3} (expected {base}) — the fix narrows prose, it does not open the door")
        restore()

        # ── R4 W7's case still holds ──────────────────────────────────────────────────────────
        pc = plant("comment-probe", PLANT_COMMENT)
        n4, out = census()
        record("R4  the checker named in a `#` COMMENT -> CENSUSED (W7's case, still true)",
               censused(out, pc.name) and n4 == base + 1,
               f"census={n4} (expected {base + 1})")
        restore()
    finally:
        restore()
        clean = sha(CHECKER) == saved[CHECKER][1]
        leftovers = sorted(q.name for q in (ROOT / "scripts").glob("*c7k5probe.py"))
        print(f"\n  checker restored, sha256-verified: {clean}")
        print(f"  planted files removed: {not leftovers}"
              + (f" — LEFTOVERS {leftovers}" if leftovers else ""))
        if not clean or leftovers:
            results.append(("CLEANUP", False, "the checker or a planted file was left behind"))

    bad = [c for c, ok, _d in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} controls behaved as specified")
    if bad:
        print("NOT PROVEN: " + ", ".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
