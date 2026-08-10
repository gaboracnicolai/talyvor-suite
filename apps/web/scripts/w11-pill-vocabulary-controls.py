#!/usr/bin/env python3
"""Positive controls for the LEDGER PILL VOCABULARY guard (W1.1).

Guard: `apps/web/src/areas/lens/ledgerPillVocabulary.test.tsx`. It says the mint lifecycle
vocabulary (settled/held/slashed) never reaches an LXC row, and that the mint ledger keeps
every rule it had.

Each control names, BEFORE the run, the test that MUST red and a MUST-STAY-GREEN companion.
Names are SCOPED (describe + title) — this guard has two tests whose titles begin the same
way, and keying on the title alone merges tests that must be told apart. Verdicts are read
from failing test names plus their assertion messages, never from an exit code.

⚠ ONE CONTROL HERE IS A COMPILE ERROR BY CONSTRUCTION (C4 removes the parameter the call
sites pass). `vitest` strips types, so it still RUNS and the verdict is a real assertion —
but `pnpm typecheck` is what would catch it in CI, and that is recorded rather than claimed
as a test catch.

Usage:  python3 apps/web/scripts/w11-pill-vocabulary-controls.py [--only C2]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
SRC = WEB / "src" / "areas" / "lens"
FORMAT = SRC / "format.ts"
LEDGER = SRC / "Ledger.tsx"
REPORT = WEB / ".vitest-controls.json"

D_MAP = "the mapper is told WHICH ledger it is describing"
D_SCREEN = "the Ledger screen — a reservation is a bound, not a lifecycle"
D_OLD = "ledgerStatus maps real + source MINT types onto the Pill vocabulary"

M_LXC = (D_MAP, "no LXC type ever wears a mint lifecycle status")
M_PIN = (D_MAP, "the pinned LXC type list still holds all six")
M_MINT = (D_MAP, "MUST STAY GREEN — the mint ledger keeps every rule it had")
M_DIFFER = (D_MAP, "the two ledgers DISAGREE about the same string — which is the whole point")
S_NOPILL = (D_SCREEN, "paints NO lifecycle pill on the LXC ledger")
S_NAMES = (D_SCREEN, "shows each reservation row as its own name instead")
S_MINT = (D_SCREEN, "MUST STAY GREEN — the mint ledger still wears its pills on the same screen")
O_HELD = (D_OLD, "marks held mints 'held' by suffix (real: pattern_mine_held)")
O_SETTLED = (D_OLD, "treats any other counted mint as 'settled' (real: pattern_mine; source: pool_royalty, compute_mine)")
O_IDLE = (D_OLD, "never returns 'idle' — no ledger row is ever idle (the variant has no data source)")
O_REVOKED = (D_OLD, "marks revoked mints 'slashed' by suffix (source-defined *_revoked)")

# A test that existed BEFORE this change, in Ledger.test.tsx. Named here on purpose: where it
# fires alongside one of mine, the control does not justify my guard, and saying so is the
# only way that stays visible.
PRIOR = ("Ledger renders both real token ledgers",
         "switches to the LENS mint ledger: held + settled pills, µ-integer amounts")

ALL_MINT_GREEN = [M_MINT, S_MINT, O_HELD, O_SETTLED, O_IDLE]


class Control:
    def __init__(self, cid, what, edits, catches, stays_green, expect_caught=True, note=""):
        self.cid, self.what, self.edits = cid, what, edits
        self.catches, self.stays_green = catches, stays_green
        self.expect_caught, self.note = expect_caught, note


CONTROLS = [
    Control(
        "C1", "the token guard removed — LXC rows go back to the mint vocabulary (the bug itself)",
        [(FORMAT, "  if (token === 'lxc') return null\n", "")],
        catches=[M_LXC, M_DIFFER, S_NOPILL, S_NAMES],
        stays_green=ALL_MINT_GREEN + [M_PIN],
        note="This is the defect restored byte for byte. If the guard cannot see THIS, it "
             "cannot see anything.",
    ),
    Control(
        "C2", "the mapper returns null for EVERYTHING — the shape that satisfies every LXC assertion",
        [(FORMAT, "  if (token === 'lxc') return null", "  return null\n  if (token === 'lxc') return null")],
        catches=[M_MINT, M_DIFFER, S_MINT, O_HELD, O_SETTLED, O_REVOKED, PRIOR],
        stays_green=[M_LXC, M_PIN, S_NOPILL, S_NAMES, O_IDLE],
        note="THE INVERSE A ONE-SIDED GUARD CANNOT SEE. Every LXC assertion here is an "
             "assertion of ABSENCE, and a mapper that answers null to everything satisfies "
             "all of them perfectly — only the mint-side must-stay-greens can speak. ⚠ PRIOR "
             "(Ledger.test.tsx, written before this change) fires too, so the MINT half of "
             "this control does not justify my guard; it is the LXC half that is new, and it "
             "is deliberately the half that stays green. O_IDLE stays green because null is "
             "not 'idle' — a different claim, and it says so here.",
    ),
    Control(
        "C2b", "the token test swapped — each ledger given the other's vocabulary",
        [(FORMAT, "  if (token === 'lxc') return null", "  if (token === 'lens') return null")],
        catches=[M_LXC, M_MINT, M_DIFFER, S_NOPILL, S_NAMES, S_MINT, O_HELD, O_SETTLED, O_REVOKED, PRIOR],
        stays_green=[M_PIN, O_IDLE],
        note="⚠ MY FIRST DRAFT CALLED THIS 'always null' AND PREDICTED IT AS C2. It is not: "
             "swapping the test moves BOTH sides, because LXC then falls through to the "
             "suffix rules. Naming a mutation is not the same as writing it — the prediction "
             "was for a control that did not exist.",
    ),
    Control(
        "C3", "the screen drops the token again — the mapper is right, the call site is not",
        [(LEDGER, "<StatusCell type={r.type} token={token} />", "<StatusCell type={r.type} token=\"lens\" />")],
        catches=[S_NOPILL, S_NAMES],
        stays_green=[M_LXC, M_PIN, M_DIFFER] + ALL_MINT_GREEN,
        note="THE PURE-MAPPER TESTS MUST STAY GREEN HERE. A correct function reached through "
             "a wrong argument is exactly what this defect was, and only a test that renders "
             "the SCREEN can see it — which is why this guard has both halves.",
    ),
    Control(
        "C4", "the parameter removed entirely — the old one-argument signature",
        [(FORMAT, "export function ledgerStatus(type: string, token: Token): PillStatus | null {\n  // Not \"LXC has no mint types I know of\" — LXC has no mint lifecycle at all, so the\n  // answer is the same for a type that does not exist yet.\n  if (token === 'lxc') return null",
                  "export function ledgerStatus(type: string): PillStatus | null {")],
        catches=[M_LXC, M_DIFFER, S_NOPILL, S_NAMES],
        stays_green=ALL_MINT_GREEN + [M_PIN],
        note="⚠ A COMPILE ERROR BY CONSTRUCTION — both call sites pass two arguments. vitest "
             "strips types so it still runs and the verdict below is a real assertion, but in "
             "CI `pnpm typecheck` is the thing that speaks first. Recorded, not claimed.",
    ),
    Control(
        "C5", "reservation_hold spelled into the movement list instead — fixes today, rots at the seventh type",
        [(FORMAT, "  if (token === 'lxc') return null", "  if (token === 'lxc' && type !== 'a_seventh_lxc_type') return null")],
        catches=[],
        stays_green=[M_LXC, M_PIN, M_DIFFER, S_NOPILL, S_NAMES] + ALL_MINT_GREEN,
        expect_caught=False,
        note="NOT CAUGHT, AND THAT IS THE HONEST RESULT: no test names a type that does not "
             "exist, so an enumeration-shaped regression is invisible to any fixture. It is "
             "the ARGUMENT for asking which ledger rather than which type — recorded as a "
             "limit of the guard, not as a pass.",
    ),
    Control(
        "C6", "the pinned LXC type list shrunk — the sweep passes by covering less",
        [(SRC / "ledgerPillVocabulary.test.tsx",
          "  'spend',\n  'reservation_hold',\n  'reservation_release',\n  'purchase',\n  'admin_grant',\n  'convert_from_lens',\n] as const",
          "  'spend',\n  'purchase',\n  'admin_grant',\n  'convert_from_lens',\n] as const")],
        catches=[M_PIN],
        stays_green=[M_LXC, M_DIFFER, S_NOPILL, S_NAMES] + ALL_MINT_GREEN,
        note="The floor's own control. A sweep over a list is only as wide as the list, and a "
             "shrinking list makes it pass MORE easily — the one failure mode a sweep cannot "
             "report itself.",
    ),
]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def label(k) -> str:
    return f"{k[1]}   [{k[0][:32]}…]"


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
    touched = [FORMAT, LEDGER, SRC / "ledgerPillVocabulary.test.tsx"]
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
            planned = []
            for path, old, new in c.edits:          # every anchor asserted before any write
                text = originals[path]
                n = text.count(old)
                if n != 1:
                    raise AssertionError(f"{c.cid}: anchor appears {n}x in {path.name}")
                planned.append((path, text.replace(old, new, 1)))
            for path, text in planned:
                path.write_text(text)
            for path in {p for p, _, _ in c.edits}:
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
                ok = not failing
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
