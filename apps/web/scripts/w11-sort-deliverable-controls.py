#!/usr/bin/env python3
"""Positive controls for the SORT-CONTROL DELIVERABILITY guard (W1.1, tab-a3f8).

Guard: the `the sort control offers only orderings the upstream can actually deliver`
block in `apps/web/src/areas/track/IssueList.test.tsx`. It says the Sort control offers
only columns whose ordering this product can actually deliver — and holds the PREMISE of
the one that was removed (`priority`), so the absence expires the day the premise does.

Each control names, BEFORE the run, the test that MUST red and a MUST-STAY-GREEN
companion. Names are SCOPED (describe + title). Verdicts are read from failing test names
plus their assertion messages, never from an exit code. Anchors are all asserted before
any write; the tree is restored in a `finally` and re-checked by sha256.

⚠ TWO OF THE SIX GUARD TESTS WERE GREEN THE FIRST TIME THEY RAN (the source-literal scan
and the enum expiry), which is exactly the condition this file exists for.

Usage:  python3 apps/web/scripts/w11-sort-deliverable-controls.py [--only C3]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
TRACK = WEB / "src" / "areas" / "track"
LIST = TRACK / "IssueList.tsx"
LIST_TEST = TRACK / "IssueList.test.tsx"
FORMAT = TRACK / "format.ts"
FORMAT_TEST = TRACK / "format.test.ts"
REPORT = WEB / ".vitest-controls.json"

D_SORT = "the sort control offers only orderings the upstream can actually deliver"
G_TWO = (D_SORT, "offers exactly the two timestamp columns")
G_DESC = (D_SORT, 'every column it offers is one where a single hardcoded desc means "most useful first"')
G_NOPRI = (D_SORT, "no view this screen can build asks the upstream to order by priority")
G_SRC = (D_SORT, "the sort items are generated from SORT_OPTIONS, not written as literals")
G_ENUM = (D_SORT, "the priority enum is not ordered by importance in either direction")
MINE = [G_TWO, G_DESC, G_NOPRI, G_SRC, G_ENUM]

# Tests that existed BEFORE this change. Named on purpose: where one fires alongside mine,
# the control does not justify my guard, and saying so is the only way that stays visible.
D_VIEW = "the view controls query the server, not the page"
P_DEFAULT = (D_VIEW, "the default view asks for most-recently-updated first, bounded")
P_FETCH = (D_VIEW, "the list fetches exactly what issuesQuery builds for the default view")
P_LABELS = ("track formatters", "priorityLabel maps 0–4 per model.IssuePriority")

PRIORITY_ITEM = "  { value: 'priority', label: 'Priority' },\n"
SORT_TAIL = "  { value: 'created_at', label: 'Recently created' },\n]"

# model.IssuePriority renumbered so that ONE numeric direction IS the importance order —
# the day the removed option becomes deliverable.
LABELS_NOW = """const PRIORITY_LABELS: Record<IssuePriority, string> = {
  0: 'None',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}"""
LABELS_MONOTONE = """const PRIORITY_LABELS: Record<IssuePriority, string> = {
  0: 'None',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
}"""
PRIOR_PIN_NOW = """    expect(priorityLabel(1)).toBe('Urgent')
    expect(priorityLabel(2)).toBe('High')
    expect(priorityLabel(3)).toBe('Medium')
    expect(priorityLabel(4)).toBe('Low')"""
PRIOR_PIN_MONOTONE = """    expect(priorityLabel(1)).toBe('Low')
    expect(priorityLabel(2)).toBe('Medium')
    expect(priorityLabel(3)).toBe('High')
    expect(priorityLabel(4)).toBe('Urgent')"""


class Control:
    def __init__(self, cid, what, edits, catches, stays_green, expect_caught=True, note=""):
        self.cid, self.what, self.edits = cid, what, edits
        self.catches, self.stays_green = catches, stays_green
        self.expect_caught, self.note = expect_caught, note


CONTROLS = [
    Control(
        "C1", "the removed option put back — the defect itself, byte for byte",
        [(LIST, SORT_TAIL, SORT_TAIL.replace("]", PRIORITY_ITEM + "]"))],
        catches=[G_TWO, G_DESC, G_NOPRI],
        stays_green=[G_SRC, G_ENUM, P_DEFAULT, P_FETCH, P_LABELS],
        note="This is what shipped. If the guard cannot see THIS it cannot see anything. "
             "G_SRC stays green on purpose — the constant is the wrong place for it to look, "
             "and C6 is the control that proves it looks somewhere else.",
    ),
    Control(
        "C2", "SORT_OPTIONS emptied — the shape that satisfies every absence assertion perfectly",
        [(LIST, "  { value: 'updated_at', label: 'Recently updated' },\n  { value: 'created_at', label: 'Recently created' },\n", "")],
        catches=[G_TWO],
        stays_green=[G_DESC, G_NOPRI, G_ENUM, G_SRC],
        note="⚠ THE VACUITY DIRECTION, AND THE RESULT IS A LIMIT WORTH READING. G_DESC and "
             "G_NOPRI are both `for (const o of SORT_OPTIONS)` loops, so an EMPTY list makes "
             "both vacuously true — only the hardcoded-literal comparison in G_TWO can speak. "
             "That is why G_TWO is written against a literal rather than derived. ⚠ AND NO "
             "PRIOR TEST MOVES EITHER, measured: DEFAULT_VIEW still names updated_at and "
             "issuesQuery still builds it, so the whole project stays green while the Sort "
             "control renders NO options at all. One test in the repo can see that.",
    ),
    Control(
        "C3", "`sort_order` offered instead — the SAME defect in the other spelling",
        [(LIST, SORT_TAIL, SORT_TAIL.replace("]", "  { value: 'sort_order' as 'created_at', label: 'Manual order' },\n]"))],
        catches=[G_TWO, G_DESC],
        stays_green=[G_NOPRI, G_SRC, G_ENUM, P_DEFAULT, P_FETCH, P_LABELS],
        note="THE ROT-CATCHER, AND THE REASON G_DESC IS NOT A DUPLICATE OF G_NOPRI. "
             "`sort_order` is the fourth column the upstream accepts and the one a future "
             "author is most likely to add; it is a FLOAT with no documented useful end, so "
             "one hardcoded `desc` is unjustified for it too. G_NOPRI stays green because it "
             "names priority — which is exactly why a guard that only named priority would "
             "have let this through.",
    ),
    Control(
        "C4", "the direction flipped — order_dir=asc for every column",
        [(LIST, "q.set('order_dir', 'desc')", "q.set('order_dir', 'asc')")],
        catches=[G_DESC, P_DEFAULT],
        stays_green=[G_TWO, G_NOPRI, G_SRC, G_ENUM, P_LABELS, P_FETCH],
        note="⚠ A PRIOR TEST FIRES WITH MINE, SO THIS CONTROL DOES NOT JUSTIFY G_DESC ON ITS "
             "OWN — P_DEFAULT already pinned order_dir=desc for the default view. What G_DESC "
             "adds is the direction asserted for EVERY offered column together with the claim "
             "about which columns may be offered; C3 is the control that isolates it. "
             "⚠⚠ MY FIRST PREDICTION HERE WAS WRONG AND THE MISS IS THE INTERESTING PART: I "
             "named P_FETCH as a third catcher and it stayed SILENT, because it asserts "
             "`get.url === '/api/track/issues?' + issuesQuery(DEFAULT_VIEW)` — BOTH SIDES CALL "
             "issuesQuery, so no change inside that function can ever move it. It is not a "
             "broken test (its stated job is that the component asks for what issuesQuery "
             "builds, and it does that), but it can never police what issuesQuery builds, and "
             "a wrong prediction is the only thing that would have shown me which.",
    ),
    Control(
        "C5", "the enum renumbered so a numeric sort IS an importance sort",
        [(FORMAT, LABELS_NOW, LABELS_MONOTONE)],
        catches=[G_ENUM, P_LABELS],
        stays_green=[G_TWO, G_DESC, G_NOPRI, G_SRC, P_DEFAULT, P_FETCH],
        note="The positive control for a test that was green the first time it ran. ⚠ THE "
             "PRIOR LABEL PIN FIRES TOO, so this control alone does not justify G_ENUM — see "
             "C5b, which is the edit a person would actually make.",
    ),
    Control(
        "C5b", "the enum renumbered AND the prior label pin updated to match — the real future edit",
        [(FORMAT, LABELS_NOW, LABELS_MONOTONE),
         (FORMAT_TEST, PRIOR_PIN_NOW, PRIOR_PIN_MONOTONE)],
        catches=[G_ENUM],
        stays_green=[G_TWO, G_DESC, G_NOPRI, G_SRC, P_DEFAULT, P_FETCH, P_LABELS],
        note="THE MUTATION ONLY THIS GUARD CAN SEE, and it had to be manufactured: anyone "
             "renumbering the enum updates the label pin in the same commit, and from that "
             "moment G_ENUM is the only thing left that notices the removed Sort option "
             "should come back. That is the whole point of pinning the PREMISE rather than "
             "the absence.",
    ),
    Control(
        "C6", "a literal <SelectItem value=\"priority\"> written back into the JSX, constant untouched",
        [(LIST, "                {SORT_OPTIONS.map((o) => (",
                "                <SelectItem value=\"priority\">Priority</SelectItem>\n                {SORT_OPTIONS.map((o) => (")],
        catches=[G_SRC],
        stays_green=[G_TWO, G_DESC, G_NOPRI, G_ENUM, P_DEFAULT, P_FETCH, P_LABELS],
        note="THE HOLE THE FIRST FOUR TESTS ALL SHARED. They read SORT_OPTIONS; the browser "
             "reads the JSX. This is the shape the option had before it was removed, so it "
             "is also the shape it would return in — and four guards written for it were "
             "blind to it. ⚠ A source scan is the right instrument for an ADDITION, and the "
             "wrong one for a deletion; G_TWO is what covers the other direction.",
    ),
    Control(
        "C7", "the comment block deleted — a mention is not a setting",
        [(LIST, " * ⚠ `priority` IS ABSENT, AND IT USED TO BE HERE.", " * priority")],
        catches=[],
        stays_green=MINE + [P_DEFAULT, P_FETCH, P_LABELS],
        expect_caught=False,
        note="NOT CAUGHT AND IT MUST NOT BE. The block above SORT_OPTIONS says the word "
             "`priority` many times; G_SRC blanks comments before scanning, so editing prose "
             "changes nothing. A guard that cannot tell a mention from a setting reports the "
             "documentation as the defect — recorded here as a required no-op, not a miss.",
    ),
]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def label(k) -> str:
    return f"{k[1]}   [{k[0][:34]}…]"


def run_suite():
    REPORT.unlink(missing_ok=True)
    subprocess.run(["npx", "vitest", "run", "--reporter=json", f"--outputFile={REPORT.name}"],
                   cwd=WEB, capture_output=True, text=True)
    if not REPORT.exists():
        return {("", "<<NO REPORT — the project produced no results>>")}, {}
    data = json.loads(REPORT.read_text())
    failing, messages = set(), {}
    for res in data.get("testResults", []):
        for a in res.get("assertionResults", []):
            if a.get("status") == "failed":
                anc = a.get("ancestorTitles") or []
                key = (anc[-1] if anc else "", a.get("title", ""))
                failing.add(key)
                msgs = a.get("failureMessages") or []
                messages[key] = (msgs[0].splitlines()[0] if msgs else "")[:150]
    return failing, messages


def typecheck_ok() -> bool:
    r = subprocess.run(["npx", "tsc", "--noEmit"], cwd=WEB, capture_output=True, text=True)
    return r.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--only"); args = ap.parse_args()
    touched = [LIST, LIST_TEST, FORMAT, FORMAT_TEST]
    before = {p: sha(p) for p in touched}

    print("BASELINE — the project must be green, and typecheck must pass.")
    base_fail, _ = run_suite()
    base_tc = typecheck_ok()
    if base_fail or not base_tc:
        print("  REFUSING TO RUN.  typecheck ok:", base_tc)
        for n in sorted(base_fail):
            print("   ·", label(n))
        return 2
    print("  green, and typecheck clean.\n")

    results = []
    for c in CONTROLS:
        if args.only and c.cid != args.only:
            continue
        originals = {p: p.read_text() for p in touched}
        try:
            planned = {}
            for path, old, new in c.edits:          # every anchor asserted before any write
                text = planned.get(path, originals[path])
                n = text.count(old)
                if n != 1:
                    raise AssertionError(f"{c.cid}: anchor appears {n}x in {path.name}")
                planned[path] = text.replace(old, new, 1)
            for path, text in planned.items():
                path.write_text(text)
            for path in planned:
                if sha(path) == before[path]:
                    raise AssertionError(f"{c.cid}: {path.name} unchanged after the edit")

            failing, messages = run_suite()
            tc = typecheck_ok()
            caught = sorted((n for n in c.catches if n in failing), key=label)
            missed = sorted((n for n in c.catches if n not in failing), key=label)
            broke = sorted((n for n in c.stays_green if n in failing), key=label)
            other = sorted(failing - set(c.catches) - set(c.stays_green), key=label)

            if c.expect_caught:
                ok = not missed and not broke
                verdict = "CAUGHT as predicted" if ok else "NOT AS PREDICTED"
            else:
                ok = not [n for n in failing if n in MINE]
                verdict = "NOT CAUGHT as required" if ok else "CAUGHT — but must not be"

            results.append((c.cid, ok, verdict))
            print(f"{c.cid}  {c.what}")
            print(f"     verdict: {verdict}    (typecheck after the edit: {'clean' if tc else 'FAILS'})")
            for tag, group in (("predicted catchers that fired", caught),
                               ("PREDICTED BUT SILENT", missed),
                               ("MUST-STAY-GREEN THAT MOVED", broke),
                               ("also red, outside the prediction", other)):
                if group:
                    print(f"     {tag}:")
                    for n in group:
                        print(f"       · {label(n)}")
                        if messages.get(n):
                            print(f"         → {messages[n]}")
            if c.note:
                print(f"     note: {c.note}")
            print()
        finally:
            for p, text in originals.items():
                p.write_text(text)
            for p in touched:
                assert sha(p) == before[p], f"RESTORE FAILED for {p}"

    REPORT.unlink(missing_ok=True)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"── {passed}/{len(results)} controls behaved as predicted ──")
    for cid, ok, verdict in results:
        print(f"   {cid}  {'ok ' if ok else 'XX '} {verdict}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
