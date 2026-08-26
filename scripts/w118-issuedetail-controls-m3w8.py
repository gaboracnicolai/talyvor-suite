#!/usr/bin/env python3
"""
POSITIVE CONTROLS for W1.1.8's four-headline rule and its region composition — tab-m3w8.

WHY. The rebuilt ticket makes a page-scale claim, which is the loudest place on the screen for its
FOUR states to collapse into each other — and collapsing them is exactly what the old screen did:
`if (!it)` printed "That issue could not be read." for a 404, a 500, a 503 and a dead session
alike. The eight assertions added to IssueDetail.test.tsx were RED before the rebuild (measured:
8/8), which is evidence they can fail at all. It is NOT evidence that each one discriminates the
thing it names, so each is put in front of a mutation that changes exactly that thing.

⚠ C1 AND C2 ARE THE PAIR THAT MATTERS, AND NEITHER IS SUFFICIENT ALONE. C1 makes the 404
discriminator never fire, so a missing issue reads as a fault; C2 makes it ALWAYS fire, so a fault
reads as a missing issue. A test suite that only catches C1 has an assertion that fires on "not the
fault sentence" rather than on the right sentence — which is how the old screen passed everything
it had while giving four causes one sentence.

⚠ C7 IS A NEGATIVE CONTROL AND IT IS THE ONE THAT EARNED ITS PLACE. Six mutations that all go red
prove nothing on their own if any edit to this file reds these tests, so C7 rewords one sentence
that four of its six targets never render and requires all six to stay GREEN. On the first run FOUR
WENT RED — and the cause was not the screen but this harness, which read the process exit code and
so could not tell "the test failed" from "the suite failed for another reason". C1 and C2 had been
reported SUSPECT on that basis. See `run_file`. Without C7 those two verdicts would have been read
as evidence about the product.

Convention as w117-issuelist-controls-q4vn.py: anchor count asserted before the write, bytes
verified changed, a MUST-RED target AND a MUST-STAY-GREEN companion, byte-identical sha256-verified
restore on every exit path. ⚠ ONE DEPARTURE, AND C7 IS WHY — see `run_file`: the verdict is read
from the per-test status in vitest's JSON report, never from the process exit code, because this
test file carries a file-level floor that reds the SUITE on any run that does not draw a price.
"""

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web"
DETAIL = REPO / "apps/web/src/areas/track/IssueDetail.tsx"

F = "src/areas/track/IssueDetail.test.tsx"
T_REGIONS = (F, "is six named regions")
T_PAGE = (F, "makes exactly one page-scale claim")
T_404 = (F, "a 404 says the issue is not here")
T_FAULT = (F, "a FAULT is not a missing issue")
T_OFF = (F, "an unconfigured Track reads as off")
T_401 = (F, "a dead credential says only that it is unavailable")
T_NODESC = (F, "an issue with no description offers the action that writes one")
T_THREAD_FAULT = (F, "does not claim the thread is empty when the read is refused")
T_THREAD_EMPTY = (F, "still invites the first comment when the thread is genuinely empty")
T_EDITING = (F, "MUST STAY GREEN — editing the issue you are on is not disturbed")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


REPORT = Path(tempfile.gettempdir()) / "w118-controls-report.json"


def run_file() -> dict:
    """
    Every test in the file, by name, with the status of THAT test.

    ⚠ IT RUNS THE WHOLE FILE AND READS PER-TEST STATUS, AND THE FIRST DRAFT DID NEITHER. It ran
    `vitest run <file> -t <name>` and read the EXIT CODE, which conflates "the named test failed"
    with "the suite failed for some other reason" — and this file has an other reason. It is listed
    in `test-setup.ts`'s `MUST_RENDER_CURRENCY` floor, so a run in which no test renders the AI cost
    throws at teardown:

        src/areas/track/IssueDetail.test.tsx audited NO currency figure.

    With `-t` filtering, that is EVERY single-test run of a state test — none of them draw a price.
    So the exit code was 1 whatever the mutation did, and C1 and C2 came back "SUSPECT (companion
    also red)" while the companion had in fact PASSED. ⚠ THIS WAS FOUND BY THE NEGATIVE CONTROL,
    NOT BY READING: C7 changes one sentence that four of its six targets never render, and four of
    them went red anyway. Without C7 the six reds above it would have been read as six catches, and
    two of them would have been the harness failing to run.
    """
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
    """True only if the named test RAN and passed. A name that matches nothing is not a pass."""
    _, name = target
    hits = [st for full, st in results.items() if name in full]
    assert hits, f"no test matches {name!r} — the control names a test that is not there"
    return all(st == "passed" for st in hits)


def _apply(cid, old, new, expect_count):
    src = DETAIL.read_text(encoding="utf-8")
    n = src.count(old)
    if n != expect_count:
        print(f"  {cid}  ✗ ANCHOR DEAD — IssueDetail.tsx holds it {n}×, expected {expect_count}")
        return None, None
    before = sha(DETAIL)
    DETAIL.write_text(src.replace(old, new, expect_count), encoding="utf-8")
    if sha(DETAIL) == before:
        print(f"  {cid}  ✗ THE WRITE CHANGED NOTHING")
        DETAIL.write_text(src, encoding="utf-8")
        return None, None
    return src, before


