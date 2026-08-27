#!/usr/bin/env python3
"""Positive controls for the W1.1.21d extractor widening (tab-r5m2).

The widening moved the readable count 58 -> 61 and the decidable-anchor count 481 -> 501, and it
found NO stale anchor. That is the outcome that has to be distrusted: the three previous widenings
each surfaced controls that had been unarmable and invisible, and "more anchors, all healthy" is
also exactly what a widening that extracts UNCHECKABLE pairs would print.

⚠ SO THE CLAIM UNDER TEST IS NOT "the number went up". It is: for each harness that became readable,
the checker can now say NO about it. A newly-read harness whose anchors are all decided but whose
misses are never reported is a harness that moved from HONESTLY UNREADABLE to FALSELY CLEAN, which
is strictly worse than where it started.

  C1..C3  corrupt ONE anchor in each newly-read harness -> the checker MUST name that harness
  C4      the same corruption with the widening REVERTED -> the checker must NOT name it, and must
          report the harness UNREADABLE instead. This is what proves the widening is what sees it.
  F1      blind visit_Dict            -> the two dict-shaped harnesses go unreadable again

⚠ THIS FILE IS NAMED `…anchor-check…` ON PURPOSE. The checker's own census globs `w1*controls*.py`,
so a control script for the CHECKER is otherwise counted as one of the harnesses it checks — the
first draft was named `w1121d-extractor-widen-…` and pushed the census 74 -> 75 and the anchor count
501 -> 504, i.e. the instrument measuring itself. `anchor-check` is the substring the census already
excludes.
  F2      blind the list-of-pairs arm -> the call-shaped harness goes unreadable again

Every file is restored from saved bytes and sha256-verified in a finally.
"""
import hashlib
import io
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECKER = ROOT / "scripts" / "w1120-anchor-check-h3n8.py"

# (harness, an anchor the widening is what makes decidable)
NEWLY_READ = [
    (ROOT / "scripts/w11-card-heading-controls.py",
     '<h2 className="text-head text-ink">{children}</h2>'),
    (ROOT / "scripts/w11-type-scale-controls.py",
     "body: ['0.875rem', { lineHeight: '1.45', fontWeight: '400' }], // 14px"),
    (ROOT / "apps/web/scripts/w11-field-face-controls.py",
     "  if (PAINTS_NO_TEXT.has(type)) return false\\n"),
    # ── the ITERATION-SITE widening (second change under W1.1.21d) ──────────────────────────────
    (ROOT / "scripts/w11-debit-allowlist-controls.py",
     "const SETTLED_CHARGE = 'spend'"),
    (ROOT / "scripts/w11-spa-fallback-controls.py",
     'const bundleAssetsDir = "assets"'),
    # ── the EDITS-LOOP widening (third change under W1.1.21d) ───────────────────────────────────
    (ROOT / "apps/web/scripts/w11-skipped-test-controls.py",
     "    if (a.status !== 'passed') {"),
    (ROOT / "scripts/w11-ui-manifest-controls.py",
     '"test": "vitest run --reporter=default --reporter=json --outputFile=.vitest-report.json'),
    (ROOT / "scripts/w11-spa-cache-controls.py",
     'w.Header().Set("Cache-Control", "no-cache")'),
]

# ⚠ BLIND THE CALL, NOT THE GUARD AROUND IT. The first version of F1 poisoned `before` so the
# "found nothing" test could never fire, and visit_Dict went on extracting exactly as before —
# a mutation that changed a line and disabled nothing, scored as a floor that did not arm.
DICT_ARM = "        self._after_the_path(list(node.values))"
LIST_ARM = "        if isinstance(after, (ast.List, ast.Tuple)) and after.elts:"
# The iteration-site widening: the position comes from the for-loop unpacking, the file from the
# module having exactly one constant that names one. Blinding either must un-read both harnesses.
ITER_ARM = '    ANCHOR_NAMES = frozenset({"old", "find", "anchor"})'
SINGLE_ARM = "        return self.file_consts[0] if len(self.file_consts) == 1 else None"
# The edits-loop widening: the shape (arity, anchor, path?) comes from the INNER `for … in edits`
# loop, and resolve() learned to strip a leading `talyvor-suite/` that `Path.home() / "…"` leaves on.
EDITS_ARM = "        if self.edit_shapes and node.elts:"
REPONAME_ARM = '    if path.startswith(ROOT.name + "/"):' 


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def check() -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(CHECKER)], cwd=ROOT,
                       capture_output=True, text=True, timeout=600)
    return r.returncode, r.stdout + r.stderr


