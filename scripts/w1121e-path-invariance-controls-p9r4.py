#!/usr/bin/env python3
"""Controls for W1.1.21e — the anchor check must decide the same anchors wherever it is checked out.

── THE DEFECT ───────────────────────────────────────────────────────────────

`resolve()` strips a leading `talyvor-suite/` segment, because several harnesses anchor at
`pathlib.Path.home() / "talyvor-suite" / …` and the extractor cannot evaluate `Path.home()`. It
stripped the segment when it equalled **`ROOT.name`** — the directory this repository happens to be
checked out into — and its comment called that "exact".

MEASURED at `da258d4` in two `git worktree` checkouts of the SAME commit differing ONLY in
directory name: `…/talyvor-suite` decided **569** anchors, `…/p9r4-other` decided **564**. The run
printed "every decidable anchor matches the tree" both times. Five anchors stopped being checked in
CI, in a worktree and in a reviewer's clone, with nothing said. And it was not only a count:
`w1121d-anchor-check-widen-controls-r5m2.py` scored **14/17** there — BASELINE, C6 and C7 all
failing — against 17/17 on the canonical path. **A control harness that can only pass on one
developer's path is, from anywhere else, indistinguishable from a broken guard**, which is this
item's own defect 4 aimed at the tooling built to find defect 4.

── WHY THIS IS AN INVARIANCE AND NOT A NUMBER ───────────────────────────────

A pinned count is what put the anchor-check controls in this position twice already: W6's `n == 74`
read CONTROL FAILED when a harness legitimately landed, and the floor one file over was written
`>=` and absorbed the same change in silence. Neither shape can express the property that actually
matters here, which is that TWO RUNS AGREE. So this compares two checkouts in the same run.

⚠ WITH A VACUITY FLOOR, because `0 == 0` is also invariant — a blinded glob would satisfy an
equality between two runs that both read nothing.

⚠ THE CHECKER UNDER TEST IS COPIED FROM THE WORKING TREE INTO BOTH WORKTREES, not taken from the
commit they are checked out at. Otherwise this harness tests whatever was last committed while
reporting on the file in front of you.
"""
import hashlib
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECKER_REL = "scripts/w1120-anchor-check-h3n8.py"
CHECKER = ROOT / CHECKER_REL
WIDEN_REL = "scripts/w1121d-anchor-check-widen-controls-r5m2.py"

ORIG = CHECKER.read_bytes()
SHA = hashlib.sha256(ORIG).hexdigest()

# ⚠ A LITERAL FLOOR ON WHAT A HEALTHY RUN DECIDES. Never `the other run's number` — that is the
# equality this file already makes, and comparing it to itself is how 0 == 0 passes.
MIN_ANCHORS = 500


def count(cwd: pathlib.Path) -> int:
    r = subprocess.run([sys.executable, CHECKER_REL], cwd=cwd, capture_output=True, text=True)
    m = re.search(r"anchors decided: (\d+)", r.stdout)
    return int(m.group(1)) if m else -1


def in_two_checkouts(mutate=None) -> tuple[int, int]:
    """Same commit, two directories, one named `talyvor-suite` and one deliberately not."""
    holder = pathlib.Path(tempfile.mkdtemp(prefix="w1121e-"))
    canon = holder / "talyvor-suite"
    other = holder / "definitely-not-the-repo-name"
    made = []
    try:
        for d in (canon, other):
            subprocess.run(["git", "worktree", "add", "-q", "--detach", str(d), "HEAD"],
                           cwd=ROOT, capture_output=True, text=True, check=True)
            made.append(d)
            # the file under test as it stands, not as last committed
            shutil.copy(CHECKER, d / CHECKER_REL)
            shutil.copy(ROOT / WIDEN_REL, d / WIDEN_REL)
            if mutate is not None:
                t = (d / CHECKER_REL)
                s = t.read_text()
                out = mutate(s)
                if out == s:
                    raise SystemExit("ANCHOR DEAD: the mutation changed nothing")
                t.write_text(out)
        return count(canon), count(other)
    finally:
        for d in made:
            subprocess.run(["git", "worktree", "remove", "--force", str(d)],
                           cwd=ROOT, capture_output=True, text=True)
        shutil.rmtree(holder, ignore_errors=True)


