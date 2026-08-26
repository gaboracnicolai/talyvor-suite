#!/usr/bin/env python3
"""
POSITIVE CONTROLS for W1.1.9a's space-view rebuild — tab-m3w8.

WHY. This screen's mistake is not its sibling's. The space LIST can confuse an empty workspace with
a broken one; the space VIEW cannot — you arrived from a list that answered, so the space exists. What
IT gets wrong is WHOSE space it says you are in: the title was `space?.name ?? spaceId`, and that
fallback is reached on every ordinary arrival where the spaces read has not answered — a reload, a
shared link, a new tab, a failing spaces read. `spaceCrumbLabel` exists for exactly that and is pinned
for the BREADCRUMB; the card header two lines below printed the id, and the rebuild puts it in the
largest type the console has.

⚠ C1 AND C2 ARE THE PAIR THAT MATTERS AND NEITHER IS SUFFICIENT. C1 restores the raw-id fallback, so
the heading must go back to reading `sp-eng`. C2 makes the fallback fire ALWAYS, so a space whose name
IS known is titled "This space" — a screen that never shows a raw id because it never shows a name.
An assertion that only catches C1 is asserting "not the id" rather than "the name".

⚠ C5 IS THE ONE I EXPECTED TO BE UNNECESSARY. The title on this screen deliberately does NOT carry
state — a failed page read says nothing about which space you are in — so C5 breaks the page read and
requires the title to keep naming the space. Without it, "the title is not a state claim" is a
sentence in a comment rather than a property of the screen.

⚠ C6 IS THE NEGATIVE CONTROL. Verdicts are read from per-test status in vitest's JSON report, never
from the process exit code — see w118-issuedetail-controls-m3w8.py for the run where that distinction
turned two "SUSPECT" verdicts into an artefact of the harness.

Convention as w117-issuelist-controls-q4vn.py.
"""

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web"
VIEW = REPO / "apps/web/src/areas/docs/SpaceView.tsx"
COMPONENTS = REPO / "apps/web/src/areas/docs/components.tsx"

F = "src/areas/docs/DocsArea.test.tsx"
T_REGIONS = (F, "is three named regions")
T_PAGE = (F, "makes exactly one page-scale claim, and it is the space")
T_RAWID = (F, "never writes a raw id as the title")
T_EMPTY = (F, "an EMPTY space says so")
T_FAULT = (F, "a FAULT on the page read is not an empty space")
T_OFF = (F, "an unconfigured Docs upstream reads as off, with no invented pages")
T_BACK = (F, "keeps the way back to spaces")
T_READS = (F, "a configured upstream READS the space, and an empty one is an empty space")

REPORT = Path(tempfile.gettempdir()) / "w119a-controls-report.json"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_file() -> dict:
    """Every test in the file by name, with THAT test's status — never the process exit code."""
    if REPORT.exists():
        REPORT.unlink()
    subprocess.run(
        ["npx", "vitest", "run", F, "--reporter=json", f"--outputFile={REPORT}"],
        cwd=WEB, capture_output=True, text=True,
    )
    if not REPORT.exists():
        return {}
    data = json.loads(REPORT.read_text(encoding="utf-8"))
    return {
        a["fullName"]: a["status"]
        for r in data.get("testResults", [])
        for a in r.get("assertionResults", [])
    }


def passed(results: dict, target) -> bool:
    _, name = target
    hits = [st for full, st in results.items() if name in full]
    assert hits, f"no test matches {name!r} — the control names a test that is not there"
    return all(st == "passed" for st in hits)


def _apply(cid, old, new, expect_count, path=None):
    path = path or VIEW
    src = path.read_text(encoding="utf-8")
    n = src.count(old)
    if n != expect_count:
        print(f"  {cid}  ✗ ANCHOR DEAD — {path.name} holds it {n}×, expected {expect_count}")
        return None, None, None
    before = sha(path)
    path.write_text(src.replace(old, new, expect_count), encoding="utf-8")
    if sha(path) == before:
        print(f"  {cid}  ✗ THE WRITE CHANGED NOTHING")
        path.write_text(src, encoding="utf-8")
        return None, None, None
    return src, before, path


def control(cid, desc, old, new, must_red, must_green, expect_count=1, path=None):
    src, before, path = _apply(cid, old, new, expect_count, path)
    if src is None:
        return False
    try:
        results = run_file()
        red = not passed(results, must_red)
        green = passed(results, must_green)
    finally:
        path.write_text(src, encoding="utf-8")
        assert sha(path) == before, f"{cid}: RESTORE FAILED"
    verdict, ok = (
        ("CAUGHT", True) if red and green
        else ("SUSPECT (companion also red — breaks the screen, does not probe)", False) if red
        else ("NOT CAUGHT ⚠ THE TEST IS BLIND TO THIS", False)
    )
    print(f"  {cid}  {verdict}\n      {desc}")
    print(f"      must-red   {must_red[1]!r} → {'RED' if red else 'GREEN'}")
    print(f"      must-green {must_green[1]!r} → {'GREEN' if green else 'RED'}")
    return ok


