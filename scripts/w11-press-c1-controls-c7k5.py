#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR C1's REPAIR IN `w11-press-controls.py` (W1.1.21h, tab-c7k5).

⚠ THE MEASUREMENT THIS ANSWERS WAS ASKED BY A PREVIOUS TAB AND LEFT OPEN, in C1's own comment:
"Whether the guard is blind to the resolver, or this replacement no longer expresses the defect,
is the next measurement. DO NOT 'fix' it by weakening the assertion or by reverting to an anchor
that cannot run."

⚠⚠ THE ANSWER IS NEITHER. The replacement STOPPED RUNNING. `tailwind.config.ts` changed `content`
from an array to `{ files, transform }`, so `(tailwindConfig.content as string[]).map(...)` threw
`default.content.map is not a function` and reddened every case in `motion.test.tsx`. Measured
rather than inferred: the harness reported `red=True says-it=False` — red WITHOUT naming its own
defect, the "RED BUT WHOLESALE" state this family of harnesses exists to refuse. A broken build
and a catch are the same observation until something separates them, and here nothing had.

⚠⚠⚠ AND AN ANCHOR CHECK COULD NOT HAVE FOUND IT. C1's ANCHOR is in `motion.test.tsx` and is
present and correct — `w1120-anchor-check` reports this harness clean. What went stale is the
REPLACEMENT's assumption about a DIFFERENT file. **A replacement is a claim about the tree exactly
as an anchor is, and only one of the two has ever been checked.** That is the general finding.

  Q0  pristine — the press harness is 8/8 and C1 CAUGHT
  Q1  the replacement reverted to the pre-repair `as string[]` form -> C1 goes back to
      red-but-silent (NOT CAUGHT). The decisive one: the old behaviour reproduced, not argued
  Q2  the `!`-preserving branch removed from `absoluteContent` -> the guard's own sentence fires
      on a CLEAN tree, so the assertion C1 relies on is real and not incidental
  Q3  the pre-flight shape check fires by NAME when `content` stops being `{ files: … }`, rather
      than letting the campaign redden wholesale again
  Q4  vacuity — blind the guard's `negated.length` assertion and apply C1 -> NOT CAUGHT, so the
      catch is carried by that assertion and by nothing else

Every file is restored from saved bytes and sha256-verified in a finally.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HARNESS = ROOT / "scripts/w11-press-controls.py"
CONFIG = ROOT / "apps/web/tailwind.config.ts"
GUARD = ROOT / "apps/web/src/motion.test.tsx"

REPAIRED = ('            "  const content = { files: (tailwindConfig.content as { files: string[] }).files"\n'
            '            ".map((g) => resolve(appRoot, g)) }\\n"')
PRE_REPAIR = ('            "  const content = { files: (tailwindConfig.content as string[])'
              '.map((g) => resolve(appRoot, g)) }\\n"')
CONTENT_SHAPE = "  content: { files: content, transform: contentTransform },"
CONTENT_ARRAY = "  content: [...content],"
# The `!`-preserving branch: without it, `absoluteContent` IS the naive resolver.
NEGATION_ARM = "  return content.map((g) => (g.startsWith('!') ? `!${resolve(root, g.slice(1))}` : resolve(root, g)))"
NEGATION_OFF = "  return content.map((g) => resolve(root, g))"
NEGATED_ASSERT = "    expect(negated.length, 'the test-file exclusions are gone — this file is reading itself').toBe(2)"
NEGATED_OFF = "    expect(negated.length, 'the test-file exclusions are gone — this file is reading itself').toBeGreaterThanOrEqual(0)"


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def press() -> tuple[int, str]:
    """The whole campaign. ⚠ `w11-press-controls.py` takes NO filter argument — checked, it never
    reads `sys.argv` — so passing one would be silently ignored and this would read like a
    targeted run that was not."""
    r = subprocess.run([sys.executable, str(HARNESS)], cwd=ROOT,
                       capture_output=True, text=True, timeout=2400)
    return r.returncode, r.stdout + r.stderr


