#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR W1.1.21f (tab-c7k5): THE f-STRING/`chr` ANCHOR RULES AND THE REPORT-TIME
ANCHOR DEDUPE IN `w1120-anchor-check-h3n8.py`.

⚠ THE FINDING THIS MERGE CAME FROM, so the controls below are read as answers to it:
`w11-glyph-controls.py`'s C1 had been a NO-OP since #265 rebuilt IssueDetail's way back from
"‹ Issues" to "All issues". Every run printed `ANCHOR FAILED … control NOT RUN` — to a reader.
The anchor check, whose entire subject is stale anchors, could not see it: the anchor was an
f-string interpolating `chr()` constants, `_str` returned None, and `_record` drops a None anchor
with NO ledger entry. So the census said "every decidable anchor matches the tree" with a rotted
anchor outside the population and no line anywhere saying one had been left out.

⚠⚠ THE CLAIM UNDER TEST IS NOT "the number went up" — the number went DOWN, 579 → 536, and that
is the second half of this merge. `_seen` dedupes on `(path, anchor, count)`, so an anchor reached
by both a shape rule (count 1) and the after-the-path rule (count None) was checked and counted
TWICE. Measured on pristine `2f47eab`: 579 triples over 534 DISTINCT anchors. The first real stale
anchor this checker ever found duly reported as TWO misses.

  B0   pristine, patched     — 536 anchors, 1 unreadable, no miss
  K1   corrupt the ONE anchor only these rules can read -> the checker MUST name its harness
  K2   the same corruption with the JoinedStr branch blinded -> INVISIBLE (this is the decisive one)
  K3   the same corruption with the `chr` branch blinded    -> INVISIBLE (both arms are load-bearing)
  K4   refusal: give the f-string a conversion -> the anchor goes UNREADABLE, never guessed
  K5   refusal: make the codepoint a NAME      -> the anchor goes UNREADABLE, never guessed
  K6   corrupt a DOUBLE-REACHED anchor -> exactly ONE miss; with the dedupe reverted, exactly TWO
  K7   the distinct anchor set is a strict SUPERSET of the pristine one — this is what makes a
       floor moving DOWN safe, and it is a computation rather than a sentence
  K8   vacuity: blind the dedupe's selector so it keeps nothing -> the run must REFUSE

