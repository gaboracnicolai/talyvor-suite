#!/usr/bin/env python3
"""W1.1.13 — POSITIVE CONTROLS ON THE LANDMARK-ID SWEEP.

`landmarkIds.test.tsx` has two halves and they need different controls.

The PREDICATE half (`idProblems`) is controlled inside the test file itself — C1..C5 there feed it
duplicated ids, dangling references and correct multi-token markup, in-process.

This harness controls the OTHER half: the repo-wide SWEEP that drives the real `<App/>` to all 17
addresses. That sweep found ZERO problems on its first run, which is exactly the shape the standard
says to distrust: it passes today because the product is right, and it would pass identically if it
had stopped rendering anything. So each control below breaks the REAL PRODUCT — a real component,
the way a real screen rebuild would break it — and requires the sweep to say so.

It runs on a COPY. The working tree is never written to; the copy is removed on every exit path.

EVERY PREDICTION IS WRITTEN IN `expect` BELOW, BEFORE THE RUN.

Usage: python3 scripts/w1113-landmark-id-controls-7q4m.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTFILE = "src/landmarkIds.test.tsx"


@dataclass
class Control:
    name: str
    why: str
    #: repo-relative file -> (needle, replacement); the needle must appear EXACTLY once
    edits: list[tuple[str, str, str]]
    expect_red: list[str] = field(default_factory=list)
    expect_green: list[str] = field(default_factory=list)


REGION = "apps/web/src/components/Region.tsx"
MEMBERS = "apps/web/src/areas/lens/Members.tsx"
KEYS = "apps/web/src/areas/lens/Keys.tsx"

CONTROLS: list[Control] = [
    Control(
        name="S1 the fix is reverted — Region derives its id from the index again",
        why=(
            "The exact pre-W1.1.13 component. On its own this is still LATENT (every index in the "
            "product is unique), so the sweep must stay GREEN — and the Region cases must go RED. "
            "If the sweep reddened here it would be reporting something other than a collision."
        ),
        edits=[
            (
                REGION,
                "  const uid = useId().replace(/:/g, '')\n"
                "  const labelId = `region-${uid}-label`\n"
                "  const headingId = `region-${uid}-heading`",
                "  const labelId = `region-${index}-label`\n"
                "  const headingId = `region-${index}-heading`",
            )
        ],
        expect_red=[
            "two regions with the SAME index still get different ids",
            "and each one keeps its OWN accessible name",
        ],
        expect_green=["every address renders unique ids and no dangling reference"],
    ),
    Control(
        name="S2 the fix reverted AND a real screen reuses an index — the live defect",
        why=(
            "This is the whole failure, assembled: the old component plus the mistake a screen "
            "rebuild makes. /members would render two sections both named 'Members'. The SWEEP is "
            "the only thing that can see it, and this is the case that proves the sweep works "
            "against the real product rather than only against its own fixtures."
        ),
        edits=[
            (
                REGION,
                "  const uid = useId().replace(/:/g, '')\n"
                "  const labelId = `region-${uid}-label`\n"
                "  const headingId = `region-${uid}-heading`",
                "  const labelId = `region-${index}-label`\n"
                "  const headingId = `region-${index}-heading`",
            ),
            (MEMBERS, '<Region index="01" label="Who is in this workspace">', '<Region index="00" label="Who is in this workspace">'),
        ],
        expect_red=["every address renders unique ids and no dangling reference"],
        expect_green=[],
    ),
    Control(
        name="S3 a duplicate index on a DIFFERENT screen, so the sweep is not members-shaped",
        why=(
            "A sweep that happened to be looking only where its author looked would pass this. "
            "/keys is a different area, rebuilt by a different tab under W1.1.5."
        ),
        edits=[
            (
                REGION,
                "  const uid = useId().replace(/:/g, '')\n"
                "  const labelId = `region-${uid}-label`\n"
                "  const headingId = `region-${uid}-heading`",
                "  const labelId = `region-${index}-label`\n"
                "  const headingId = `region-${index}-heading`",
            ),
            (KEYS, '<Region index="02" label="The keys that exist">', '<Region index="01" label="The keys that exist">'),
        ],
        expect_red=["every address renders unique ids and no dangling reference"],
        expect_green=[],
    ),
    Control(
        name="S4 a dangling aria-labelledby on a real screen",
        why=(
            "The other failure an id can have, introduced into real product markup rather than a "
            "fixture: a landmark pointing at a name nothing renders. A screen reader announces an "
            "unnamed region and the page looks identical."
        ),
        edits=[
            (
                REGION,
                "      aria-labelledby={heading ? headingId : labelId}",
                "      aria-labelledby={heading ? headingId : labelId + '-gone'}",
            )
        ],
        expect_red=["every address renders unique ids and no dangling reference"],
        expect_green=[],
    ),
    Control(
        name="S5 the sweep stops rendering — the vacuity the floor exists for",
        why=(
            "The failure mode a problem-list assertion CANNOT see: an empty problem list from an "
            "empty document reads exactly like a correct product. Only the floor can catch it, and "
            "an uncontrolled floor is a number somebody guessed."
        ),
        edits=[
            (
                "apps/web/src/landmarkIds.test.tsx",
                "        idsSeen += document.querySelectorAll('[id]').length",
                "        idsSeen += 0 * document.querySelectorAll('[id]').length",
            )
        ],
        expect_red=["every address renders unique ids and no dangling reference"],
        expect_green=["C1 a duplicated id is reported, and named"],
    ),
]


def run_tests(tree: str) -> dict[str, str]:
    out = os.path.join(tree, "w1113-report.json")
    subprocess.run(
        ["npx", "vitest", "run", TESTFILE, "--reporter=json", f"--outputFile={out}"],
        cwd=os.path.join(tree, "apps", "web"),
        capture_output=True,
        text=True,
    )
    if not os.path.exists(out):
        return {}
    with open(out) as fh:
        report = json.load(fh)
    results: dict[str, str] = {}
    for suite in report.get("testResults", []):
        for case in suite.get("assertionResults", []):
            results[case.get("fullName", "")] = case.get("status", "?")
    return results


def status_of(results: dict[str, str], needle: str) -> str | None:
    hits = [s for name, s in results.items() if needle in name]
    if not hits:
        return None
    return "failed" if any(h == "failed" for h in hits) else hits[0]


def main() -> int:
    scratch = tempfile.mkdtemp(prefix="w1113-controls-")
    tree = os.path.join(scratch, "suite")
    failures: list[str] = []
    try:
        print(f"copying the worktree to {tree} (the real one is never written to)…", flush=True)
        subprocess.run(["rsync", "-a", "--exclude", ".git", REPO + "/", tree + "/"], check=True)

        originals = {
            path: open(os.path.join(tree, path)).read()
            for path in {e[0] for c in CONTROLS for e in c.edits}
        }

        baseline = run_tests(tree)
        n_pass = sum(1 for s in baseline.values() if s == "passed")
        print(f"\nBASELINE on the copy: {n_pass}/{len(baseline)} passed")
        if not baseline or n_pass != len(baseline):
            print("!! baseline not green on the copy — every verdict below would be noise")
            return 2

        for c in CONTROLS:
            ok_to_run = True
            for path, needle, replacement in c.edits:
                src = originals[path]
                if src.count(needle) != 1:
                    print(f"\n{c.name}\n  !! needle appears {src.count(needle)}× in {path}")
                    failures.append(f"{c.name}: needle not unique in {path}")
                    ok_to_run = False
                    break
                with open(os.path.join(tree, path), "w") as fh:
                    fh.write(src.replace(needle, replacement, 1))
            if not ok_to_run:
                for path, src in originals.items():
                    with open(os.path.join(tree, path), "w") as fh:
                        fh.write(src)
                continue

            results = run_tests(tree)
            print(f"\n{c.name}\n  {c.why}")
            if not results:
                print("  !! no report (the mutation probably does not compile)")
                failures.append(f"{c.name}: no report")
            else:
                for n in c.expect_red:
                    got = status_of(results, n)
                    good = got == "failed"
                    print(f"  {'RED  ✓' if good else 'GREEN ✗'}  expect RED   … {n!r} -> {got}")
                    if not good:
                        failures.append(f"{c.name}: {n!r} stayed {got}")
                for n in c.expect_green:
                    got = status_of(results, n)
                    good = got == "passed"
                    print(f"  {'GREEN ✓' if good else 'RED  ✗'}  expect GREEN … {n!r} -> {got}")
                    if not good:
                        failures.append(f"{c.name}: {n!r} went {got}, mutation not targeted")

            for path, src in originals.items():
                with open(os.path.join(tree, path), "w") as fh:
                    fh.write(src)

        print("\n" + "=" * 72)
        if failures:
            print(f"{len(failures)} CONTROL FAILURE(S):")
            for f in failures:
                print("  - " + f)
            return 1
        print(f"ALL {len(CONTROLS)} CONTROLS MATCHED THEIR PREDICTIONS.")
        return 0
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
        print(f"(scratch {scratch} removed)")


if __name__ == "__main__":
    sys.exit(main())
