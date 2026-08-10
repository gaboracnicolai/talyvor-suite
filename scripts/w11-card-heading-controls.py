#!/usr/bin/env python3
"""Positive controls for apps/web/src/CardHeaderHeading.test.tsx.

Same shape as scripts/w11-type-scale-controls.py: a ONE-EDIT mutation of the PRODUCT, a NAMED
prediction of which cases red, and a verdict read from the set of failing test NAMES rather than
an exit code — an exit code cannot tell a caught mutation from a file that no longer parses.

Two of the seven exist for failure modes the address sweep is structurally blind to:

  · C6 REMOVES THE STRUCTURAL ANCHOR the sweep locates card headers by. Every per-address case
    then passes BY FINDING NOTHING, and only the floor can say so. This is the control that
    justifies the floor; without it the floor is decoration.
  · C7 changes a padding class and must red NOTHING. A guard that reds on every edit to Card.tsx
    is a guard someone deletes at the next merge.

C1 and C2 share a red set BY DESIGN (div and h3 are both "not h2" to twelve of the cases); the
assertion MESSAGES are what distinguish them, so both are printed.

Usage:  python3 scripts/w11-card-heading-controls.py
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web"
CARD = REPO / "packages/ui/src/components/Card.tsx"
MU = REPO / "packages/ui/src/components/MuNumeral.tsx"
APP = REPO / "apps/web/src/App.tsx"
TEST = "src/CardHeaderHeading.test.tsx"

ELEMENT = "CardHeader emits a heading, not a div"
LEVEL = "h2 is the right LEVEL — it sits under the page name the shell already writes"
FLOOR = "the sweep actually reaches card headers — a floor over the whole gated set"
OTHERS = "nothing ELSE on the page became a heading — the over-correction this file refuses"
FIGURE = "a money FIGURE wearing the head step is not a heading either"
ADDRESSES = [
    "/", "/ledger", "/billing", "/billing/success", "/billing/cancel", "/keys", "/setup",
    "/spend", "/members", "/settings", "/track", "/docs",
]
SWEEP = [f"{a} renders every card header it has as a heading" for a in ADDRESSES]
# /billing/success and /billing/cancel render a card header too; every address in the table has
# at least one, which is why the whole sweep reds together.
SWEEP_WITH_HEADERS = SWEEP

CONTROLS = [
    {
        "id": "C1",
        "what": "the header goes back to a <div> — the defect exactly as it shipped",
        "file": CARD,
        "find": '<h2 className="text-head text-ink">{children}</h2>',
        "repl": '<div className="text-head text-ink">{children}</div>',
        "reds": [ELEMENT, LEVEL, OTHERS] + SWEEP_WITH_HEADERS,
        "expect": "every element/level/address case, AND the over-correction count (which reads "
                  "one heading where it expects seven). The two FLOORS stay green: the selector "
                  "still matches, it just matches divs",
    },
    {
        "id": "C2",
        "what": "the header is a heading at the WRONG LEVEL — h3 under an h1, a skipped level",
        "file": CARD,
        "find": '<h2 className="text-head text-ink">{children}</h2>',
        "repl": '<h3 className="text-head text-ink">{children}</h3>',
        "reds": [ELEMENT, LEVEL] + SWEEP_WITH_HEADERS,
        "expect": "the SAME set as C1 by design — 'not h2' is what twelve of the cases test. The "
                  "messages differ ('expected H3' vs 'expected DIV') and that is the only thing "
                  "that tells them apart; a campaign scored on counts alone would call one "
                  "redundant",
    },
    {
        "id": "C3",
        "what": "MuNumeral's FIGURE span becomes a heading — the over-correction, halfway",
        "file": MU,
        "find": '<span className="text-head text-ink">{wholeStr}</span>',
        "repl": '<h2 className="text-head text-ink">{wholeStr}</h2>',
        "reds": [FIGURE],
        "expect": "ONLY the direct-render figure case. ⚠ THE FIRST DRAFT PREDICTED THE COUNT "
                  "CASE AND SCORED 0 RED: this file's BFF fake 404s the balance reads, so no "
                  "MuNumeral renders at ANY address and the address-shaped assertion could not "
                  "see it. The component is rendered directly for exactly that reason",
    },
    {
        "id": "C4",
        "what": "the sidebar WORDMARK becomes a heading — the same over-correction, other half",
        "file": APP,
        "find": '<div className="text-head leading-tight text-ink">Talyvor</div>',
        "repl": '<h2 className="text-head leading-tight text-ink">Talyvor</h2>',
        "reds": [OTHERS],
        "expect": "ONLY the over-correction case, through its OTHER branch — the wordmark would "
                  "otherwise appear above the page name on every screen",
    },
    {
        "id": "C5",
        "what": "the header row keeps its heading but loses its own text token",
        "file": CARD,
        "find": '<h2 className="text-head text-ink">{children}</h2>',
        "repl": '<h2 className="text-ink">{children}</h2>',
        "reds": [ELEMENT, LEVEL, FLOOR, OTHERS],
        "expect": "MEASURED, AND NOT WHAT I FIRST PREDICTED. I expected the twelve address cases "
                  "to red as well; they do NOT, because dropping the token removes the sweep's "
                  "SUBJECT and a loop over nothing passes. The element case (it pins the classes) "
                  "and the three floors are the whole catch. Same lesson as C6 from the other "
                  "side: a per-address sweep cannot see its own subject disappear",
    },
    {
        "id": "C6",
        "what": "the header row loses `border-b` — the sweep's structural anchor, not its subject",
        "file": CARD,
        "find": "'flex items-center justify-between gap-gutter border-b border-rule px-gutter py-2.5'",
        "repl": "'flex items-center justify-between gap-gutter border-rule px-gutter py-2.5'",
        "reds": [FLOOR, LEVEL, OTHERS],
        "expect": "THE VACUITY CONTROL. Every per-address case now passes by finding NOTHING; "
                  "only the floor (and /setup's own >4 floor) can say the sweep lost its subject",
    },
    {
        "id": "C7",
        "what": "a padding class changes and nothing else — predicted NOT CAUGHT, deliberately",
        "file": CARD,
        "find": "px-gutter py-2.5'",
        "repl": "px-gutter py-3'",
        "reds": [],
        "expect": "NOTHING. This file is a rule about ELEMENTS. A guard that reds on every edit "
                  "to Card.tsx is a guard someone deletes",
    },
]


def run_guard() -> dict:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as fh:
        report = Path(fh.name)
    try:
        subprocess.run(
            ["npx", "vitest", "run", TEST, "--reporter=json", f"--outputFile={report}"],
            cwd=WEB, capture_output=True, text=True, timeout=900,
        )
        try:
            data = json.loads(report.read_text())
        except Exception:
            return {"__COLLECTION_ERROR__": ["the guard file did not run at all"]}
        failed, total = {}, 0
        for tr in data.get("testResults", []):
            for ar in tr.get("assertionResults", []):
                total += 1
                if ar.get("status") == "failed":
                    failed[ar.get("title", "")] = ar.get("failureMessages", [])
        if total == 0:
            return {"__NO_TESTS_RAN__": ["the guard file produced no assertions"]}
        return failed
    finally:
        report.unlink(missing_ok=True)


def main() -> int:
    files = (CARD, MU, APP)
    sha_before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    backups = {p: p.read_text() for p in files}

    print("BASELINE (no mutation) — every case must be green, or every verdict below is noise")
    base = run_guard()
    if base:
        print(f"  FAIL: the guard is not green before the campaign: {sorted(base)}")
        return 2
    print("  ok\n")

    results = []
    try:
        for c in CONTROLS:
            path, find = c["file"], c["find"]
            text = backups[path]
            n = text.count(find)
            if n != 1:
                print(f"{c['id']}  ANCHOR NOT UNIQUE ({n} matches) — control not run: {find[:70]!r}\n")
                results.append((c, "ANCHOR", set()))
                continue
            path.write_text(text.replace(find, c["repl"]))
            got = run_guard()
            path.write_text(text)

            predicted, actual = set(c["reds"]), set(got)
            if predicted == actual:
                verdict = "CAUGHT" if predicted else "NOT CAUGHT (as predicted)"
            else:
                verdict = "MISPREDICTED"
            results.append((c, verdict, actual))
            print(f"{c['id']}  {verdict}   ({len(actual)} case(s) red)")
            print(f"    mutation : {c['what']}")
            print(f"    predicted: {c['expect']}")
            for nm in sorted(actual)[:3]:
                first = next((ln for ln in (got[nm][0] if got[nm] else "").splitlines() if ln.strip()), "")
                print(f"    reddened : {nm}")
                print(f"               {first[:140]}")
            if len(actual) > 3:
                print(f"    ... and {len(actual) - 3} more, same shape")
            if verdict == "MISPREDICTED":
                print(f"    only-predicted: {sorted(predicted - actual)}")
                print(f"    only-actual   : {sorted(actual - predicted)}")
            print()
    finally:
        for p, t in backups.items():
            p.write_text(t)
        sha_after = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        assert sha_after == sha_before, "RESTORE FAILED"
        print("restored: sha256 of Card.tsx, MuNumeral.tsx and App.tsx match the pre-campaign bytes")

    caught = sum(1 for r in results if r[1].startswith("CAUGHT"))
    inert = sum(1 for r in results if r[1].startswith("NOT CAUGHT"))
    bad = [r[0]["id"] for r in results if r[1] in ("MISPREDICTED", "ANCHOR")]
    print(f"\n{caught} caught by the predicted set, {inert} inert as predicted, "
          f"{len(bad)} mispredicted{': ' + ', '.join(bad) if bad else ''}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