Every file is restored from saved bytes and sha256-verified in a finally.
"""
import ast
import hashlib
import importlib.util
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECKER = ROOT / "scripts" / "w1120-anchor-check-h3n8.py"
GLYPH = ROOT / "scripts" / "w11-glyph-controls.py"
SNIPPETS = ROOT / "apps/web/src/areas/lens/setupSnippets.ts"
# A DOUBLE-REACHED anchor — one of the 47 the dedupe collapses. Its harness and file are named
# here rather than discovered, so a control that stops testing the double-reach says so.
DOUBLE_FILE = ROOT / "packages/ui/src/components/MuNumeral.tsx"
DOUBLE_ANCHOR = "<CaseSafe>µ</CaseSafe>"

# ⚠ BLIND THE ARM, NOT ITS SURROUNDINGS. This file's older sibling records F1: a mutation that
# changed a line and disabled nothing, scored as a floor that armed. Each anchor below is asserted
# to occur EXACTLY ONCE before it is used, and each blinding is checked by a control that must
# change its verdict — a blinding whose verdict does not move is reported, not passed.
JOINEDSTR_ARM = "        if isinstance(node, ast.JoinedStr):"
JOINEDSTR_OFF = "        if False and isinstance(node, ast.JoinedStr):"
CHR_ARM = '                and node.func.id == "chr" and len(node.args) == 1 and not node.keywords):'
CHR_OFF = '                and node.func.id == "chr!" and len(node.args) == 1 and not node.keywords):'
# Reverting the dedupe means leaving `decidable` at its pre-dedupe value — NOT emptying `_best`
# and rebuilding from it, which would produce the same list by a longer road and disable nothing.
DEDUPE_ARM = "        decidable = [(p, a, n) for (p, a), n in _best.items()]"
DEDUPE_OFF = "        _best.clear()  # W1.1.21f control: dedupe reverted, `decidable` stands as built"
# The selector, blinded so `_best` can never take an entry: this is the vacuity arm, and it must
# collapse the census rather than quietly pass.
SELECT_ARM = "            if (_p, _a) not in _best or (_best[(_p, _a)] is None and _n is not None):"
SELECT_OFF = "            if False:  # W1.1.21f vacuity control"

# The harness-side mutations. C2's anchor is the ONLY live anchor in this tree that needs both new
# rules to be read at all, which is why every arm below aims at it.
FSTRING_SRC = '          f"\'Settings {SINGLE_RIGHT} Models {SINGLE_RIGHT} OpenAI API Key.\'",'
FSTRING_CONV = '          f"\'Settings {SINGLE_RIGHT!r} Models {SINGLE_RIGHT} OpenAI API Key.\'",'
CHR_CONST = "SINGLE_RIGHT = chr(0x203A)"
CHR_NAME = "RIGHT_CP = 0x203A\nSINGLE_RIGHT = chr(RIGHT_CP)"


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_checker() -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(CHECKER)], cwd=ROOT,
                       capture_output=True, text=True, timeout=900)
    return r.returncode, r.stdout + r.stderr


def anchors(out: str) -> int:
    m = re.search(r"anchors decided: (\d+)", out)
    return int(m.group(1)) if m else -1


def unreadable(out: str) -> int:
    m = re.search(r"COULD NOT READ (\d+) HARNESS", out)
    return int(m.group(1)) if m else 0


def miss_lines(out: str) -> list[str]:
    """The per-anchor lines under the MISS heading, PARSED from the block.

    ⚠ Counting misses by grepping the whole output counts this file's own prose. The block is
    split off first, and the parse self-checks against the count in the heading — if they
    disagree the format has moved and that must raise, not silently return a short list.
    """
    if "NO LONGER MATCH THE TREE" not in out:
        return []
    m = re.search(r"(\d+) ANCHOR\(S\) NO LONGER MATCH", out)
    declared = int(m.group(1)) if m else -1
    block = out.split("NO LONGER MATCH THE TREE", 1)[1]
    lines = [ln.strip() for ln in block.split("\n")
             if re.match(r"^    \S+: (anchor absent|found \d+, harness expects \d+)$", ln)]
    if len(lines) != declared:
        raise AssertionError(
            f"the MISS block's format moved: heading says {declared}, parsed {len(lines)}. "
            "Every control below counts misses from this parse; a short list here reads as a "
            "guard going quiet.")
    return lines


def distinct_anchor_set() -> set[tuple[str, str, str]]:
    """(harness, path, anchor) for every anchor the CURRENT checker source can decide.

    Imported from the checker on disk rather than re-implemented, so this control cannot drift
    from the thing it is measuring — and it is called once with the patch in place and once with
    both new rules reverted, which is the whole of K7.
    """
    spec = importlib.util.spec_from_file_location(f"ac_{id(object()):x}", CHECKER)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    out: set[tuple[str, str, str]] = set()
    for h in m.harnesses():
        src = h.read_text(encoding="utf8")
        if m.regex_spliced_names(ast.parse(src)):
            continue
        home = m.package_root(h)
        ex = m.Extractor(src, home)
        ex.visit(ast.parse(src))
        for p, a, _n in ex.triples:
            if m.resolve(p, home):
                out.add((h.name, p, a))
    return out


def swap(path: pathlib.Path, old: str, new: str, cid: str) -> None:
    text = path.read_text(encoding="utf8")
    n = text.count(old)
    if n != 1:
        raise AssertionError(
            f"{cid}: the mutation anchor occurs {n} time(s) in {path.name}, expected exactly 1. "
            "This control has gone stale — it would otherwise change nothing and score as a pass.")
    path.write_text(text.replace(old, new, 1), encoding="utf8")


def main() -> int:
    files = [CHECKER, GLYPH, SNIPPETS, DOUBLE_FILE]
    saved = {p: (p.read_bytes(), sha(p)) for p in files}
    results: list[tuple[str, bool, str]] = []

    def record(cid: str, ok: bool, detail: str) -> None:
        results.append((cid, ok, detail))
        print(f"  {'OK  ' if ok else '*** FAILED ***'}  {cid}\n        {detail}")

    def restore() -> None:
        for p, (b, _s) in saved.items():
            p.write_bytes(b)

    try:
        _rc, out = run_checker()
        base_a, base_u, base_m = anchors(out), unreadable(out), miss_lines(out)
        # ⚠ 536 → 543 IN THE SAME MERGE, AND NOT BY A WIDENING: `w11-scroll-reset-derivation-
        # controls-c7k5.py` was ADDED, it matches the census glob as any control harness does,
        # and it carries 7 anchors. The extractor did not move. Written as an exact pin rather
        # than a floor precisely so this had to be looked at — the sibling widen file records a
        # `>=` floor absorbing the same kind of change silently and calls it the trade.
        record("B0  pristine, patched",
               # ⚠ 543 → 548, the SECOND deliberate move in one session and again NOT a
               # widening: `w1117-motion-census-derivation-controls-c7k5.py` was added and
               # carries 5 anchors. Two moves, two harnesses added, extractor untouched.
               # ⚠ 548 → 553, the THIRD move this session and again a harness ADDED, not a
               # widening: `w11-card-heading-drift-controls-c7k5.py`, 5 anchors. Three moves,
               # three harnesses, extractor untouched — which is exactly what an exact pin is
               # supposed to make a reader able to say.
               # ⚠ 553 → 559, the FOURTH move this session. Same shape every time: a harness
               # ADDED (`w11-historical-pin-controls-c7k5.py`, 6 anchors), extractor untouched.
               # ⚠ 559 → 563, the FIFTH move. A harness ADDED again
               # (`w11-press-c1-controls-c7k5.py`, 4 anchors) — and this one is the harness
               # whose DOCSTRING exposed the prose-vs-value hole in `_is_control_for_this_checker`
               # (#318). Until that merge it was silently EXCLUDED and this number did not move
               # at all, which is the whole reason the pin is exact rather than a floor.
               base_a == 563 and base_u == 1 and not base_m
               and "every decidable anchor matches" in out,
               f"anchors={base_a} unreadable={base_u} misses={len(base_m)}")

        # ── K1 ────────────────────────────────────────────────────────────────────────────────
        swap(SNIPPETS, "'Settings › Models › OpenAI API Key.',",
             "'Settings > Models > OpenAI API Key.',", "K1")
        _rc, out = run_checker()
        k1 = miss_lines(out)
        block = out.split("NO LONGER MATCH THE TREE", 1)[1] if k1 else ""
        record("K1  the f-string anchor corrupted in the tree",
               len(k1) == 1 and "scripts/w11-glyph-controls.py" in block,
               f"{len(k1)} miss(es); glyph harness named: "
               f"{'scripts/w11-glyph-controls.py' in block}")

        # ── K2 — DECISIVE ─────────────────────────────────────────────────────────────────────
        swap(CHECKER, JOINEDSTR_ARM, JOINEDSTR_OFF, "K2")
        _rc, out = run_checker()
        k2, k2a = miss_lines(out), anchors(out)
        record("K2  SAME corruption, JoinedStr branch blinded -> must be INVISIBLE",
               not k2 and k2a == base_a - 1,
               f"misses={len(k2)} anchors={k2a} (expected 0 and {base_a - 1}) — "
               "this is what separates 'these rules see it' from 'something already did'")
        CHECKER.write_bytes(saved[CHECKER][0])

        # ── K3 — DECISIVE ─────────────────────────────────────────────────────────────────────
        swap(CHECKER, CHR_ARM, CHR_OFF, "K3")
        _rc, out = run_checker()
        k3, k3a = miss_lines(out), anchors(out)
        record("K3  SAME corruption, chr() branch blinded -> must be INVISIBLE",
               not k3 and k3a == base_a - 1,
               f"misses={len(k3)} anchors={k3a} (expected 0 and {base_a - 1}) — "
               "neither arm alone reads this anchor")
        restore()

        # ── K4 refusal ────────────────────────────────────────────────────────────────────────
        swap(GLYPH, FSTRING_SRC, FSTRING_CONV, "K4")
        _rc, out = run_checker()
        k4, k4a = miss_lines(out), anchors(out)
        record("K4  a conversion in the f-string -> REFUSED, not guessed",
               not k4 and k4a == base_a - 1,
               f"misses={len(k4)} anchors={k4a} (expected 0 and {base_a - 1}) — half an anchor "
               "grepped against a file is a false miss, so the whole f-string must go unread")
        restore()

        # ── K5 refusal ────────────────────────────────────────────────────────────────────────
        swap(GLYPH, CHR_CONST, CHR_NAME, "K5")
        _rc, out = run_checker()
        k5, k5a = miss_lines(out), anchors(out)
        record("K5  a codepoint held in a NAME -> REFUSED, not guessed",
               not k5 and k5a == base_a - 1,
               f"misses={len(k5)} anchors={k5a} (expected 0 and {base_a - 1}) — `chr` is read "
               "only of an integer LITERAL, which has exactly one value")
        restore()

        # ── K6 the dedupe, both ways ──────────────────────────────────────────────────────────
        swap(DOUBLE_FILE, DOUBLE_ANCHOR, "<CaseSafe>u</CaseSafe>", "K6")
        _rc, out = run_checker()
        k6_on = miss_lines(out)
        swap(CHECKER, DEDUPE_ARM, DEDUPE_OFF, "K6")
        _rc, out = run_checker()
        k6_off = miss_lines(out)
        record("K6  one double-reached anchor corrupted: ONE miss, TWO with the dedupe reverted",
               len(k6_on) == 1 and len(k6_off) == 2,
               f"deduped={len(k6_on)} reverted={len(k6_off)} (expected 1 and 2) — the same "
               "anchor, in the same file, counted once and twice")
        restore()

        # ── K7 the superset, which is what licenses a floor going DOWN ────────────────────────
        after = distinct_anchor_set()
        swap(CHECKER, JOINEDSTR_ARM, JOINEDSTR_OFF, "K7")
        swap(CHECKER, CHR_ARM, CHR_OFF, "K7")
        before = distinct_anchor_set()
        restore()
        lost = before - after
        # ⚠ THE DELTA IS +1 AND NOT +2, AND THE REASON IS WORTH THE LINE. Against pristine
        # `2f47eab` these rules unlocked TWO anchors in `w11-glyph-controls.py` — and one of them
        # was the stale C1. Repairing C1 re-anchored it onto `      All issues\n`, a PLAIN string
        # the extractor could already read, so on THIS tree only C2's anchor still needs the new
        # rules at all. Written as +2 this control FAILED on its first run, which is the control
        # doing its job: the expectation had been copied from the wrong baseline.
        record("K7  the checker change loses NOTHING — a superset, measured not asserted",
               not lost and len(after) == len(before) + 1,
               f"before={len(before)} after={len(after)} lost={len(lost)} "
               f"(expected 0 lost, +1) — and against pristine 2f47eab the same computation "
               f"reads 534 -> 536, so the headline 579 -> 536 is 45 DOUBLES removed and 2 "
               f"anchors added, not reach going away"
               f"{'; LOST: ' + str(sorted(lost)[:3]) if lost else ''}")

        # ── K8 vacuity ────────────────────────────────────────────────────────────────────────
        swap(CHECKER, SELECT_ARM, SELECT_OFF, "K8")
        rc, out = run_checker()
        k8a = anchors(out)
        record("K8  vacuity: the dedupe selector kept nothing -> the run must REFUSE",
               rc != 0 and k8a == 0,
               f"exit={rc} anchors={k8a} (expected non-zero exit and 0) — a dedupe that silently "
               "kept nothing would print a clean bill over an empty population")
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
