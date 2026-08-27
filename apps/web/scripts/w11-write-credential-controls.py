#!/usr/bin/env python3
"""Positive controls for the WRITE-UNDER-A-DEAD-CREDENTIAL guard (W1.1, tab-a3f8).

Guard: `apps/web/src/writeUnderDeadCredential.test.tsx`. It says a write refused by a dead
workspace credential states the OUTCOME and leaves the REMEDY to the one bar that owns it —
and that the three states stay three (a 500 keeps its retry copy, a 400 keeps the upstream's
sentence, a 403 at the mint keeps its origin diagnosis).

Each control names, BEFORE the run, the test that MUST red and a MUST-STAY-GREEN companion.
Names are SCOPED (describe + title). Verdicts are read from failing test names plus their
assertion messages, never from an exit code. Every anchor is asserted before any write; the
tree is restored in a `finally` and re-checked by sha256.

⚠ THE GUARD'S SUBJECT IS A BUTTON PRESS, which is why SessionExpired.test.tsx — 25 (address,
route) pairs, all reads — cannot stand in for it. C5 is the control that proves that claim
rather than asserting it.

Usage:  python3 apps/web/scripts/w11-write-credential-controls.py [--only C3]
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
KEYS = SRC / "areas" / "lens" / "Keys.tsx"
LIST = SRC / "areas" / "track" / "IssueList.tsx"
STATE = SRC / "lib" / "productState.ts"
REPORT = WEB / ".vitest-controls.json"

D = "a write refused by a dead credential states the outcome and leaves the remedy to the bar"
K_REMEDY = (D, "keys — mint a key: says what did not happen, and does not offer a second remedy")
K_STRING = (D, "keys — mint a key: does not repeat the upstream's error string as advice about the request")
K_500 = (D, "keys — mint a key: MUST STAY GREEN — a 500 keeps its remedy and raises no bar")
T_REMEDY = (D, "track — create an issue: says what did not happen, and does not offer a second remedy")
T_STRING = (D, "track — create an issue: does not repeat the upstream's error string as advice about the request")
T_500 = (D, "track — create an issue: MUST STAY GREEN — a 500 keeps its remedy and raises no bar")
G_400 = (D, "MUST STAY GREEN — a 400 still shows the upstream sentence verbatim")
G_403 = (D, "MUST STAY GREEN — a 403 at the mint still names the origin refusal")
MINE = [K_REMEDY, K_STRING, K_500, T_REMEDY, T_STRING, T_500, G_400, G_403]

# Tests that existed BEFORE this change. Named on purpose: where one fires with mine, the
# control does not justify my guard, and saying so is the only way that stays visible.
P_ONCE = ("one dead session is one message, not eight", "says it exactly once even though every panel failed")
P_SHOUT = ("one dead session is one message, not eight", 'no panel still shouts "Couldn’t load"')
P_500 = ("three states stay three", 'a 500 is still a genuine fault and still says "Couldn’t load"')

# ⚠ THE WHOLE BLOCK WAS RE-INDENTED 12 -> 14 IN Keys.tsx (W1.1.21c, tab-r5m2), so these three
# carry two spaces too few on every line. The FIRST line still matched as a SUBSTRING of the deeper
# indent — which is why this reads as a near-miss rather than an obvious one — but the continuation
# lines do not, so C1 and C6 could not arm. Verified by hand against Keys.tsx.
# ⚠ LIST_401_BRANCH below is NOT stale: it addresses IssueList.tsx, which was not re-indented.
KEYS_NOW = """              {mint.error instanceof ApiError && mint.error.status === 403
                ? 'Couldn’t mint the key — the request origin was rejected. Reach this app at its configured address.'
                : isSessionExpired(mint.error)
                  ? 'Couldn’t mint the key. Nothing was changed.'
                  : 'Couldn’t mint the key. Please try again.'}"""
KEYS_OLD = """              {mint.error instanceof Error && mint.error.message.includes('403')
                ? 'Couldn’t mint the key — the request origin was rejected. Reach this app at its configured address.'
                : 'Couldn’t mint the key. Please try again.'}"""
KEYS_ALWAYS_SILENT = """              {'Couldn’t mint the key. Nothing was changed.'}"""

LIST_401_BRANCH = "            {isSessionExpired(create.error)\n"
LIST_401_REMOVED = "            {false\n"


class Control:
    def __init__(self, cid, what, edits, catches, stays_green, expect_caught=True, note=""):
        self.cid, self.what, self.edits = cid, what, edits
        self.catches, self.stays_green = catches, stays_green
        self.expect_caught, self.note = expect_caught, note


CONTROLS = [
    Control(
        "C1", "the keys mint back to the substring match and one sentence — the defect itself",
        [(KEYS, KEYS_NOW, KEYS_OLD)],
        catches=[K_REMEDY],
        stays_green=[K_STRING, K_500, T_REMEDY, T_STRING, T_500, G_400, G_403, P_ONCE, P_SHOUT, P_500],
        note="Byte for byte what shipped, INCLUDING the `message.includes('403')` classifier. "
             "⚠ G_403 STAYS GREEN, and that is the honest reading: the substring match is right "
             "today because this path is a constant with no digits in it. The 403 test is a "
             "must-stay-green for BOTH spellings, so it CANNOT justify the change to `.status` "
             "and nothing here does. ⚠ THAT IS RECORDED RATHER THAN PAPERED OVER: no honest "
             "control can, because the mint's path is the CONSTANT '/api/keys' and no id can "
             "enter its ApiError message. The sibling `revoke` DOES put a key id in its path, "
             "which is why it reads `.status` — the argument for spelling both the same way is "
             "the hazard, not a caught regression. A control that edits no bytes was drafted "
             "here and deleted: it would have scored a pass for proving nothing.",
    ),
    Control(
        "C3", "the create's 401 branch removed — the 401 falls back into the not-as-sent bucket",
        [(LIST, LIST_401_BRANCH, LIST_401_REMOVED)],
        catches=[T_STRING],
        stays_green=[K_REMEDY, K_STRING, K_500, T_REMEDY, T_500, G_400, G_403, P_ONCE, P_SHOUT, P_500],
        note="THE SECOND HALF OF THE DEFECT. `!retryable` is true for 401, so without this "
             "branch the screen prints the upstream's error string as advice about a request "
             "that was fine. ⚠ T_REMEDY STAYS GREEN — the sentence it shows in that state "
             "carries no 'try again', so a guard written only against the remedy word would "
             "have let this through; it takes the string test to see it.",
    ),
    Control(
        "C4", "CreateRefusal back to extending bare Error — invisible to the shared predicate",
        [(LIST, "class CreateRefusal extends ApiError {\n  constructor(\n    status: number,",
                "class CreateRefusal extends Error {\n  constructor(\n    readonly status: number,"),
         (LIST, "    super(status, '/api/track/issues')\n    this.name = 'CreateRefusal'",
                "    super(reason || `create: ${status}`)")],
        catches=[T_STRING],
        stays_green=[K_REMEDY, K_STRING, K_500, T_REMEDY, T_500, G_400, G_403, P_ONCE, P_SHOUT, P_500],
        note="#136's defect on the write path: `isSessionExpired` requires `instanceof "
             "ApiError`, so a hand-rolled error type turns the predicate off without changing "
             "one line of the predicate. The 401 branch is still THERE and still written "
             "correctly — it simply never matches. That is the whole reason the type matters.",
    ),
    Control(
        "C5", "the SHARED predicate broken — isSessionExpired never true",
        [(STATE, "  return err instanceof ApiError && err.status === 401\n}",
                 "  return err instanceof ApiError && err.status === 401 && false\n}")],
        catches=[K_REMEDY, T_REMEDY, T_STRING, P_ONCE, P_SHOUT],
        stays_green=[K_500, T_500, G_400, G_403, P_500],
        note="⚠ THE PRIOR TESTS FIRE HERE TOO, SO THIS CONTROL DOES NOT JUSTIFY MY GUARD — it "
             "justifies the SHARED predicate, which SessionExpired.test.tsx already owns. It is "
             "run for the opposite reason: to show the two sets are not the same set. C3 and C4 "
             "are the mutations only the write guard sees, and they are the ones that matter. "
             "⚠⚠ MY FIRST PREDICTION PUT T_REMEDY IN THE MUST-STAY-GREENS AND IT MOVED, which "
             "is a property of my own guard worth stating: the two 'no second remedy' tests "
             "each ALSO assert the bar is present — deliberately, since that is what makes a "
             "second remedy a contradiction rather than mere noise — so they are NOT independent "
             "of the shared predicate and can red for either reason. The assertion MESSAGE is "
             "what tells the two apart, which is why this harness prints it: here they failed on "
             "'Unable to find … /Signing in again fixes it/', not on the remedy.",
    ),
    Control(
        "C6", "the mint silenced entirely — the shape that satisfies every absence assertion",
        [(KEYS, KEYS_NOW, KEYS_ALWAYS_SILENT)],
        catches=[K_500, G_403],
        stays_green=[K_REMEDY, K_STRING, T_REMEDY, T_STRING, T_500, G_400, P_ONCE, P_SHOUT, P_500],
        note="THE VACUITY DIRECTION. K_REMEDY asserts a sentence does NOT contain 'try again', "
             "and a surface that never offers a remedy at all satisfies it perfectly — only the "
             "must-stay-greens can speak, which is why this guard has one per state rather than "
             "only the 401 cases.",
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
    touched = [KEYS, LIST, STATE, SRC / "areas" / "lens" / "keysApi.ts"]
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
            if not changed and c.expect_caught:
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
