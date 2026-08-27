#!/usr/bin/env python3
"""w1121d-prediction-check-p9r4.py — every ASSERTED prediction is a claim that some guard still
prints a string, and nothing has ever checked one.

── WHY THIS EXISTS ──────────────────────────────────────────────────────────

W1.1.21d's brief names two halves. Eleven merges went into the first — can this repo READ its
control harnesses, unreadable 16 → 2, anchors 481 → 558, 0 misses. The second is untouched and
the item says so: "THE PREDICTION-CHECK HALF OF THIS ITEM IS UNTOUCHED … it is the one that would
have caught three of the five defects W1.1.21c found by running, and it has a false-red problem
that needs solving first."

The five defects were all in harnesses whose anchors were ALL PRESENT. The one this file is for
is number 4, and the item marks it as the dangerous direction:

    "A GUARD MESSAGE MADE MORE SPECIFIC. check-audit-reach added the project name to two
     sentences and five reach controls scored NOT CAUGHT against a guard firing on every one of
     them. ⚠ This is the dangerous direction — a working guard that looks broken is a guard
     somebody deletes."

An anchor check cannot see that. The anchor was present; the harness ran; it reported the product
broken. What moved was a sentence the harness predicts and the guard no longer says.

── THE FALSE-RED PROBLEM, MEASURED BEFORE ANYTHING WAS BUILT ────────────────

The brief's sketch is "every phrase= / predicted / 'reds' literal is a claim that some guard still
prints that string, and it is greppable against the guard's source exactly as an anchor is
greppable against the tree". MEASURED at main `fa95b86`, that is FALSE for most of the
population, and building it as sketched ships noise:

  · Of 46 `phrase=` / `catcher=` / `expect=` values, **41 do not occur in the tree** — and almost
    none of those is a defect. `expect=` and `catcher=` are PROSE ABOUT THE CONTROL ("EXACTLY TWO,
    one per direction", "NOTHING. THE MUST-STAY-GREEN COMPANION"). Traced to their use: both are
    only ever `print()`ed for a human. Nothing asserts them, so nothing can go stale in the sense
    that matters.
  · What IS load-bearing is narrower and is found by USE, not by field name: a string literal
    compared against CAPTURED OUTPUT (`if "…" in out`). Fifteen of those, in 8 harnesses. Those
    are the claims whose staleness makes a working guard look broken.

⚠ AND THE POPULATION FOUND BY NAME AND THE POPULATION FOUND BY USE BARELY OVERLAP. `w11-reach`'s
six `phrase=` values look like the target set and are the DESCRIPTIONS beside it; the assertion
underneath compares two other literals. A rule keyed on the field name would have policed the
labels and left the assertions alone.

── THE FIX FOR THE FALSE RED WAS ITSELF A FALSE GREEN, AND S1 IS WHAT SAID SO ──

The first cut answered the composed-message problem with a heuristic: take the longest contiguous
word-run of the literal that occurs anywhere in the tree, and if one is found, call the prediction
"present as the fixed part of an interpolated message". It passed on the first run and control S1
killed it.

S1 reproduces defect 4 on the real guard — `never recorded as committed` edited to `never
recorded by apps/web as committed`, which is what "made more specific" means when the specificity
lands INSIDE the phrase. The prediction is now BROKEN. The heuristic found `never recorded` still
present, classified it COMPOSED, and **exited 0**. A rule added to stop false reds had swallowed
the true one — the defect this file exists for, absorbed by this file's own leniency.

⚠ THE HEURISTIC WAS ALSO MIS-ATTRIBUTING. For `UNAUDITED  packages/ui#HoldBar is exported` the
longest run it found was `packages/ui#HoldBar`, matched inside a PROSE COMMENT in the guard, not
in the message template. It was answering "does some fragment appear somewhere" while reporting
"the guard still says the fixed part of this".

So there is no heuristic here now. A prediction is decided VERBATIM or it reds, unless it is
DECLARED — as external, or as interpolated with the guard file and the fixed fragments named. Both
declarations police themselves (below). A new interpolated prediction reds by default and someone
has to look at it, which is the only direction an escape hatch may fail in.

── AND A FALSE GREEN, WHICH IS WORSE AND IS WHY THE VERDICT IS ONE-SIDED ────

`w17-keysweep` and `w11-doc-subject` assert `"build failed"` and `"cannot find package"` against
`go test` output — GO TOOLCHAIN strings, produced by no file in this repository. A presence check
over the tree finds `build failed` in `apps/web/src/eyebrowAudit.ts` and scores the claim FINE. It
is the right string from the wrong producer, and confirming a premise you never looked at is this
queue's signature defect.

**SO THE VERDICT HERE IS DELIBERATELY ONE-SIDED AND THE FILE SAYS SO RATHER THAN IMPLYING MORE.**
This check can say "this predicted string no longer occurs in the repository at all", which is
defect 4 and is worth catching. It CANNOT say "this prediction is still the guard's" — that needs
each claim to declare its producer, which is a change to eight harnesses and is not this merge.
A one-sided instrument that names its side beats a two-sided one that is wrong on the other.

── THE CORPUS IS `git ls-files`, AND THAT IS NOT AN OPTIMISATION ────────────

The first cut walked the tree. `UNAUDITED  packages/ui#HoldBar is exported` then resolved its
longest fragment inside `packages/ui/.reach/91532.json` — a per-worker shard named after a PROCESS
ID — and `cannot find package` resolved inside `apps/web/.vitest-report.json`. Both are gitignored
outputs of a previous run. A prediction is a claim about the repository's COMMITTED source, and a
checker that reads whatever the last test run left on disk gives a different answer on a clean
checkout than on a developer's machine. Tracked files only, from git itself, so there is no
hand-kept exclusion list to go stale. (This repo has paid for the same shape before: a restore
check that hashed `apps/web/.reach/<pid>.json` could never pass.)
"""
import ast
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# ⚠ THE CENSUS MUST EXCLUDE CONTROLS WRITTEN FOR THIS CHECKER. The anchor check paid for this
# exactly once and recorded it: its glob is `w1*controls*.py`, so its own control script was
# counted as one of the harnesses it checks and pushed the census 74 → 75 — the instrument
# measuring itself, in the direction that looks like progress. `prediction-check` is the substring
# excluded here, so a control for this file must carry it in its name.
SELF = "prediction-check"