def negative(cid, desc, old, new, targets, expect_count=1, path=None):
    """A change that is NOT a defect. Every target must stay green, or the reds above are noise."""
    src, before, path = _apply(cid, old, new, expect_count, path)
    if src is None:
        return False
    try:
        r = run_file()
        results = {t[1]: passed(r, t) for t in targets}
    finally:
        path.write_text(src, encoding="utf-8")
        assert sha(path) == before, f"{cid}: RESTORE FAILED"
    ok = all(results.values())
    print(f"  {cid}  {'CORRECTLY SILENT' if ok else '✗ FIRED ON A NON-DEFECT'}\n      {desc}")
    for name, g in results.items():
        print(f"      must-green {name!r} → {'GREEN' if g else 'RED'}")
    return ok


def main():
    print("W1.1.9a — SPACE-VIEW REBUILD POSITIVE CONTROLS (tab-m3w8)\n")
    r = []

    r.append(control(
        "C1", "⚠ the raw-id fallback comes back — the exact string `spaceCrumbLabel` exists to keep "
              "out of the breadcrumb, now at 38px as the screen's title",
        "        heading={spaceTitle(space?.name)}\n        sectionClassName=",
        "        heading={space?.name ?? spaceId}\n        sectionClassName=",
        must_red=T_RAWID, must_green=T_BACK))

    r.append(control(
        "C2", "⚠ THE MIRROR: the fallback fires ALWAYS, so a space whose name IS known is titled "
              "\"This space\" — no raw id ever, and no name either",
        "export function spaceTitle(name: string | undefined): string {\n  const trimmed = name?.trim()",
        "export function spaceTitle(name: string | undefined): string {\n  const trimmed = undefined as string | undefined\n  void name",
        must_red=T_PAGE, must_green=T_RAWID, path=COMPONENTS))

    r.append(control(
        "C3", "the opening region loses its page-scale heading — the console's one display step "
              "goes back to being a token nothing on this screen wears",
        "        label=\"Space\"\n        heading={spaceTitle(space?.name)}\n        sectionClassName=\"pb-10 pt-4 wide:pb-12\"\n        className=\"max-w-none\"",
        "        label=\"Space\"\n        sectionClassName=\"pb-10 pt-4 wide:pb-12\"\n        className=\"max-w-none\"",
        must_red=T_PAGE, must_green=T_REGIONS))

    r.append(control(
        "C4", "a region's eyebrow drifts back to the card title it replaced — 'Pages' names the "
              "widget, 'What is in it' names the question the region answers",
        "<Region index=\"01\" label=\"What is in it\">",
        "<Region index=\"01\" label=\"Pages\">",
        # ⚠ TWO CALL SITES, AND MUTATING ONLY ONE WOULD BE A WEAKER CONTROL THAN IT LOOKS: the
        # unconfigured early return builds the same two regions, so a screen whose eyebrows drifted
        # would drift in both places. The anchor count is asserted, so a future third site fails
        # this control loudly rather than leaving it probing a subset.
        expect_count=2,
        must_red=T_REGIONS, must_green=T_PAGE))

    r.append(control(
        "C5", "⚠ THE TITLE STARTS CARRYING STATE — the sibling screen's rule copied onto a screen "
              "whose subject is not the read, so a broken page list renames the space you are in",
        "        heading={spaceTitle(space?.name)}\n        sectionClassName=\"pb-10 pt-4 wide:pb-12\"\n        className=\"max-w-none\"\n      >\n        {wayBack}\n        {/* ⚠ THE OPENING REGION",
        "        heading={pages.isError ? 'Docs can\u2019t be reached.' : spaceTitle(space?.name)}\n        sectionClassName=\"pb-10 pt-4 wide:pb-12\"\n        className=\"max-w-none\"\n      >\n        {wayBack}\n        {/* \u26a0 THE OPENING REGION",
        must_red=T_FAULT, must_green=T_PAGE))

    r.append(control(
        "C6", "the empty state's next action is DESCRIBED rather than performed — the button stays "
              "and no longer puts the caret in the field it names",
        "onClick={() => titleRef.current?.focus()}",
        "onClick={() => undefined}",
        must_red=T_EMPTY, must_green=T_REGIONS))

    r.append(negative(
        "C7", "NEGATIVE CONTROL — a wording tweak in a sentence no assertion reads. If this reds "
              "anything, the six verdicts above are 'an edit was made', not 'this defect was found'.",
        "              A page is anything worth writing down once and finding again — a runbook, a decision,\n              the thing you explain to every new person.",
        "              A page is anything worth writing down once and finding again — a runbook, a rota,\n              the thing you explain to every new person.",
        targets=[T_REGIONS, T_PAGE, T_RAWID, T_EMPTY, T_FAULT, T_OFF, T_BACK, T_READS]))

    print(f"\n{sum(r)}/{len(r)} controls behaved as predicted")
    return 0 if all(r) else 1


if __name__ == "__main__":
    sys.exit(main())
