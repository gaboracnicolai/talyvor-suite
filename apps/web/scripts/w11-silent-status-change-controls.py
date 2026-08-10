#!/usr/bin/env python3
"""Positive controls for the SILENT STATUS CHANGE guard (W1.1, tab-e4d1).

Guard: `apps/web/src/statusChangeRefusal.test.tsx`. It says a status change refused on Track's
issue list STATES THE OUTCOME — on every status code, not only a dead credential — and that the
three states stay three (a 500 keeps the remedy, a 401 does not offer one, an accepted change
still moves the row and says nothing).

The defect: `setStatus.isError` was read NOWHERE. Measured at 401, 500 and 403 against a stateful
fake, a refused change added ZERO characters to the page.

Each control names, BEFORE the run, the test that MUST red and a MUST-STAY-GREEN companion.
Names are SCOPED (describe + title). Verdicts are read from failing test names plus their
assertion messages, never from an exit code. Every anchor is asserted before any write; the tree
is restored in a `finally` and re-checked by sha256.

⚠ TWO CONTROLS HERE DO NOT JUSTIFY THIS GUARD AND SAY SO (C3, C6). A prior test fires with each,
which means the mutation was already covered — recording that is the only way it stays visible.

Usage:  python3 apps/web/scripts/w11-silent-status-change-controls.py [--only C3]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
SRC = WEB / "src"
LIST = SRC / "areas" / "track" / "IssueList.tsx"
STATE = SRC / "lib" / "productState.ts"
REPORT = WEB / ".vitest-controls.json"

D = "a status change refused on the issue list says so"
T401_REMEDY = (D, "401: states the outcome, and does not tell the reader to retry a request that cannot succeed")
T401_STRING = (D, "401: does not repeat the upstream sentence as advice about the change")
T500 = (D, "500: states the outcome AND keeps the remedy, because a fault really can pass")
T403 = (D, "403: states the outcome — a refusal is never silent, whatever the code")
TROW = (D, "a refusal leaves the row showing the status Track still holds, not the one that was picked")
TGREEN_OK = (D, "MUST STAY GREEN — an accepted change moves the row and adds no failure sentence")
TGREEN_PRE = (D, "MUST STAY GREEN — the list renders no failure sentence before anything is pressed")
MINE = [T401_REMEDY, T401_STRING, T500, T403, TROW, TGREEN_OK, TGREEN_PRE]

# Tests that existed BEFORE this change. Named on purpose: where one fires with mine, the control
# does not justify my guard, and saying so is the only way that stays visible.
D140 = "a write refused by a dead credential states the outcome and leaves the remedy to the bar"
P_CREATE_REMEDY = (D140, "track — create an issue: says what did not happen, and does not offer a second remedy")
P_CREATE_STRING = (D140, "track — create an issue: does not repeat the upstream's error string as advice about the request")
P_CREATE_500 = (D140, "track — create an issue: MUST STAY GREEN — a 500 keeps its remedy and raises no bar")
P_KEYS_REMEDY = (D140, "keys — mint a key: says what did not happen, and does not offer a second remedy")
P_STATUS_OK = ("the issue list a tester actually uses", "changes a status and shows the new one without a reload")
P_SORT_TWO = ("the sort control offers only orderings the upstream can actually deliver", "offers exactly the two timestamp columns")
P_SORT_GEN = ("the sort control offers only orderings the upstream can actually deliver", "the sort items are generated from SORT_OPTIONS, not written as literals")
P_ONCE = ("one dead session is one message, not eight", "says it exactly once even though every panel failed")

# ── the anchors ──────────────────────────────────────────────────────────────

SURFACE_ON = "        {setStatus.isError ? (\n"
SURFACE_OFF = "        {false ? (\n"
SURFACE_ALWAYS = "        {true ? (\n"

THROW_TYPED = "      if (!res.ok) throw new ApiError(res.status, `/api/track/issues/${v.id}`)\n"
THROW_BARE = "      if (!res.ok) throw new Error(`status: ${res.status}`)\n"

REMEDY_BRANCH = "              : 'Couldn’t change the status — nothing was changed. Try again.'}\n"
REMEDY_DROPPED = "              : 'Couldn’t change the status — nothing was changed.'}\n"

SESSION_BRANCH = "                'Couldn’t change the status — nothing was changed.'\n"
SESSION_SWAPPED = "                'Couldn’t change the status — nothing was changed. Try again.'\n"

INVALIDATE_ON = (
    "      return res.json()\n"
    "    },\n"
    "    onSuccess: async () => {\n"
    "      await qc.invalidateQueries({ queryKey: ['track', 'issues'] })\n"
    "    },\n"
    "  })\n"
    "\n"
    "  // THREE STATES"
)
INVALIDATE_OFF = (
    "      return res.json()\n"
    "    },\n"
    "    onSuccess: async () => {\n"
    "    },\n"
    "  })\n"
    "\n"
    "  // THREE STATES"
)

PREDICATE_ON = "  return err instanceof ApiError && err.status === 401\n"
PREDICATE_OFF = "  return err instanceof ApiError && err.status === 401 && false\n"

SORT_BOTH = "  { value: 'created_at', label: 'Recently created' },\n"
SORT_ONE = ""


class Control:
    def __init__(self, cid, what, edits, catches, stays_green, expect_caught=True, note=""):
        self.cid, self.what, self.edits = cid, what, edits
        self.catches, self.stays_green = catches, stays_green
        self.expect_caught, self.note = expect_caught, note


CONTROLS = [
    Control(
        "C1", "the error surface removed entirely — the defect exactly as it shipped",
        [(LIST, SURFACE_ON, SURFACE_OFF)],
        catches=[T401_REMEDY, T401_STRING, T500, T403, TROW],
        stays_green=[TGREEN_OK, TGREEN_PRE, P_CREATE_REMEDY, P_CREATE_STRING, P_CREATE_500,
                     P_KEYS_REMEDY, P_STATUS_OK, P_SORT_TWO, P_ONCE],
        note="THE MEASURED STATE. `setStatus.isError` read nowhere, so a refusal had nowhere to "
             "land — 0 characters added to the page at 401, 500 and 403 alike. ⚠ NOT ONE PRIOR "
             "TEST MOVES: 1005 tests were green while the fastest write in the product failed "
             "silently on every status code. That is the whole argument for this guard.",
    ),
    Control(
        "C2", "the throw back to a bare Error — the type turns the shared predicate off",
        [(LIST, THROW_TYPED, THROW_BARE)],
        catches=[T401_REMEDY],
        stays_green=[T401_STRING, T500, T403, TROW, TGREEN_OK, TGREEN_PRE, P_CREATE_REMEDY,
                     P_CREATE_STRING, P_CREATE_500, P_KEYS_REMEDY, P_STATUS_OK, P_ONCE],
        note="Byte for byte what shipped. #136's shape a third time: `isSessionExpired` requires "
             "`instanceof ApiError`, so a hand-rolled error type turns the predicate off without "
             "one line of the predicate changing — the 401 branch is still THERE and still "
             "correct, it simply never matches, and the 401 falls into the branch that says "
             "'Try again' about a request that will be refused identically for four more hours. "
             "⚠ T401_STRING STAYS GREEN and that is honest: both branches are fixed strings, so "
             "a guard written only against the upstream sentence could not see this. It takes "
             "the remedy assertion. ⚠ THIS IS THE MUTATION ONLY THIS GUARD SEES — no prior test "
             "moves, because nothing before it read this mutation's error at all.",
    ),
    Control(
        "C3", "the SHARED predicate broken — isSessionExpired never true",
        [(STATE, PREDICATE_ON, PREDICATE_OFF)],
        catches=[T401_REMEDY, P_CREATE_REMEDY, P_KEYS_REMEDY, P_ONCE],
        stays_green=[T401_STRING, T500, T403, TROW, TGREEN_OK, TGREEN_PRE, P_CREATE_500, P_STATUS_OK],
        note="⚠ THIS CONTROL DOES NOT JUSTIFY THIS GUARD — the prior write and read guards fire "
             "with it, so the predicate is already covered. It is run for the opposite reason: "
             "to show the two sets are not the same set. C1 and C2 are the mutations only this "
             "guard sees, and they are the ones that matter.",
    ),
    Control(
        "C4", "the sentence rendered unconditionally — the vacuity direction",
        [(LIST, SURFACE_ON, SURFACE_ALWAYS)],
        catches=[TGREEN_PRE, TGREEN_OK],
        stays_green=[T401_REMEDY, T401_STRING, T500, T403, TROW, P_CREATE_REMEDY, P_CREATE_500,
                     P_KEYS_REMEDY, P_STATUS_OK, P_ONCE],
        note="A SURFACE THAT ALWAYS SHOUTS satisfies every 'the outcome is stated' assertion "
             "above perfectly, while telling a reader their work failed when it never ran. Only "
             "the two must-stay-greens can speak, which is why this guard has one for the "
             "untouched list and one for the accepted write rather than only the refusal cases. "
             "⚠ THE 401 BRANCH IS KEPT INTACT HERE ON PURPOSE: making it always render the "
             "GENERIC sentence would also red T401_REMEDY, and the control would then prove "
             "nothing about the must-stay-greens specifically. ⚠ ONE PRIOR TEST ALSO REDS AND IT "
             "WAS NOT PREDICTED: IssueList.test.tsx's 'shows the upstream reason for a 400 "
             "instead of inviting a pointless retry' asserts a `<p class=\"text-caption "
             "text-muted\">` is null, and an always-rendered EMPTY one satisfies its selector. "
             "That is a fact about the sibling's selector, not about this surface — it would not "
             "have fired for a real regression here, which is why it is recorded rather than "
             "counted as coverage.",
    ),
    Control(
        "C5", "the remedy dropped from the non-401 branch — the three states collapse to two",
        [(LIST, REMEDY_BRANCH, REMEDY_DROPPED)],
        catches=[T500],
        stays_green=[T401_REMEDY, T401_STRING, T403, TROW, TGREEN_OK, TGREEN_PRE, P_CREATE_REMEDY,
                     P_CREATE_500, P_KEYS_REMEDY, P_STATUS_OK, P_ONCE],
        note="A 500 really can pass on a retry and a 401 cannot, so a single sentence for both is "
             "wrong in one direction whichever sentence is chosen. ⚠ T403 STAYS GREEN and should: "
             "it asserts a 403 is not SILENT, which is a different claim from which remedy it "
             "carries — a control that reddened both would mean the two tests were one test.",
    ),
    Control(
        "C6", "onSuccess no longer invalidates — an accepted write stops moving the row",
        [(LIST, INVALIDATE_ON, INVALIDATE_OFF)],
        catches=[TGREEN_OK, P_STATUS_OK],
        stays_green=[T401_REMEDY, T401_STRING, T500, T403, TROW, TGREEN_PRE, P_CREATE_REMEDY,
                     P_CREATE_500, P_KEYS_REMEDY, P_ONCE],
        note="⚠ A PRIOR TEST FIRES HERE, SO THIS DOES NOT JUSTIFY TGREEN_OK — IssueList.test.tsx "
             "already owns 'changes a status and shows the new one without a reload'. It is run "
             "anyway because it is the control on MY OWN INSTRUMENT: my first probe used a fake "
             "that served the same row back, so an accepted write and a refused one looked "
             "IDENTICAL on screen and the positive control could not tell them apart. This is the "
             "mutation that proves the stateful fixture is doing work — without the refetch, "
             "success is indistinguishable from refusal and every claim above about 'the row "
             "moved' is unearned.",
    ),
    Control(
        "C7", "the two branches swapped — each state gets the other's remedy",
        [(LIST, SESSION_BRANCH, SESSION_SWAPPED), (LIST, REMEDY_BRANCH, REMEDY_DROPPED)],
        catches=[T401_REMEDY, T500],
        stays_green=[T401_STRING, T403, TROW, TGREEN_OK, TGREEN_PRE, P_CREATE_REMEDY,
                     P_CREATE_500, P_KEYS_REMEDY, P_STATUS_OK, P_ONCE],
        note="BOTH DIRECTIONS AT ONCE. C5 shows the 500 assertion is earned; this shows the pair "
             "is a DISTINCTION rather than two independent facts — a screen that carries both "
             "sentences but hands each to the wrong state is exactly as wrong as a screen with "
             "one, and neither single-branch control catches it.",
    ),
    Control(
        "C8", "a sort option deleted — MUST NOT be caught",
        [(LIST, SORT_BOTH, SORT_ONE)],
        catches=[],
        stays_green=MINE,
        expect_caught=False,
        note="THE SCOPE CONTROL. A guard that reds on any edit to IssueList.tsx is a guard that "
             "says nothing about status refusals. The prior sort tests SHOULD red here (that is "
             "their job, and it also proves this harness can read prior-test failures at all); "
             "not one of mine may. Required verdict: NOT CAUGHT.",
    ),
]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def label(k) -> str:
    return f"{k[1]}   [{k[0][:30]}…]"


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
    touched = [LIST, STATE]
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
            changed = [p for p in planned if sha(p) != before[p]]
            if not changed:
                raise AssertionError(f"{c.cid}: nothing changed on disk")

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
                fired = [n for n in failing if n in MINE]
                ok = not fired
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
