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
# ⚠ RE-AIMED 2026-08-27 (tab-j8w4), NOT DELETED, AND THE MEANING IS PRESERVED EXACTLY. This was
# the one-line body of `_single_file`; the write-target rule made that body three lines, so the
# old anchor stopped matching and THIS CONTROL FAILED LOUDLY — which is the anchor check doing
# its job one level up, on its own control. Aimed at the WHOLE body rather than at the first
# arm on purpose: blinding only the first arm would leave `return self.written_file` standing,
# and on a harness whose single file constant IS its write target the method would keep
# answering — so the narrower mutation would disable nothing and F5 would pass having tested
# nothing. Replaced by `return None`, this is byte-for-byte the semantics it always had.
SINGLE_ARM = """        if len(self.file_consts) == 1:
            return self.file_consts[0]
        return self.written_file"""
# The edits-loop widening: the shape (arity, anchor, path?) comes from the INNER `for … in edits`
# loop, and resolve() learned to strip a leading `talyvor-suite/` that `Path.home() / "…"` leaves on.
# ⚠ ADDED 2026-08-27 (tab-j8w4). The anchor POSITION now comes from two independent places: the
# ANCHOR_NAMES vocabulary (ITER_ARM) and the names the harness hands to `.count(…)` (COUNT_ARM).
# C5 and F4 blind BOTH, because blinding one leaves the other reading the same harness — measured:
# with ANCHOR_NAMES alone emptied, `w11-spa-fallback` goes unreadable and `w11-debit-allowlist`
# does NOT, because it writes `original.count(o)` and the count rule reaches it. A control that
# blinds one arm and expects both harnesses to fall would be scoring a failure against a checker
# that is working, which is the mistake this file's own F6 comment records being made once.
COUNT_ARM = "                idx = next((i for i, n in enumerate(names) if n in self.counted_names), None)"
EDITS_ARM = "        if self.edit_shapes and node.elts:"
# ⚠ RE-ANCHORED 2026-08-27 (tab-p9r4, W1.1.21e), and the crash that demanded it is the good kind.
# This read `ROOT.name`; the strip now keys on the DECLARED `REPO_DIR_NAME`, because keying it on
# the checkout directory's name made the whole census depend on what the directory is called (569
# anchors in `…/talyvor-suite`, 564 in `…/p9r4-other`, same commit). When the arm went stale this
# harness raised `AssertionError: F7`, by name, rather than replacing nothing and scoring the
# blinding as harmless — which is the F1 lesson ("a mutation that changed a line and disabled
# nothing") held by an assert instead of by hope.
REPONAME_ARM = '    if path.startswith(REPO_DIR_NAME + "/"):' 


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


def unreadable_set(out: str) -> set[str]:
    """The harnesses in the UNREADABLE block, PARSED FROM THE BLOCK rather than matched against a
    magic sentence — and self-checked against the count in its own header.

    ⚠ THIS WAS `f"{rel}: 0 anchors extracted" in out`, AND ON 2026-08-27 THE CHECKER STOPPED
    PRINTING THAT SENTENCE. It now names the missing half per harness on a second line, so every
    control asking "did this harness go UNREADABLE again" answered NO — 8 of 17 failed, reporting
    `0/2 of the harnesses that arm expect go UNREADABLE again` about a checker that was working
    perfectly. **The detector was a string literal shared across two files with nothing pinning
    it.** It failed in the visible direction this time, which was luck and not design: the same
    stale match on a control asking "did it STAY readable" would have answered YES and passed.

    So the block is parsed, and the parse checks itself: the header says how many harnesses are
    listed, and if the per-harness lines do not add up to that number the format has moved again
    and this raises instead of quietly returning a short set.
    """
    if "COULD NOT READ" not in out:
        return set()
    m = re.search(r"COULD NOT READ (\d+) HARNESS\(ES\)", out)
    declared = int(m.group(1)) if m else -1
    block = out.split("COULD NOT READ", 1)[1]
    found = {ln.strip() for ln in block.split("\n")
             if re.fullmatch(r"  \S+\.py", ln)}
    if len(found) != declared:
        raise AssertionError(
            f"the UNREADABLE block's format moved: header says {declared}, parsed {len(found)}. "
            "Fix this parser deliberately — a short set here reports a harness as readable when "
            "it is not, and every control below is drawn from it.")
    return found