def control(cid, desc, old, new, must_red, must_green, expect_count=1):
    src, before = _apply(cid, old, new, expect_count)
    if src is None:
        return False
    try:
        results = run_file()
        red = not passed(results, must_red)
        green = passed(results, must_green)
    finally:
        DETAIL.write_text(src, encoding="utf-8")
        assert sha(DETAIL) == before, f"{cid}: RESTORE FAILED"
    verdict, ok = (
        ("CAUGHT", True) if red and green
        else ("SUSPECT (companion also red — breaks the screen, does not probe)", False) if red
        else ("NOT CAUGHT ⚠ THE TEST IS BLIND TO THIS", False)
    )
    print(f"  {cid}  {verdict}\n      {desc}")
    print(f"      must-red   {must_red[1]!r} → {'RED' if red else 'GREEN'}")
    print(f"      must-green {must_green[1]!r} → {'GREEN' if green else 'RED'}")
    return ok


def negative(cid, desc, old, new, targets, expect_count=1):
    """A change that is NOT a defect. Every target must stay green, or the reds above are noise."""
    src, before = _apply(cid, old, new, expect_count)
    if src is None:
        return False
    try:
        r = run_file()
        results = {t[1]: passed(r, t) for t in targets}
    finally:
        DETAIL.write_text(src, encoding="utf-8")
        assert sha(DETAIL) == before, f"{cid}: RESTORE FAILED"
    ok = all(results.values())
    print(f"  {cid}  {'CORRECTLY SILENT' if ok else '✗ FIRED ON A NON-DEFECT'}\n      {desc}")
    for name, g in results.items():
        print(f"      must-green {name!r} → {'GREEN' if g else 'RED'}")
    return ok


def main():
    print("W1.1.8 — TICKET REBUILD POSITIVE CONTROLS (tab-m3w8)\n")
    r = []

    r.append(control(
        "C1", "⚠ the 404 discriminator never fires, so a MISSING issue is announced as a broken "
              "Track — three of the four states collapsed again, in the largest type on the page",
        "  return err instanceof ApiError && err.status === 404",
        "  return false",
        must_red=T_404, must_green=T_FAULT))

    r.append(control(
        "C2", "⚠ THE MIRROR, and the one a one-sided assertion would miss: the discriminator "
              "fires on EVERY ApiError, so a 500 tells the reader their issue does not exist",
        "  return err instanceof ApiError && err.status === 404",
        "  return err instanceof ApiError",
        must_red=T_FAULT, must_green=T_404))

    r.append(control(
        "C3", "the opening region loses its page-scale heading — the console's one display step "
              "goes back to being a token nothing on this screen wears",
        "        label=\"Issue\"\n        heading={heading}\n",
        "        label=\"Issue\"\n",
        must_red=T_PAGE, must_green=T_REGIONS))

    r.append(control(
        "C4", "a region's eyebrow drifts back to a card title — 'Details' names the widget, "
              "'How it is filed' names the question the region answers",
        "<Region index=\"02\" label=\"How it is filed\">",
        "<Region index=\"02\" label=\"Details\">",
        must_red=T_REGIONS, must_green=T_PAGE))

    r.append(control(
        "C5", "the empty description's next action is DESCRIBED rather than performed — the "
              "button still opens the editor and no longer puts the caret in it",
        "                  setFocusEditor(true)",
        "                  setFocusEditor(false)",
        must_red=T_NODESC, must_green=T_EDITING))

    r.append(control(
        "C6", "⚠ THE OLDEST DEFECT ON THIS SCREEN, RE-INTRODUCED THROUGH THE REBUILD: the thread's "
              "fault arm goes and a refused read prints the sentence a genuinely empty thread gets",
        "          ) : comments.isError ? (\n"
        "            <p className=\"text-body text-muted\">\n"
        "              Couldn’t reach Track, so the thread can’t be shown. This is a fault, not an empty\n"
        "              thread.\n"
        "            </p>\n"
        "          ) : (comments.data ?? []).length === 0 ? (",
        "          ) : (comments.data ?? []).length === 0 ? (",
        must_red=T_THREAD_FAULT, must_green=T_THREAD_EMPTY))

    r.append(negative(
        "C7", "NEGATIVE CONTROL — a wording tweak in a sentence no assertion reads. If this reds "
              "anything, the six verdicts above are 'an edit was made', not 'this defect was found'.",
        "            Every AI request Track makes about this issue is metered by Lens and attributed back to",
        "            Every AI request Track makes about this issue is metered by Lens, and attributed to",
        targets=[T_REGIONS, T_PAGE, T_404, T_FAULT, T_OFF, T_401]))

    print(f"\n{sum(r)}/{len(r)} controls behaved as predicted")
    return 0 if all(r) else 1


if __name__ == "__main__":
    sys.exit(main())