# ⚠ A FLOOR ON THE CENSUS, AS A LITERAL. Blind the glob and this file prints "harnesses: 0", no
# claims, no misses, and exits 0 — a clean bill of health from having read nothing.
MIN_HARNESSES = 70
# ⚠ AND A FLOOR ON THE CLAIMS, for the same reason one layer in: the extractor can break while the
# census stays whole, and then every claim is decided by not existing. 15 measured at `fa95b86`.
MIN_CLAIMS = 12

# A right-hand side this size is captured output rather than a path or a flag.
OUTISH = ("out", "stdout", "stderr", "output", "result", "res", "log", "text", "combined")

# ⚠ SHORTER THAN THIS IS NOT A PREDICTION ABOUT A MESSAGE. Chosen from the measured population,
# not invented: at 6 the set includes `Tests ` and `apps/web` — a vitest table header and a
# workspace name, which match trivially and say nothing about any guard. At 9 those two drop and
# `--- FAIL:` survives, which is a real claim about `go test`'s failure marker. The first cut of
# this file wrote 6 under a comment arguing for more, which is a rule whose own reasoning does not
# reach its value.
MIN_CLAIM = 9

# ⚠ STRINGS PRODUCED OUTSIDE THIS REPOSITORY, DECLARED WITH THEIR PRODUCER. Without this they are
# permanent reds: no file here prints them and none ever will.
# ⚠⚠ AND THE DECLARATION IS SELF-POLICING — see `stale_externals` below. An entry that DOES occur
# in the tree is refused, because then it is decidable and this list is excusing it. An exclusion
# nobody re-checks is how a guard's population quietly shrinks.
EXTERNAL = {
    "[build failed]": "the Go toolchain — `go test` prints it for a package that will not compile",
    "cannot find package": "the Go toolchain — `go test` prints it when a dependency is missing",
}

# ⚠ PREDICTIONS THE GUARD ASSEMBLES WITH AN INTERPOLATION, so the whole sentence occurs nowhere.
# Each names the guard AND the fixed fragments that must still be in it — never a heuristic run,
# for the reason in the header. Both halves are policed below:
#   · every declared fragment must be present IN THE NAMED FILE (a rename reds here)
#   · the whole literal must NOT be present anywhere (or it is decidable and this is excusing it)
INTERPOLATED = {
    "UNAUDITED  packages/ui#HoldBar is exported": (
        "apps/web/scripts/check-audit-reach.mjs",
        ["UNAUDITED  ", " is exported and NO apps/web test renders it"],
    ),
    "CARD_HEADER_CENSUS says 3": (
        "apps/web/src/CardHeaderHeading.test.tsx",
        ["CARD_HEADER_CENSUS says "],
    ),
}


