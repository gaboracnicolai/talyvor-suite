#!/usr/bin/env python3
"""
POSITIVE CONTROLS for W1.1.9's four-headline rule and its region composition — tab-m3w8.

WHY. The `/docs` card said "Spaces" in every state this screen has: loading, off (the 503/404 the
BFF answers when DOCS_* is unset), a genuine failure, and a workspace full of them. A noun cannot be
false, which is why that header was safe and why the screen said nothing. W1.1.9 gives it the
console's page-scale step, and a claim CAN be false — in the largest type the console has. So the
five assertions added to DocsArea.test.tsx are put in front of mutations that change exactly the
thing each one names.

⚠ C1 AND C2 ARE A PAIR AND NEITHER IS SUFFICIENT ALONE. C1 drops `answered` from the empty
predicate — the obvious form, true while the read is in flight AND true when it failed. C2 folds
OFF into the fault arm, which is this area's oldest rule ("off, not broken") failing at the loudest
place it has ever been stated. A suite that catches one and not the other is asserting "not the
other sentence" rather than the right sentence.

⚠ C6 IS THE NEGATIVE CONTROL AND IT IS NOT DECORATION — see the sibling harness
w118-issuedetail-controls-m3w8.py, where the negative control found a defect in the HARNESS rather
than the product and two "SUSPECT" verdicts turned out to be the instrument failing to run. The
verdict here is read from per-test status in vitest's JSON report, never from the process exit code,
for that reason.

Convention as w117-issuelist-controls-q4vn.py: anchor count asserted before the write, bytes verified
changed, a MUST-RED target AND a MUST-STAY-GREEN companion, byte-identical sha256-verified restore on
every exit path.
"""

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web"
LIST = REPO / "apps/web/src/areas/docs/SpaceList.tsx"

F = "src/areas/docs/DocsArea.test.tsx"
T_REGIONS = (F, "a workspace with spaces is four named regions")
T_PAGE = (F, "makes exactly one page-scale claim")
T_EMPTY = (F, "an EMPTY workspace says so")
T_OFF = (F, "an unconfigured Docs reads as OFF in the heading")
T_FAULT = (F, "a FAULT is not an empty workspace")
T_ROWS = (F, "renders one row per space, marks private")
T_CREATE = (F, "creates the first space and it APPEARS WITHOUT A RELOAD")
T_LIVE = (F, "claims liveness only when data actually loaded")

REPORT = Path(tempfile.gettempdir()) / "w119-controls-report.json"


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


def _apply(cid, old, new, expect_count):
    src = LIST.read_text(encoding="utf-8")
    n = src.count(old)
    if n != expect_count:
        print(f"  {cid}  ✗ ANCHOR DEAD — SpaceList.tsx holds it {n}×, expected {expect_count}")
        return None, None
    before = sha(LIST)
    LIST.write_text(src.replace(old, new, expect_count), encoding="utf-8")
    if sha(LIST) == before:
        print(f"  {cid}  ✗ THE WRITE CHANGED NOTHING")
        LIST.write_text(src, encoding="utf-8")
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
        LIST.write_text(src, encoding="utf-8")
        assert sha(LIST) == before, f"{cid}: RESTORE FAILED"
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
        LIST.write_text(src, encoding="utf-8")
        assert sha(LIST) == before, f"{cid}: RESTORE FAILED"
    ok = all(results.values())
    print(f"  {cid}  {'CORRECTLY SILENT' if ok else '✗ FIRED ON A NON-DEFECT'}\n      {desc}")
    for name, g in results.items():
        print(f"      must-green {name!r} → {'GREEN' if g else 'RED'}")
    return ok


def main():
    print("W1.1.9 — SPACE-LIST REBUILD POSITIVE CONTROLS (tab-m3w8)\n")
    r = []

    r.append(control(
        "C1", "⚠ the obvious empty predicate — the row count alone, with no `answered` — so a "
              "workspace whose Docs is BROKEN is told in the largest type that it has written nothing",
        "  const empty = answered && spaces.length === 0",
        "  const empty = spaces.length === 0",
        must_red=T_FAULT, must_green=T_EMPTY))

    r.append(control(
        "C2", "⚠ OFF FOLDED INTO BROKEN — this area's oldest rule (a 503 is 'off, not broken') "
              "failing at the loudest place it has ever been stated",
        "  const off = q.error instanceof ApiError && (q.error.status === 503 || q.error.status === 404)",
        "  const off = false",
        must_red=T_OFF, must_green=T_FAULT))

    r.append(control(
        "C3", "the opening region loses its page-scale heading — the console's one display step "
              "goes back to being a token nothing on this screen wears",
        "        label=\"Spaces\"\n        heading={heading}\n",
        "        label=\"Spaces\"\n",
        must_red=T_PAGE, must_green=T_REGIONS))

    r.append(control(
        "C4", "a region's eyebrow drifts back to the card title it replaced — 'Spaces' names the "
              "noun, 'What this workspace has' names the question the region answers",
        "<Region index=\"01\" label=\"What this workspace has\">",
        "<Region index=\"01\" label=\"Spaces\">",
        must_red=T_REGIONS, must_green=T_PAGE))

    r.append(control(
        "C5", "the empty state's next action is DESCRIBED rather than performed — the button is "
              "still there and no longer puts the caret in the field it names",
        "onClick={() => nameRef.current?.focus()}",
        "onClick={() => undefined}",
        must_red=T_EMPTY, must_green=T_ROWS))

    r.append(negative(
        "C6", "NEGATIVE CONTROL — a wording tweak in a sentence no assertion reads. If this reds "
              "anything, the five verdicts above are 'an edit was made', not 'this defect was found'.",
        "            A space keeps pages that belong together — a team, a product, a decision you will\n"
        "              come back to. It stays in your own workspace.",
        "            A space keeps pages that belong together — a team, a product, a decision to\n"
        "              return to. It stays in your own workspace.",
        targets=[T_REGIONS, T_PAGE, T_EMPTY, T_OFF, T_FAULT, T_ROWS, T_CREATE, T_LIVE]))

    print(f"\n{sum(r)}/{len(r)} controls behaved as predicted")
    return 0 if all(r) else 1


if __name__ == "__main__":
    sys.exit(main())