def names_unreadable(out: str, harness: pathlib.Path) -> bool:
    return str(harness.relative_to(ROOT)) in unreadable_set(out)


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
               # ⚠ MOVED 2026-08-27 (tab-j8w4) BY A REAL WIDENING, and both numbers are
               # deliberate. unreadable 8 → 7: the write-target rule carries
               # w11-scroll-reset. The anchor FLOOR is raised to the measured 530 rather
               # than left at 520 — a floor that trails the measurement by ten cannot see
               # a widening being reverted, which is the regression it exists for.
               # ⚠ MOVED AGAIN 2026-08-27 (tab-j8w4), 7 → 6, and this time NOT by a widening:
               # `w11-face-identity` was RECLASSIFIED out of "widen the extractor" into the
               # regex-anchored bucket, because its anchors are patterns spliced with re.sub and
               # this check compares with str.count.
               # ⚠⚠ SO THE SUM IS PINNED TOO, AND IT IS THE HONEST INVARIANT: the number of
               # harnesses this check CANNOT DECIDE is 7 either way. Pinning only `unreadable`
               # lets a harness move between the two buckets with the count looking like
               # progress — which is exactly the reclassification that just happened, and the
               # next one might not be honest.
               # ⚠ MOVED A THIRD TIME 2026-08-27 (tab-j8w4): 6 → 5 and the floor 530 → 537,
               # because the anchor position is now also derived from the names a harness hands
               # to `.count(…)` and that reads `w1118-money-name`. Three deliberate moves in one
               # session is what an exact pin is FOR — each one had to be looked at.
               # ⚠ FOURTH MOVE 2026-08-27 (tab-j8w4), 5 → 4 and the floor 537 → 543: `_str`
               # learned `os.path.join`, which reads `w18-prose-class`. FOUR deliberate moves in
               # one session, each one looked at — that is what an exact pin buys, and a range
               # would have absorbed every one of them silently.
               # ⚠ FIFTH MOVE 2026-08-27 (tab-j8w4), 4 → 3 and the floor 543 → 547: the join
               # branch stopped DROPPING its first argument, which reads `w17-mounted-patterns`.
               # Five deliberate moves in one session. Every one of them had to be looked at, and
               # one of them (this) turned out to be a bug the same tab had shipped three hours
               # earlier — which a range would have swallowed without a word.
               # ⚠ EIGHTH MOVE 2026-08-27 (tab-p9r4), 2 → 1 unreadable and the floor 563 → 579:
               # the assignment-unpacking rule (`needle, replacement = c.edit`) reads
               # `w116-members`, whose ten anchors it carries. ⚠ THE FLOOR AND THE PATH NOTE BELOW
               # ARE NOW CONSISTENT — since W1.1.21e the count no longer depends on the checkout
               # directory's name, so 579 is what EVERY checkout prints and the reason for taking
               # the lower number is gone. The note is kept because it is why 563 was there.
               #
               # ⚠⚠ AND 563 WAS NOT WHAT THIS TREE PRINTED ON THE CANONICAL PATH — IT PRINTED 568.
               # MEASURED at the same commit in two git worktrees differing ONLY in directory
               # name: `…/talyvor-suite` decides 568, `…/p9r4-b` decides 563. Several harnesses
               # anchor at `pathlib.Path.home() / "talyvor-suite" / …`; the extractor cannot
               # evaluate `Path.home()`, and the leading `talyvor-suite` segment is stripped only
               # when it equals `ROOT.name`. In any checkout not NAMED talyvor-suite — CI, a git
               # worktree, a reviewer's clone — those five anchors go undecided and the run still
               # prints "every decidable anchor matches the tree". The floor takes the LOWER,
               # reproducible number on purpose: a floor that only holds on one developer's path
               # is a floor that reds for everyone else. Reported as the next finding on this
               # item, NOT fixed here — one merge per finding.
               # ⚠ SEVENTH MOVE 2026-08-27 (tab-p9r4), floor 558 → 563 AND THE EXTRACTOR DID
               # NOT WIDEN. `scripts/w1121d-prediction-check-controls-p9r4.py` landed and matched
               # the harness glob as any control harness does, so the census read 74 → 75 and its
               # anchors 558 → 563 (measured in a clean checkout). Worth separating, because this item tracks the anchor count as
               # evidence of widening and a reader comparing 558 to 568 would conclude the
               # extractor moved. It did not: a harness was ADDED. ⚠ The equality pin one file
               # over (`n == 74`, W6) read CONTROL FAILED on the same change; this floor, written
               # `>=`, absorbed it silently. Both shapes have a cost and this is the trade.
               # ⚠ SIXTH MOVE 2026-08-27 (tab-j8w4), 3 → 2 and the floor 547 → 558: tuple-
               # unpacked path constants now bind, which reads `w11-cited-guard` — and reading it
               # immediately surfaced a K8 anchor that had been unable to arm since #274.
               # ⚠⚠⚠ NINTH MOVE 2026-08-27 (tab-c7k5, W1.1.21f), AND IT IS THE FIRST TIME THIS
               # FLOOR HAS EVER GONE **DOWN**: 579 → 536. A floor dropping is the direction that
               # hides a narrowing, so it is not taken on the arithmetic — it is taken on a set
               # comparison, and the set comparison is a control in
               # `w1121f-anchor-check-fstring-controls-c7k5.py` rather than a sentence here.
               # WHAT CHANGED: the checker now keeps ONE verdict per (path, anchor) at report
               # time. `_seen` deduped on `(path, anchor, count)`, so every anchor reached by both
               # a shape rule (count 1) and the after-the-path rule (count None) was checked —
               # and counted — TWICE.
               # MEASURED at `2f47eab`, both trees: pristine decides 579 triples over 534
               # DISTINCT anchors; with the f-string/`chr` rules and the dedupe it decides 583
               # triples over 536. **NOTHING WAS LOST — the distinct set is a strict superset,
               # +2 and −0** (the two `w11-glyph-controls` anchors, one of which was stale). So
               # the 43-point drop is 45 doubles removed and 2 anchors added, not reach going
               # away, and the floor is set to the measured 536 in the new units.
               base_anchors >= 536 and base_unread == 1
               and out.count("ANCHOR ON REGEXES") == 1
               # ⚠ THE EXACT PIN ON UNREADABLE, WRITTEN AS `+ 1 ==` BECAUSE THIS FILE WANTS EVERY
               # MOVE LOOKED AT. 2 → 1 with the assignment-unpacking rule (tab-p9r4). The one that
               # remains — `w171-docs-search-register` — is the honestly-undecidable one: three
               # constants, no single write target, and a mutation that is a CALLABLE. It is NOT
               # a backlog item, and the right next move on it is a decision about whether the
               # checker should exit 0 with a named undecidable rather than a widening.
               and base_unread + 1 == 2
               and "every decidable anchor matches" in out,
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
        assert ITER_ARM in chk and COUNT_ARM in chk
        io.open(CHECKER, "w", encoding="utf-8").write(
            chk.replace(ITER_ARM, "    ANCHOR_NAMES = frozenset()", 1)
               .replace(COUNT_ARM, "                idx = None", 1))
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
            mutated = chk.replace(arm, repl, 1)
            if arm is ITER_ARM:
                # both position rules, for the reason recorded beside COUNT_ARM above
                assert COUNT_ARM in mutated
                mutated = mutated.replace(COUNT_ARM, "                idx = None", 1)
            io.open(CHECKER, "w", encoding="utf-8").write(mutated)
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
