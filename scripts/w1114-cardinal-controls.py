#!/usr/bin/env python3
"""Positive controls for apps/bff/env_cardinal_test.go (suite W1.1.14).

The guard asserts that every `set <cardinal> (<VARS>)` clause in the BFF's config refusals states
a cardinal that MATCHES the list beside it, in two populations — the message an operator actually
receives (behavioural) and every clause in this package's sources (textual) — and that neither
population contains a site the other misses.

A message guard is the easiest kind to write vacuously. It passes whether it parsed the real
message, a substring of it, or nothing at all; and three of its four tests are GREEN at the merge
commit, which means three of them have never been observed to fail. So each assertion gets its own
mutation:

  · the CARDINAL check      (C1, C2)  — does it red on the shipped defect, and on the arm that is
                                        CORRECT today, so the passing arm is not passing by luck?
  · the REFUSED-VAR check   (C3)      — green at merge; the ONLY evidence it can fail is C3.
  · the READS check         (C4)      — does it notice a variable the binary never reads?
  · going INERT             (C5)      — does a reworded message that drops the clause FAIL rather
                                        than quietly parse to nothing?
  · the SOURCE half         (C6, C7)  — is the floor real, and does the textual population truly
                                        cover a site no behavioural arm drives?
  · population DRIFT        (C8)      — a clause that exists at runtime and not in source
  · the SCAN itself         (C9)      — does an empty file scan FAIL rather than pass vacuously?

Verdict is predicted BEFORE the run: for each control, which test names must fail and which
message must appear. A control that fails "somehow" is not a control — it has to fail for the
reason it was written for, so every expectation below is a substring of the required output.

C0 is the must-stay-green: the tree exactly as it will be merged.

⚠ RUN FROM apps/bff, WHERE go.mod IS — the same trap w11-env-documented-controls.py records: a
`go test` from the repo root prints "cannot find main module", matches no expectation, and scores
as a clean run. This harness asserts the C0 baseline is GREEN before trusting any red, which is
what makes that failure visible instead of silent.

Usage: python3 scripts/w1114-cardinal-controls.py [--only C5]
"""

import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BFF = os.path.join(REPO, "apps", "bff")
MAIN = "apps/bff/main.go"
GUARD = "apps/bff/env_cardinal_test.go"
OPERATOR = "apps/bff/operator.go"
TOUCHED = [MAIN, GUARD, OPERATOR]

TESTS = (
    "TestPartialUpstreamRefusalStatesTheRightCardinal|"
    "TestPartialUpstreamRefusalNamesNoRefusedVariable|"
    "TestEverySetClauseInSourceIsConsistentAndCovered|"
    "TestSetClauseParserControls"
)
TEST_CMD = ["go", "test", "-count=1", "-run", TESTS, "."]

# The shipped (repaired) Track clause, as it must read at the merge commit.
TRACK_OK = '"Track upstream partially configured: missing %s — set both "+\n\t\t\t\t"(TRACK_BASE_URL, TRACK_GATEWAY_SECRET), or none"'


