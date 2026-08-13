#!/usr/bin/env python3
"""Positive controls for apps/bff/doc_subject_test.go.

    python3 scripts/w11-doc-subject-controls.py

The rule went RED on the source it was written against — one doc comment opening
`pathsFor` above a function named `pathsSince` — which is the right start and is
NOT sufficient. One red proves one instance; it says nothing about whether the
rule sees the SHAPE, and nothing at all about whether it fires on the innocent.
The run must end `caught 11  survived 0  falsered 0  invalid 0`.

WHY EACH CONTROL NAMES THE TEST IT EXPECTS TO RED. This file has two tests and
three census floors inside one of them. A control scored on "go test exited
non-zero" records a hole as covered whenever a floor happens to trip for an
unrelated reason. A control that reds the wrong test is MISATTRIBUTED here, and
that is a failure, not a pass.

WHY FOUR OF THE ELEVEN ASSERT THE GUARD STAYS GREEN. The first draft of the
population filter admitted ALL-CAPS words and produced NINE false reds ("THE",
"RULE", "EVERY", "NO", "WHY", "AND", "TWO") beside the one real defect — and
every one of those would have been "fixed" with an allowlist entry. G1-G4 inject
the innocent shapes and FAIL if the guard reports them. A guard is two claims: it
fires on the defect, and it does not fire on the innocent.

WHY THREE OF THEM MUTATE THE GUARD ITSELF. F1-F3 break the instrument rather
than the tree: a walk that reads nothing, a resolver that resolves everything, a
filter that filters nothing. Each is a way this file could go green while seeing
nothing at all, and each must be caught by a specific test — the floors and the
both-outcomes test exist for exactly these three and are otherwise unfalsifiable.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
BFF = REPO / "apps" / "bff"

GUARD = BFF / "doc_subject_test.go"
MAIN = BFF / "main.go"
TENANT = BFF / "tenant.go"
BOUNDARY = BFF / "tenant_boundary_test.go"

SWEEP = "TestDocCommentNamesItsSubject"
BOTH = "TestDocSubject_ClassifierSeesBothOutcomes"

# (id, mode, expected-test, description, [(file, old, new)])
#   mode "red"   — the guard must fail, and `expected-test` must be among the failures.
#   mode "green" — the guard must pass; a failure here is a FALSE RED.
CONTROLS = [
    # ── the defect shape, at every declaration kind the rule claims to cover ──────────
    ("C1", "red", SWEEP, "a test-file func doc left behind by a rename", [
        (BOUNDARY, "// pathsSince returns the upstream paths seen since the marker index.",
         "// pathsFrom returns the upstream paths seen since the marker index.")]),
    ("C2", "red", SWEEP, "a STRUCT FIELD doc left behind by a rename", [
        (MAIN, "// operatorSubs is the OPERATOR boundary",
         "// operatorAllow is the OPERATOR boundary")]),
    ("C3", "red", SWEEP, "a CONST doc left behind by a rename", [
        (TENANT, "// provisionPath is Lens's narrow provisioning route",
         "// provisionRoute is Lens's narrow provisioning route")]),
    ("C4", "red", SWEEP, "a TYPE doc left behind by a rename", [
        (TENANT, "// provisionResult is Lens's POST /v1/provision response.",
         "// provisionReply is Lens's POST /v1/provision response.")]),

    # ── the innocent shapes: the guard must not fire ──────────────────────────────────
    ("G1", "green", None, "an ALL-CAPS section opening is not a subject claim", [
        (TENANT, "// provisionPath is Lens's narrow provisioning route",
         "// THE ROUTE Lens exposes for narrow provisioning")]),
    ("G2", "green", None, "opening with a real SIBLING's name is allowed, and documented as allowed", [
        (TENANT, "// provisionPath is Lens's narrow provisioning route",
         "// provisionIdentity is what a caller pairs with the narrow provisioning route")]),
    ("G3", "green", None, "an ordinary prose opening is out of the population", [
        (TENANT, "// provisionPath is Lens's narrow provisioning route",
         "// returns Lens's narrow provisioning route")]),
    ("G4", "green", None, "a free-floating comment inside a function body is not a doc comment", [
        (TENANT, "func lensWorkspacePath(",
         "// pathsForNobody is not attached to any declaration and must not be swept.\nfunc lensWorkspacePath(")]),

    # ── the instrument itself: three ways this guard could pass while seeing nothing ──
    ("F1", "red", SWEEP, "THE WALK READS NOTHING — the census floors must fire", [
        (GUARD, 'ents, err := os.ReadDir(".")', 'ents, err := os.ReadDir("..")')]),
    ("F2", "red", BOTH, "THE RESOLVER RESOLVES EVERYTHING — the sweep would pass vacuously", [
        (GUARD, "func docSubjectResolves(word string, declared map[string]bool) bool { return declared[word] }",
         "func docSubjectResolves(word string, declared map[string]bool) bool { return true }")]),
    ("F3", "red", BOTH, "THE POPULATION FILTER FILTERS NOTHING — prose becomes a subject claim", [
        (GUARD, "return identifierShaped.MatchString(word) && hasLower.MatchString(word)",
         "return true")]),
]


def failed_tests(out: str) -> set:
    return set(re.findall(r"^\s*--- FAIL: (\S+)", out, re.M))


def main() -> int:
    files = {f for _, _, _, _, edits in CONTROLS for f, _, _ in edits}
    originals = {f: f.read_text(encoding="utf-8") for f in files}
    caught = misattributed = survived = falsered = invalid = 0

    try:
        for cid, mode, expect, desc, edits in CONTROLS:
            ok = True
            for f, old, _ in edits:
                n = originals[f].count(old)
                if n != 1:
                    print(f"{cid}: ANCHOR-MISS in {f.name} ({n}x) — {desc}")
                    ok = False
            if not ok:
                invalid += 1
                continue

            for f, old, new in edits:
                mutated = originals[f].replace(old, new, 1)
                if mutated == originals[f]:
                    print(f"{cid}: MUTATION INERT in {f.name} — {desc}")
                    ok = False
                f.write_text(mutated, encoding="utf-8")
            if not ok:
                invalid += 1
                for f, _, _ in edits:
                    f.write_text(originals[f], encoding="utf-8")
                continue

            run = subprocess.run(
                ["go", "test", "-count=1", "-run", f"{SWEEP}|{BOTH}", "."],
                cwd=str(BFF), capture_output=True, text=True)
            out = run.stdout + run.stderr
            fails = failed_tests(out)

            if "[build failed]" in out or "cannot find package" in out:
                invalid += 1
                print(f"{cid}: BUILD BROKE — the control measured nothing — {desc}")
            elif mode == "green":
                if run.returncode == 0:
                    caught += 1
                    print(f"{cid}: GREEN as required — {desc}")
                else:
                    falsered += 1
                    print(f"{cid}: *** FALSE RED — the guard fires on an innocent shape *** {sorted(fails)} — {desc}")
            elif run.returncode == 0:
                survived += 1
                print(f"{cid}: *** SURVIVED — the guard cannot see this *** — {desc}")
            elif expect in fails:
                caught += 1
                extra = sorted(x for x in fails if x != expect)
                print(f"{cid}: CAUGHT by {expect} — {desc}" + (f"  (+ also red: {extra})" if extra else ""))
            else:
                misattributed += 1
                print(f"{cid}: MISATTRIBUTED — expected {expect}, got {sorted(fails)} — {desc}")

            for f, _, _ in edits:
                f.write_text(originals[f], encoding="utf-8")
    finally:
        for f, src in originals.items():
            f.write_text(src, encoding="utf-8")

    # Restore is verified by READING THE BYTES BACK, never from the fact that a write returned.
    #
    # ⚠ IT IS DELIBERATELY NOT `git diff --quiet`. The first draft used that, and it reported
    # RESTORE FAILED on a run where every file had been restored perfectly — because the index was
    # older than the working tree, which is the normal state while writing the guard these
    # controls test. A restore check that fails for a reason having nothing to do with the restore
    # trains its reader to ignore it. sha256 of the bytes answers the question that was asked.
    for f, src in originals.items():
        back = f.read_text(encoding="utf-8")
        if back != src:
            print(f"*** RESTORE FAILED — {f.name} does not match the bytes read at start "
                  f"({hashlib.sha256(back.encode()).hexdigest()[:12]} != "
                  f"{hashlib.sha256(src.encode()).hexdigest()[:12]}) ***")
            invalid += 1

    print(f"\ncaught {caught}  misattributed {misattributed}  survived {survived}  "
          f"falsered {falsered}  invalid {invalid}  of {len(CONTROLS)}")
    return 0 if caught == len(CONTROLS) else 1


if __name__ == "__main__":
    sys.exit(main())