def tracked_corpus(exclude: set[str]) -> dict[str, str]:
    """Every file git tracks except the harnesses themselves, read once.

    ⚠⚠ AND THE SAME TRAP CAUGHT THIS FILE A SECOND TIME, ONE COMMIT LATER — THIS FILE'S OWN
    SOURCE. Every literal in EXTERNAL and INTERPOLATED occurs, by construction, in the
    declaration that excuses it. While these scripts were untracked `git ls-files` hid that;
    the moment they were COMMITTED both self-policing rules fired, reporting all four
    declarations as "occurs verbatim in the tree, so this declaration is excusing it". They
    were excusing nothing but themselves. MEASURED by running from a clean checkout of the
    commit rather than from the working tree — the same discipline this file applies to the
    anchor check, applied to it. A declaration is not evidence for itself.

    ⚠ EXCLUDING THE HARNESSES IS NOT TIDINESS — IT IS THE DIFFERENCE BETWEEN A CHECK AND A
    TAUTOLOGY, and this file's own self-policing rule is what caught it. A prediction literal
    occurs, by construction, in the harness that declares it. With the harnesses in the corpus
    every claim is satisfied BY ITSELF: the first run reported `[build failed]` as present in the
    tracked tree and flagged its own EXTERNAL declaration as stale, when the only file containing
    it was the harness asserting it. That is §D7 — a detector matching its own text — arriving
    through the corpus rather than through comments. A claim is a claim about a GUARD; the
    claimant is not evidence.
    """
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, text=True)
    corpus = {}
    for rel in out.stdout.split("\0"):
        if not rel or rel in exclude:
            continue
        p = ROOT / rel
        try:
            corpus[rel] = p.read_text(errors="ignore")
        except (OSError, UnicodeDecodeError):
            continue
    return corpus


def harnesses() -> list[pathlib.Path]:
    return [p for p in sorted(ROOT.rglob("w1*controls*.py")) if SELF not in p.name]


def claims(path: pathlib.Path) -> list[tuple[int, str]]:
    """String literals compared against captured output — `if "…" in out`.

    ⚠ FOUND BY USE, NOT BY FIELD NAME, and the header records why: the fields that LOOK like
    predictions (`expect=`, `catcher=`) are only ever printed, and the ones that are asserted sit
    beside them under other names.
    """
    found = []
    try:
        tree = ast.parse(path.read_text())
    except SyntaxError:
        return []
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Compare) and len(n.ops) == 1 and isinstance(n.ops[0], ast.In)):
            continue
        rhs = n.comparators[0]
        name = rhs.id if isinstance(rhs, ast.Name) else (rhs.attr if isinstance(rhs, ast.Attribute) else None)
        if not name or not any(k in name.lower() for k in OUTISH):
            continue
        lhs = n.left
        if isinstance(lhs, ast.Constant) and isinstance(lhs.value, str) and len(lhs.value) >= MIN_CLAIM:
            found.append((n.lineno, lhs.value))
    return found