def read(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8") as fh:
        return fh.read()


def write(rel, text):
    with open(os.path.join(REPO, rel), "w", encoding="utf-8") as fh:
        fh.write(text)


def sub_once(rel, old, new):
    """Replace exactly once, or abort. A mutation that silently matched nothing produces a
    control that 'passed' while changing no code — the exact shape this file exists to rule out."""
    text = read(rel)
    if text.count(old) != 1:
        raise SystemExit(f"MUTATION ANCHOR NOT UNIQUE in {rel}: {text.count(old)} matches for {old!r}")
    write(rel, text.replace(old, new, 1))


def run_tests():
    proc = subprocess.run(TEST_CMD, cwd=BFF, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


# Each control: (id, description, mutate(), must_fail_substrings, must_be_green)
CONTROLS = []


def control(cid, desc, expect, green=False):
    def deco(fn):
        CONTROLS.append((cid, desc, fn, expect, green))
        return fn

    return deco


@control("C0", "no mutation — the tree as it will be merged", [], green=True)
def c0():
    pass


@control(
    "C1",
    "restore the shipped defect: 'set both' back to 'set all three' above two names",
    [
        'THE CARDINAL AND THE LIST DISAGREE: "all three" claims 3, the list names 2',
        'SOURCE CLAUSE DISAGREES WITH ITSELF: "all three" claims 3, lists 2',
        "--- FAIL: TestPartialUpstreamRefusalStatesTheRightCardinal",
        "--- FAIL: TestEverySetClauseInSourceIsConsistentAndCovered",
    ],
)
def c1():
    sub_once(MAIN, "Track upstream partially configured: missing %s — set both ", "Track upstream partially configured: missing %s — set all three ")


@control(
    "C2",
    "break the arm that is CORRECT today: add a third name under the Docs 'both'",
    [
        'THE CARDINAL AND THE LIST DISAGREE: "both" claims 2, the list names 3',
        "--- FAIL: TestPartialUpstreamRefusalStatesTheRightCardinal/Docs_upstream",
    ],
)
def c2():
    sub_once(MAIN, "(DOCS_BASE_URL, DOCS_GATEWAY_SECRET), or neither", "(DOCS_BASE_URL, DOCS_GATEWAY_SECRET, DOCS_WORKSPACE_ID), or neither")


@control(
    "C3",
    "send the operator to the boot refusal: name TRACK_WORKSPACE_ID in the Track message",
    [
        'names "TRACK_WORKSPACE_ID", which main.go REFUSES TO BOOT WITH',
        "--- FAIL: TestPartialUpstreamRefusalNamesNoRefusedVariable",
    ],
)
def c3():
    sub_once(MAIN, "(TRACK_BASE_URL, TRACK_GATEWAY_SECRET), or none", "(TRACK_BASE_URL, TRACK_GATEWAY_SECRET), or none — and unset TRACK_WORKSPACE_ID")


@control(
    "C4",
    "offer a variable the binary never reads, with the cardinal still correct",
    [
        'offers "TRACK_GATEWAY_TOKEN", which this binary never reads',
        "--- FAIL: TestPartialUpstreamRefusalStatesTheRightCardinal/Track_upstream",
    ],
)
def c4():
    sub_once(MAIN, "(TRACK_BASE_URL, TRACK_GATEWAY_SECRET), or none", "(TRACK_BASE_URL, TRACK_GATEWAY_TOKEN), or none")


@control(
    "C5",
    "reword the Track refusal so it states NO cardinal and NO list — the inert path",
    [
        "refusal states no parseable `set <cardinal> (<VARS>)` clause",
        "--- FAIL: TestPartialUpstreamRefusalStatesTheRightCardinal/Track_upstream",
    ],
)
def c5():
    sub_once(MAIN, TRACK_OK, '"Track upstream partially configured: missing %s"')


@control(
    "C6",
    "blind the source scanner's regex — the floor must fire, and must not be the only thing that does",
    [
        "clauses in this package's sources; at least 2",
        "--- FAIL: TestEverySetClauseInSourceIsConsistentAndCovered",
    ],
)
def c6():
    sub_once(
        GUARD,
        "var setClauseRE = regexp.MustCompile(`set ((?:all )?[a-z]+) \\(([A-Z0-9_]+(?:, ?[A-Z0-9_]+)*)\\)`)",
        "var setClauseRE = regexp.MustCompile(`zzz_no_such_clause_zzz ((?:all )?[a-z]+) \\(([A-Z0-9_]+(?:, ?[A-Z0-9_]+)*)\\)`)",
    )


@control(
    "C7",
    "add a THIRD clause, stale cardinal, in a file no behavioural arm drives",
    [
        'SOURCE CLAUSE DISAGREES WITH ITSELF: "all three" claims 3, lists 2',
        "that NO arm in productArms drives",
        "--- FAIL: TestEverySetClauseInSourceIsConsistentAndCovered",
    ],
)
def c7():
    text = read(OPERATOR)
    write(OPERATOR, text + '\n\nconst zzControlClause = "Operator upstream partially configured: set all three (OPERATOR_SUBS, OPERATOR_BASE_URL), or none"\n')


@control(
    "C8",
    "build the Track list at runtime so the clause exists in the MESSAGE and not in SOURCE",
    [
        "that the source scanner cannot see",
        "--- FAIL: TestEverySetClauseInSourceIsConsistentAndCovered",
    ],
)
def c8():
    sub_once(
        MAIN,
        TRACK_OK,
        '"Track upstream partially configured: missing %s — set both ("+\n\t\t\t\tstrings.Join([]string{"TRACK_BASE" + "_URL", "TRACK_GATEWAY" + "_SECRET"}, ", ")+"), or none"',
    )


@control(
    "C9",
    "make the file scan read nothing — it must FAIL, not pass on an empty corpus",
    [
        "non-test sources",
        "the scan is not running where it thinks it is",
    ],
)
def c9():
    sub_once(GUARD, 'files, err := filepath.Glob("*.go")', 'files, err := filepath.Glob("zz_no_such_file_*.go")')


def main():
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    originals = {rel: read(rel) for rel in TOUCHED}
    results = []
    try:
        for cid, desc, mutate, expect, green in CONTROLS:
            if only and cid != only:
                continue
            for rel, text in originals.items():
                write(rel, text)
            mutate()
            code, out = run_tests()
            if green:
                ok = code == 0
                detail = "GREEN" if ok else "NOT GREEN — baseline is broken, every red below is untrustworthy"
            else:
                missing = [e for e in expect if e not in out]
                ok = code != 0 and not missing
                if code == 0:
                    detail = "DID NOT FAIL — the assertion this control targets cannot fail"
                elif missing:
                    detail = "failed for the WRONG REASON; missing: " + " | ".join(repr(m) for m in missing)
                else:
                    detail = "red, for the predicted reason"
            results.append((cid, ok, desc, detail))
            print(f"[{'ok ' if ok else 'BAD'}] {cid}: {desc}\n        {detail}", flush=True)
    finally:
        for rel, text in originals.items():
            write(rel, text)

    bad = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(bad)}/{len(results)} controls behaved as predicted")
    if bad:
        for cid, _, desc, detail in bad:
            print(f"  ✗ {cid} {desc}: {detail}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
