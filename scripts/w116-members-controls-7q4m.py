#!/usr/bin/env python3
"""W1.1.6 — POSITIVE CONTROLS ON THE MEMBERS SCREEN'S GUARDS.

Nine of this screen's twenty cases were GREEN on their very first run against the OLD screen —
they passed because the thing they forbid was absent, not because anything enforced it. A guard
that has never been red for the right reason is a guard nobody has tested.

So each control MUTATES the shipped screen — one plausible mistake at a time, the mistake a
careless implementation would actually have made — and asserts the named case goes RED. It runs
on a COPY of the repo tree. The working tree is never written to; the copy is removed on every
exit path.

EVERY PREDICTION IS WRITTEN IN `expect` BELOW, BEFORE THE RUN.

Usage: python3 scripts/w116-members-controls-7q4m.py
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCREEN = "apps/web/src/areas/lens/Members.tsx"
TESTFILE = "src/areas/lens/Members.test.tsx"


@dataclass
class Control:
    name: str
    why: str
    #: (needle, replacement) applied to Members.tsx. The needle must appear EXACTLY once.
    edit: tuple[str, str]
    #: substrings of test names that MUST go red under this mutation
    expect_red: list[str] = field(default_factory=list)
    #: substrings of test names that MUST STAY GREEN (the mutation is targeted, not a wrecking ball)
    expect_green: list[str] = field(default_factory=list)


CONTROLS: list[Control] = [
    Control(
        name="C1 marking keyed on the ROLE instead of the session",
        why=(
            "The fixture's owner and its session are the SAME ROW, so a marking that read the role "
            "column would look perfect on the happy path. This is the mistake the three session "
            "controls exist for."
        ),
        edit=(
            "return sessionEmail !== null && m.email === sessionEmail",
            "return m.role === 'owner'",
        ),
        expect_red=[
            "a different session moves the marking",
            "no session identity, no row is marked",
            "a session email absent from the roster marks nothing",
            "a case-different email is not a match",
        ],
        expect_green=["marks exactly the row whose email is the session email"],
    ),
    Control(
        name="C2 the join case-folds",
        why=(
            "The obvious 'helpful' version. Track compares with SQL `=` on Postgres text, which is "
            "case-sensitive, so folding here marks a row the upstream did not match."
        ),
        edit=(
            "return sessionEmail !== null && m.email === sessionEmail",
            "return sessionEmail !== null && m.email.toLowerCase() === sessionEmail.toLowerCase()",
        ),
        expect_red=["a case-different email is not a match"],
        expect_green=[
            "marks exactly the row whose email is the session email",
            "a different session moves the marking",
        ],
    ),
    Control(
        name="C3 the provenance line renders unconditionally",
        why=(
            "The 'Live from …' bug: a provenance claim under a read that never served anything. "
            "Rendering it always is exactly how that shipped last time."
        ),
        edit=(
            '{served && roster.length > 0 ? (\n          <p data-testid="roster-provenance"',
            '{true ? (\n          <p data-testid="roster-provenance"',
        ),
        expect_red=["is absent when nothing was served"],
        expect_green=["does not claim a pinned workspace"],
    ),
    Control(
        name="C4 the contradiction copy is static markup",
        why=(
            "A branch that is always in the DOM makes its own test pass on text that is never "
            "conditional. The served-roster control is the only case that can see it."
        ),
        edit=("          ) : contradiction ? (\n", "          ) : true ? (\n"),
        expect_red=["a served roster shows none of the contradiction copy"],
        expect_green=["names what it means and that it should not happen"],
    ),
    Control(
        name="C5 the empty state goes back to the friendly lie",
        why=(
            "The whole point of the measurement: 'a person appears here when they are added to "
            "this workspace in Track' is calm copy for a state that means two things disagree."
        ),
        edit=(
            "Track answered, and listed nobody — including you. That should not be possible.",
            "No members in this workspace yet. A person appears here when they are added in Track.",
        ),
        expect_red=[
            "does not tell the reader to wait for someone to be added",
            "names what it means and that it should not happen",
        ],
        expect_green=["a served roster shows none of the contradiction copy"],
    ),
    Control(
        name="C6 the count loses the figure face",
        why=(
            "preset.ts §THE FIGURE FACE: every numeral renders there. A numeral in the body sans "
            "is the defect figureAudit was written for, and it is invisible to a text assertion."
        ),
        edit=(
            '<span data-testid="member-count" className="font-figure text-ink">',
            '<span data-testid="member-count" className="text-ink">',
        ),
        # ⚠ MY FIRST PREDICTION HERE WAS WRONG AND THE HARNESS CAUGHT IT. I expected this mutation
        # to be targeted — to red only the case that names the figure face. It reds EVERY case that
        # renders the count, because `src/test-setup.ts:304` runs figureAudit after every test in
        # the project and THROWS: "figure(s) rendered in the body sans — add font-figure … [quantity]
        # <span class="text-ink"> renders "2"". The rule is enforced repo-wide at render time, not by
        # the one assertion I wrote. Recorded rather than quietly adjusted: the corrected prediction
        # is stronger than the one I made, and the case that must STAY green is the 503, which is the
        # one state where the count does not render at all.
        expect_red=[
            "the count of people is a numeral on the figure face",
            "lists real members from /api/members",
        ],
        expect_green=['503 reads as "not configured on this deployment"'],
    ),
    Control(
        name="C7 a control this product does not have",
        why=(
            "The BFF proxies GET and nothing else. A button here is a sentence true of an "
            "intention over a product that cannot do it."
        ),
        edit=(
            "        <Card>\n          <CardHeader>Workspace members</CardHeader>",
            "        <Card>\n          <CardHeader>Workspace members</CardHeader>\n"
            "          <button type=\"button\">Invite someone</button>",
        ),
        expect_red=["renders no button at all"],
        expect_green=["says who CAN change it"],
    ),
    Control(
        name="C8 two regions share an index",
        why=(
            "Region derives aria-labelledby from the index, so a duplicate silently points two "
            "landmarks at one name. The screen still LOOKS right."
        ),
        edit=('<Region index="01" label="Who is in this workspace">', '<Region index="00" label="Who is in this workspace">'),
        expect_red=["is regions with one page-scale heading"],
        expect_green=["lists real members from /api/members"],
    ),
    Control(
        name="C9 the screen collapses back to one card",
        why=(
            "The regression this whole item exists to prevent: the region marking removed and the "
            "page-scale heading with it."
        ),
        edit=(
            "        heading={\n"
            "          unconfigured\n"
            "            ? HEADLINE_UNCONFIGURED\n"
            "            : failed\n"
            "              ? HEADLINE_FAILED\n"
            "              : contradiction\n"
            "                ? HEADLINE_CONTRADICTION\n"
            "                : HEADLINE\n"
            "        }\n",
            "",
        ),
        expect_red=["is regions with one page-scale heading"],
        expect_green=["lists real members from /api/members"],
    ),
    Control(
        name="C10 the 503 stops naming the next action",
        why=(
            "W1.1.6's own complaint about this screen: it 'names the absence without naming the "
            "next action'. Deleting the variables must be visible."
        ),
        edit=('<span className="font-mono text-caption text-ink">TRACK_BASE_URL</span>', "<span />"),
        expect_red=["names the next action"],
        expect_green=["503 reads as \"not configured on this deployment\""],
    ),
    Control(
        name="C11 a failed read keeps the roster's page-scale claim",
        why=(
            "The state this screen was in until the last edit: 'Everyone who can reach this "
            "workspace.' at page scale, above a card saying the list could not be loaded."
        ),
        edit=(
            "            : failed\n              ? HEADLINE_FAILED\n",
            "            : failed\n              ? HEADLINE\n",
        ),
        expect_red=["the page-scale heading describes the state"],
        expect_green=["a genuine failure is an error, never laundered"],
    ),
]


def run_tests(tree: str) -> dict[str, str]:
    """Run the Members suite in `tree`; return {test name: 'passed'|'failed'}."""
    out = os.path.join(tree, "w116-report.json")
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
    scratch = tempfile.mkdtemp(prefix="w116-controls-")
    tree = os.path.join(scratch, "suite")
    failures: list[str] = []
    try:
        print(f"copying the worktree to {tree} (the real one is never written to)…", flush=True)
        subprocess.run(
            ["rsync", "-a", "--exclude", ".git", REPO + "/", tree + "/"], check=True
        )
        original = open(os.path.join(tree, SCREEN)).read()

        baseline = run_tests(tree)
        n_pass = sum(1 for s in baseline.values() if s == "passed")
        print(f"\nBASELINE on the copy: {n_pass}/{len(baseline)} passed")
        if not baseline or n_pass != len(baseline):
            print("!! the baseline is not green on the copy — every verdict below would be noise")
            return 2

        for c in CONTROLS:
            needle, replacement = c.edit
            if original.count(needle) != 1:
                print(f"\n{c.name}\n  !! needle appears {original.count(needle)}× — control cannot be trusted")
                failures.append(f"{c.name}: needle not unique")
                continue
            with open(os.path.join(tree, SCREEN), "w") as fh:
                fh.write(original.replace(needle, replacement, 1))

            results = run_tests(tree)
            print(f"\n{c.name}\n  {c.why}")
            if not results:
                # A mutation that does not compile is not a control: it reds everything for a
                # reason unrelated to the rule under test.
                print("  !! the suite produced no report (the mutation probably does not compile)")
                failures.append(f"{c.name}: no report")
                continue

            for needle_name in c.expect_red:
                got = status_of(results, needle_name)
                ok = got == "failed"
                print(f"  {'RED  ✓' if ok else 'GREEN ✗'}  expect RED   … {needle_name!r} -> {got}")
                if not ok:
                    failures.append(f"{c.name}: {needle_name!r} stayed {got}")
            for needle_name in c.expect_green:
                got = status_of(results, needle_name)
                ok = got == "passed"
                print(f"  {'GREEN ✓' if ok else 'RED  ✗'}  expect GREEN … {needle_name!r} -> {got}")
                if not ok:
                    failures.append(f"{c.name}: {needle_name!r} went {got}, mutation not targeted")

            with open(os.path.join(tree, SCREEN), "w") as fh:
                fh.write(original)

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