def widen_controls_elsewhere() -> tuple[int, int]:
    """The sibling control harness, run on the canonical name and on another. 17/17 both, or the
    guard is path-dependent again."""
    holder = pathlib.Path(tempfile.mkdtemp(prefix="w1121e-w-"))
    canon = holder / "talyvor-suite"
    other = holder / "definitely-not-the-repo-name"
    made = []
    try:
        outs = []
        for d in (canon, other):
            subprocess.run(["git", "worktree", "add", "-q", "--detach", str(d), "HEAD"],
                           cwd=ROOT, capture_output=True, text=True, check=True)
            made.append(d)
            shutil.copy(CHECKER, d / CHECKER_REL)
            shutil.copy(ROOT / WIDEN_REL, d / WIDEN_REL)
            r = subprocess.run([sys.executable, WIDEN_REL], cwd=d, capture_output=True, text=True)
            m = re.findall(r"(\d+)/(\d+) controls", r.stdout)
            outs.append(int(m[-1][0]) if m else -1)
        return outs[0], outs[1]
    finally:
        for d in made:
            subprocess.run(["git", "worktree", "remove", "--force", str(d)],
                           cwd=ROOT, capture_output=True, text=True)
        shutil.rmtree(holder, ignore_errors=True)


def revert_to_root_name(s: str) -> str:
    return s.replace('    if path.startswith(REPO_DIR_NAME + "/"):\n'
                     '        cands.append(ROOT / path[len(REPO_DIR_NAME) + 1:])',
                     '    if path.startswith(ROOT.name + "/"):\n'
                     '        cands.append(ROOT / path[len(ROOT.name) + 1:])', 1)


def declare_a_name_nobody_writes(s: str) -> str:
    return s.replace('REPO_DIR_NAME = "talyvor-suite"', 'REPO_DIR_NAME = "talyvor-emporium"', 1)


def blind_declaration_floor(s: str) -> str:
    return s.replace("        if needle_a in text or needle_b in text:",
                     "        if False:", 1)


results = []


def score(cid, desc, predicted, ok, detail):
    results.append((cid, ok))
    print(f"\n=== {cid} — {desc}")
    print(f"    PREDICTED {predicted}")
    print(f"    OBSERVED  {detail}")
    print(f"    {'PASS' if ok else 'FAIL'}")
    sys.stdout.flush()


try:
    a, b = in_two_checkouts()
    score("V0", "PRISTINE — the same commit under two directory names",
          "the two runs AGREE, and both are above the floor",
          a == b and a >= MIN_ANCHORS, f"talyvor-suite={a}  other={b}  floor={MIN_ANCHORS}")

    a, b = in_two_checkouts(revert_to_root_name)
    score("V1", "THE DEFECT — the strip keyed on ROOT.name again",
          "the two runs DISAGREE; the canonical name decides more",
          a != b and a > b, f"talyvor-suite={a}  other={b}  (delta {a - b})")

    a, b = in_two_checkouts(declare_a_name_nobody_writes)
    score("V2", "REPO_DIR_NAME declared as a name no harness writes",
          "both runs refuse (-1) — the declaration floor fires before any verdict",
          a == -1 and b == -1, f"talyvor-suite={a}  other={b}")

    a, b = in_two_checkouts(blind_declaration_floor)
    score("V3", "the declaration floor blinded — it must not be able to pass by reading nothing",
          "both runs refuse (-1): with the needle blinded no harness is found and the floor fires",
          a == -1 and b == -1, f"talyvor-suite={a}  other={b}")

    a, b = widen_controls_elsewhere()
    score("V4", "the sibling control harness under both directory names",
          "17/17 in BOTH — it scored 14/17 off the canonical path before this fix",
          a == 17 and b == 17, f"talyvor-suite={a}/17  other={b}/17")
finally:
    CHECKER.write_bytes(ORIG)
    print("\nCHECKER RESTORED, sha256-verified:",
          hashlib.sha256(CHECKER.read_bytes()).hexdigest() == SHA)
    if results:
        good = sum(1 for _, ok in results if ok)
        print(f"CONTROLS: {good}/{len(results)} as predicted")
        print("  " + "  ".join(f"{c}:{'ok' if ok else 'FAIL'}" for c, ok in results))
    sys.exit(0 if results and all(ok for _, ok in results) else 1)