def c1(out: str) -> tuple[str, bool, bool]:
    """(verdict, red, says-it) for C1, parsed from its own two lines."""
    verdict, red, says = "", False, False
    lines = out.split("\n")
    for i, ln in enumerate(lines):
        if ln.startswith("C1 revert-the-resolver"):
            verdict = "CAUGHT" if re.search(r"\bCAUGHT\b", ln.split("expected")[0]) and \
                                  "NOT CAUGHT" not in ln.split("expected")[0] else "NOT CAUGHT"
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            red = "red=True" in nxt
            says = "says('this file is reading itself')=True" in nxt
    return verdict, red, says


def vitest_guard() -> tuple[int, str]:
    r = subprocess.run(["npx", "vitest", "run", "src/motion.test.tsx"], cwd=ROOT / "apps/web",
                       capture_output=True, text=True, timeout=1800)
    return r.returncode, r.stdout + r.stderr


def swap(path: pathlib.Path, old: str, new: str, cid: str) -> None:
    text = path.read_text(encoding="utf8")
    n = text.count(old)
    if n != 1:
        raise AssertionError(
            f"{cid}: the mutation anchor occurs {n} time(s) in {path.name}, expected exactly 1. "
            "This control has gone stale — it would otherwise change nothing and score a pass.")
    path.write_text(text.replace(old, new, 1), encoding="utf8")


def main() -> int:
    files = [HARNESS, CONFIG, GUARD]
    saved = {p: (p.read_bytes(), sha(p)) for p in files}
    results: list[tuple[str, bool, str]] = []

    def record(cid, ok, detail):
        results.append((cid, ok, detail))
        print(f"  {'OK  ' if ok else '*** FAILED ***'}  {cid}\n        {detail}")

    def restore():
        for p, (b, _s) in saved.items():
            p.write_bytes(b)

    try:
        _rc, out = press()
        v, red, says = c1(out)
        record("Q0  pristine — C1 CAUGHT, and it names its own defect",
               v == "CAUGHT" and red and says,
               f"verdict={v} red={red} says-it={says} (expected CAUGHT/True/True)")

        # ── Q1, the decisive one ──────────────────────────────────────────────────────────────
        swap(HARNESS, REPAIRED, PRE_REPAIR, "Q1")
        _rc, out = press()
        v, red, says = c1(out)
        record("Q1  replacement reverted to the pre-repair form -> red but SILENT",
               v == "NOT CAUGHT" and red and not says,
               f"verdict={v} red={red} says-it={says} (expected NOT CAUGHT/True/False) — the old "
               "behaviour reproduced: a replacement that THROWS reds everything and names nothing")
        restore()

        # ── Q2 the assertion C1 relies on is real ─────────────────────────────────────────────
        swap(CONFIG, NEGATION_ARM, NEGATION_OFF, "Q2")
        rc, out = vitest_guard()
        record("Q2  the `!`-preserving branch removed -> the guard's own sentence fires",
               rc != 0 and "this file is reading itself" in out,
               f"exit={rc}, sentence present={'this file is reading itself' in out} — the defect "
               "C1 plants is a real one the guard really catches, on a clean tree")
        restore()

        # ── Q3 the pre-flight ─────────────────────────────────────────────────────────────────
        swap(CONFIG, CONTENT_SHAPE, CONTENT_ARRAY, "Q3")
        rc, out = press()
        record("Q3  `content` no longer `{ files: … }` -> the pre-flight fires BY NAME",
               rc != 0 and "The shape moved" in out,
               f"exit={rc}, named={'The shape moved' in out} — instead of the campaign reddening "
               "wholesale and reading like the guard going blind")
        restore()

        # ── Q4 vacuity ────────────────────────────────────────────────────────────────────────
        swap(GUARD, NEGATED_ASSERT, NEGATED_OFF, "Q4")
        _rc, out = press()
        v, _red, says = c1(out)
        record("Q4  vacuity: the `negated.length` assertion blinded -> C1 NOT CAUGHT",
               v == "NOT CAUGHT" and not says,
               f"verdict={v} says-it={says} — the catch is carried by that one assertion and by "
               "nothing else, which is what stops Q0 passing for an incidental reason")
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