def names_miss(out: str, harness: pathlib.Path) -> bool:
    """Is this harness listed under the MISS heading — not merely mentioned somewhere?"""
    rel = str(harness.relative_to(ROOT))
    if "NO LONGER MATCH THE TREE" not in out:
        return False
    block = out.split("NO LONGER MATCH THE TREE", 1)[1]
    return any(line.strip() == rel for line in block.split("\n"))


def names_unreadable(out: str, harness: pathlib.Path) -> bool:
    return f"{harness.relative_to(ROOT)}: 0 anchors extracted" in out


def counts(out: str) -> tuple[int, int]:
    m = re.search(r"anchors decided: (\d+)", out)
    u = re.search(r"COULD NOT READ (\d+) HARNESS", out)
    return (int(m.group(1)) if m else -1, int(u.group(1)) if u else 0)


def main() -> int:
    files = [h for h, _ in NEWLY_READ] + [CHECKER]
    saved = {p: (p.read_bytes(), sha(p)) for p in files}
    verdicts = []

    def record(name, ok, detail):
        verdicts.append((name, ok, detail))
        print(f"  {'OK  ' if ok else '*** FAILED ***'}  {name}\n        {detail}")

    try:
        rc, out = check()
        base_anchors, base_unread = counts(out)
        record("BASELINE — widened, pristine",
               base_anchors >= 520 and base_unread == 8 and "every decidable anchor matches" in out,
               f"anchors decided={base_anchors}, unreadable={base_unread}")

        for i, (harness, anchor) in enumerate(NEWLY_READ, start=1):
            src = io.open(harness, encoding="utf-8").read()
            # ⚠ THE ANCHOR IS SOURCE TEXT, NOT AN ESCAPED VALUE. field-face writes its anchor as
            # the literal `"…return false\\n"`, so the harness FILE holds a backslash and an `n`;
            # decoding the escape turned it into a real newline and the corruption found nothing.
            real = anchor
            assert src.count(real) >= 1, f"C{i}: anchor not in {harness.name}"
            io.open(harness, "w", encoding="utf-8").write(
                src.replace(real, real + "ZZ_CORRUPTED_BY_A_CONTROL", 1))
            rc, out = check()
            ok = names_miss(out, harness)
            io.open(harness, "wb").write(saved[harness][0])
            record(f"C{i}  one anchor corrupted in {harness.name}", ok,
                   "checker names it under MISSES" if ok else
                   "checker did NOT name it — the harness reads decidable but cannot go red")

        # C4 — the same corruption, widening reverted
        harness, anchor = NEWLY_READ[0]
        src = io.open(harness, encoding="utf-8").read()
        io.open(harness, "w", encoding="utf-8").write(
            src.replace(anchor, anchor + "ZZ_CORRUPTED_BY_A_CONTROL", 1))
        chk = io.open(CHECKER, encoding="utf-8").read()
        assert DICT_ARM in chk
        io.open(CHECKER, "w", encoding="utf-8").write(chk.replace(DICT_ARM, "        return", 1))
        rc, out = check()
        ok = (not names_miss(out, harness)) and names_unreadable(out, harness)
        io.open(CHECKER, "wb").write(saved[CHECKER][0])
        io.open(harness, "wb").write(saved[harness][0])
        record("C4  same corruption, DICT widening REVERTED", ok,
               "the corruption is invisible and the harness reads UNREADABLE — so the widening is "
               "what sees it" if ok else "the corruption was visible without the widening — this "
               "control proves nothing about the widening")

        # C5 — the same argument for the ITERATION-SITE arm, on one of the harnesses only it reads
        harness, anchor = NEWLY_READ[3]
        src = io.open(harness, encoding="utf-8").read()
        io.open(harness, "w", encoding="utf-8").write(
            src.replace(anchor, anchor + "ZZ_CORRUPTED_BY_A_CONTROL", 1))
        chk = io.open(CHECKER, encoding="utf-8").read()
        assert ITER_ARM in chk
        io.open(CHECKER, "w", encoding="utf-8").write(
            chk.replace(ITER_ARM, "    ANCHOR_NAMES = frozenset()", 1))
        rc, out = check()
        ok = (not names_miss(out, harness)) and names_unreadable(out, harness)
        io.open(CHECKER, "wb").write(saved[CHECKER][0])
        io.open(harness, "wb").write(saved[harness][0])
        record("C5  same corruption, ITERATION-SITE widening REVERTED", ok,
               "invisible, and the harness reads UNREADABLE again" if ok else
               "the corruption was visible without the iteration-site rule")

        for name, arm, expect in (("F1  visit_Dict blinded", DICT_ARM,
                                   [NEWLY_READ[0][0], NEWLY_READ[1][0]]),
                                  ("F2  list-of-pairs arm blinded", LIST_ARM,
                                   [NEWLY_READ[2][0]]),
                                  ("F4  the for-loop unpacking rule blinded", ITER_ARM,
                                   [NEWLY_READ[3][0], NEWLY_READ[4][0]]),
                                  ("F5  the single-file fallback blinded", SINGLE_ARM,
                                   [NEWLY_READ[3][0], NEWLY_READ[4][0]]),
                                  # ⚠ THE TWO ARMS ARE LOAD-BEARING FOR DISJOINT SETS, MEASURED
                                  # RATHER THAN ASSUMED. The first version of these two floors
                                  # expected each arm to un-read all three, and both scored a
                                  # failure against a change that was working — blinding each in
                                  # turn shows the edits-loop rule carries spa-cache alone, while
                                  # skipped-test and ui-manifest were unreadable ONLY because their
                                  # paths would not resolve. Blinding BOTH un-reads all three.
                                  ("F6  the edits-loop rule blinded", EDITS_ARM,
                                   [NEWLY_READ[7][0]]),
                                  ("F7  the repo-name path prefix blinded", REPONAME_ARM,
                                   [NEWLY_READ[5][0], NEWLY_READ[6][0]])):
            chk = io.open(CHECKER, encoding="utf-8").read()
            assert arm in chk, name
            repl = {DICT_ARM: "        pass",
                    LIST_ARM: "        if False:",
                    ITER_ARM: "    ANCHOR_NAMES = frozenset()",
                    SINGLE_ARM: "        return None",
                    EDITS_ARM: "        if False:",
                    REPONAME_ARM: "    if False:"}[arm]
            io.open(CHECKER, "w", encoding="utf-8").write(chk.replace(arm, repl, 1))
            rc, out = check()
            got = [h for h in expect if names_unreadable(out, h)]
            io.open(CHECKER, "wb").write(saved[CHECKER][0])
            record(name, len(got) == len(expect),
                   f"{len(got)}/{len(expect)} of the harnesses that arm expect go UNREADABLE again")
    finally:
        for p, (b, h) in saved.items():
            io.open(p, "wb").write(b)
        bad = [p.name for p, (b, h) in saved.items() if sha(p) != h]
        print(f"\n  restored clean: {not bad}")
        if bad:
            print(f"  ⚠ NOT RESTORED: {bad}")
            return 2

    good = sum(1 for _, ok, _ in verdicts if ok)
    print(f"\n{good}/{len(verdicts)} controls behaved as specified")
    return 0 if good == len(verdicts) else 1


if __name__ == "__main__":
    raise SystemExit(main())