def main() -> int:
    found = harnesses()
    # The claimants (harnesses) AND this checker with its controls — see tracked_corpus.
    blind = {h.relative_to(ROOT).as_posix() for h in found}
    blind |= {p.relative_to(ROOT).as_posix() for p in ROOT.rglob(f"*{SELF}*") if p.is_file()}
    corpus = tracked_corpus(blind)
    print(f"harnesses: {len(found)}   tracked files read: {len(corpus)}")

    if len(found) < MIN_HARNESSES:
        print(f"⚠ THE HARNESS CENSUS COLLAPSED: {len(found)} found, floor is {MIN_HARNESSES}.")
        return 1

    def holder(frag: str) -> str | None:
        for rel, text in corpus.items():
            if frag in text:
                return rel
        return None

    verbatim, interp, gone, external_hits = [], [], [], []
    broken_declarations = []
    total = 0
    for h in found:
        for lineno, literal in claims(h):
            total += 1
            rel = h.relative_to(ROOT).as_posix()
            if literal in EXTERNAL:
                external_hits.append((rel, lineno, literal))
                continue
            if literal in INTERPOLATED:
                guard, frags = INTERPOLATED[literal]
                text = corpus.get(guard)
                if text is None:
                    broken_declarations.append((literal, f"declared guard {guard} is not a tracked file"))
                else:
                    missing = [f for f in frags if f not in text]
                    if missing:
                        broken_declarations.append(
                            (literal, f"{guard} no longer contains {missing!r}"))
                if holder(literal):
                    broken_declarations.append(
                        (literal, "occurs verbatim in the tree, so it is decidable and this "
                                  "declaration is excusing it"))
                interp.append((rel, lineno, literal, guard))
                continue
            if holder(literal):
                verbatim.append((rel, lineno, literal, holder(literal)))
            else:
                gone.append((rel, lineno, literal))

    print(f"predictions asserted against captured output: {total}")
    print(f"  present verbatim in a tracked file: {len(verbatim)}")
    print(f"  declared interpolated, fixed fragments verified in the named guard: {len(interp)}")
    print(f"  declared as produced outside this repository: {len(external_hits)}")

    for rel, lineno, literal, guard in interp:
        print(f"    INTERPOLATED  {rel}:{lineno}  {literal!r}")
        print(f"                  fixed fragments verified in {guard}")

    # ⚠ THE EXCLUSION LIST POLICES ITSELF. A declared-external string that DOES occur in a tracked
    # file is not external any more, and leaving it declared silently removes a decidable claim
    # from the population.
    stale_externals = [(k, v) for k, v in EXTERNAL.items() if any(k in t for t in corpus.values())]

    rc = 0
    if broken_declarations:
        rc = 1
        print()
        print(f"⚠ {len(broken_declarations)} INTERPOLATED DECLARATION(S) NO LONGER HOLD.")
        print("  Each names a guard and the fixed fragments of a message it assembles. A")
        print("  declaration that has stopped being true is an escape hatch with nothing behind")
        print("  it — the prediction it excuses is unpoliced from here on.")
        for literal, why in broken_declarations:
            print(f"    {literal!r} — {why}")

    if gone:
        rc = 1
        print()
        print(f"⚠ {len(gone)} PREDICTION(S) NO LONGER OCCUR ANYWHERE IN THE TRACKED TREE.")
        print("  Each is a string a control asserts some guard prints. If the guard's message")
        print("  moved, that control now scores NOT CAUGHT against a guard that is firing — the")
        print("  direction W1.1.21d marks as dangerous, because a working guard that looks broken")
        print("  is a guard somebody deletes. Either re-anchor the prediction on what the guard")
        print("  says now, declare its producer in EXTERNAL with the tool named, or — if the")
        print("  guard assembles it — declare it in INTERPOLATED with the fixed fragments.")
        for rel, lineno, literal in gone:
            print(f"    {rel}:{lineno}  {literal!r}")

    if stale_externals:
        rc = 1
        print()
        print(f"⚠ {len(stale_externals)} DECLARED-EXTERNAL STRING(S) ARE IN THE TRACKED TREE.")
        print("  Declared as produced outside this repo, and a tracked file contains it — so it is")
        print("  decidable and this list is excusing it from the population.")
        for k, why in stale_externals:
            print(f"    {k!r} — declared as: {why}")

    if total < MIN_CLAIMS:
        rc = 1
        print()
        print(f"⚠ THE CLAIM EXTRACTOR COLLAPSED: {total} found, floor is {MIN_CLAIMS}. The census")
        print("  is whole, so this is the extractor and not the harnesses — every prediction would")
        print("  otherwise be decided by not existing.")

    if rc == 0:
        print()
        print("every asserted prediction is decided: present verbatim, or declared (external /")
        print("interpolated) with the declaration itself re-verified on this run.")
        print("⚠ THAT IS A ONE-SIDED VERDICT AND IT IS THE ONLY ONE THIS FILE CLAIMS: a string")
        print("  being present does NOT prove the guard under test is what prints it. See the")
        print("  header — `build failed` is asserted of `go test` and also occurs in a TypeScript")
        print("  audit. Attribution needs each claim to name its producer, which is not built.")
    return rc


if __name__ == "__main__":
    sys.exit(main())
