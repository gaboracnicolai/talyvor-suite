#!/usr/bin/env python3
"""Positive controls for PanelReportsItsOwnQuery.test.tsx (W1.1, tab-6e5a).

THE PROPERTY UNDER TEST: a panel must report the state of the query it is guarding. The defect
this guard was written for — Spend.tsx guarding on `ledger.isError` and passing `lxc.error` —
shipped through 134 merges under a fully green suite, because SessionExpired.test.tsx's fixture
answers EVERY /api/* with the SAME status and a uniform fixture makes two panels' error objects
interchangeable. So the first thing every control here has to establish is that this file's
NON-UNIFORM fixture is what does the seeing.

Conventions this harness keeps, each of them paid for by an earlier campaign in this repo:

  * EVERY ANCHOR IS ASSERTED UNIQUE, AND ALL OF THEM BEFORE ANY WRITE. A control carrying two
    edits can otherwise apply half of itself — the second write goes to a file the first already
    changed — and a working guard gets recorded as blind.
  * FILES ARE RESTORED FROM SAVED BYTES IN A `finally`, NOT AFTER THE RUN and never with
    `git checkout`: the tree carries the uncommitted fix, and a crash between mutate and restore
    would leave the mutation on disk. sha256 is compared after every restore.
  * THE VERDICT IS THE SET OF FAILING TEST NAMES, WITH THE FIRST LINE OF THE ASSERTION MESSAGE
    PRINTED. An exit code cannot tell a caught mutation from a file that failed to compile, and a
    list of names cannot tell a real catch from a crash.
  * A RUN THAT COLLECTED NO TESTS SCORES `ERROR`, NEVER `NOT CAUGHT`. A zero from an instrument
    that read nothing is indistinguishable from a measured zero.
  * ONE CONTROL MUST STAY GREEN (C6). Without it, "everything reds" is unfalsifiable.
"""

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
SPEND = WEB / "src" / "areas" / "lens" / "Spend.tsx"
OVERVIEW = WEB / "src" / "areas" / "lens" / "Overview.tsx"
BAR = WEB / "src" / "components" / "SessionExpiredBar.tsx"
DOCUMENTS = WEB / "src" / "areas" / "lens" / "Documents.tsx"
GUARD = WEB / "src" / "PanelReportsItsOwnQuery.test.tsx"
TEST = "src/PanelReportsItsOwnQuery.test.tsx"

TOUCHED = (SPEND, OVERVIEW, BAR, DOCUMENTS, GUARD)

# The table the guard sweeps, mirrored so predictions can be computed rather than transcribed.
ADDRESS_ROUTES = {
    "/": ["/api/bonds", "/api/docs/spaces", "/api/lxc/balance", "/api/lxc/history", "/api/spend/month", "/api/tokens/balance", "/api/tokens/history", "/api/track/workspaces", "/api/usage"],
    "/ledger": ["/api/lxc/history"],
    "/billing": ["/api/lxc/balance", "/api/lxc/topup-options"],
    "/keys": ["/api/keys"],
    "/setup": ["/api/context", "/api/keys"],
    "/spend": ["/api/lxc/history", "/api/spend/month", "/api/tokens/history", "/api/usage"],
    "/members": ["/api/members"],
    "/settings": ["/api/distill"],
    "/track": ["/api/members", "/api/track/issues", "/api/track/workspaces"],
    "/docs": ["/api/docs/spaces"],
}


def sweep(addr: str, route: str) -> str:
    return f"{addr} with only {route} refused 401"


def route_table(addr: str) -> str:
    return f"{addr} still asks for exactly the routes this file sweeps"


ALL_SWEEP = [sweep(a, r) for a, rs in ADDRESS_ROUTES.items() for r in rs]
ALL_ROUTE_TABLE = [route_table(a) for a in ADDRESS_ROUTES]
FLOOR = "covers every gated address, and no address contributes nothing"
ASKED_ONCE = "a 401 is a verdict, not a flake — /api/distill is asked ONCE"
NO_SECOND_VOICE = "the setting does not add a second diagnosis under the bar"
READ_500_GREEN = "but a GENUINE fault keeps the sentence AND its advice — must stay green"
WRITE_401 = "the WRITE half too: a refused save does not tell you to try again"
WRITE_500_GREEN = "and a genuine save failure DOES — must stay green"
B_SPEND = "/spend: the mint-ledger card reports its OWN 500, not the LXC ledger’s 401"
B_OVERVIEW = "/ (Overview) does this correctly — the control that says the product already knows the answer"

# Where a PanelFailure (as opposed to an InlineFailure, or a screen's own wording) is what a
# refused route draws. Read off the call-site census, not guessed: Overview's Failed() wrapper
# (LXC balance, LENS balance, mint ledger, bonds, recent activity) plus CacheCard, Ledger, Keys,
# Members and Docs' SpaceList. /billing, /setup, /track and /settings render none.
PANEL_FAILURE_CASES = [
    sweep("/", "/api/lxc/balance"),
    sweep("/", "/api/tokens/balance"),
    sweep("/", "/api/tokens/history"),
    sweep("/", "/api/bonds"),
    sweep("/", "/api/usage"),
    sweep("/ledger", "/api/lxc/history"),
    sweep("/keys", "/api/keys"),
    sweep("/spend", "/api/tokens/history"),
    sweep("/spend", "/api/usage"),
    sweep("/members", "/api/members"),
    sweep("/docs", "/api/docs/spaces"),
]

CONTROLS = [
    {
        "id": "C1",
        "what": "revert the fix — Spend's mint-ledger card passes the LXC query's error again",
        "edits": [(SPEND, "<PanelFailure error={ledger.error} what=\"the ledger\" />",
                          "<PanelFailure error={lxc.error} what=\"the ledger\" />")],
        "reds": [sweep("/spend", "/api/tokens/history"), B_SPEND],
        "expect": "EXACTLY TWO, one per direction. The 401 case catches the misdiagnosis (a "
                  "second voice under the bar); the scoped 500 case catches the laundering (a "
                  "genuine fault wearing the expired-credential placeholder). Neither one alone "
                  "would justify the other's branch",
    },
    {
        "id": "C2",
        "what": "plant the SAME defect in the copy that was right — Overview's mint-ledger panel",
        "edits": [(OVERVIEW, '<Failed what="the mint ledger" error={ledger.error} />',
                             '<Failed what="the mint ledger" error={lxc.error} />')],
        "reds": [sweep("/", "/api/tokens/history"), B_OVERVIEW],
        "expect": "THE CONTROL THAT SAYS THIS IS A SWEEP AND NOT A PIN ON /spend. If only C1 "
                  "reddened anything, the file would be a regression test for one line rather "
                  "than a guard on the property",
    },
    {
        "id": "C3",
        "what": "PanelFailure always renders the expired-credential placeholder (constant-true)",
        "edits": [(BAR, "{isSessionExpired(error) ? 'Unavailable.' : `Couldn’t load ${what}.`}",
                        "{true ? 'Unavailable.' : `Couldn’t load ${what}.`}")],
        "reds": [B_SPEND, B_OVERVIEW],
        "expect": "BOTH section-B cases, and NONE of section A's twenty-five. ⚠ I FIRST "
                  "PREDICTED ONE — the scoped /spend case — and forgot that B's Overview "
                  "control is itself a “Couldn’t load” assertion, so a constant-true silences "
                  "it too. The lesson survives the misprediction and is the point of the "
                  "control: section A asserts the ABSENCE of “Couldn’t load”, so a mutation "
                  "that removes that sentence everywhere makes all 25 of its cases MORE true. A "
                  "guard with only the A branch scores this blind",
    },
    {
        "id": "C4",
        "what": "PanelFailure never recognises an expired credential (constant-false)",
        "edits": [(BAR, "{isSessionExpired(error) ? 'Unavailable.' : `Couldn’t load ${what}.`}",
                        "{false ? 'Unavailable.' : `Couldn’t load ${what}.`}")],
        "reds": PANEL_FAILURE_CASES,
        "expect": "THE INVERSE OF C3, and the argument for section A. Every sweep case whose "
                  "refused route draws a PanelFailure — eleven of the twenty-five — now speaks. "
                  "The other fourteen draw an InlineFailure or a screen's own wording and are "
                  "untouched, which is what says A is measuring the panel and not the page",
    },
    {
        "id": "C5",
        "what": "the session bar never renders",
        "edits": [(BAR, "  if (!expired) return null", "  if (true) return null")],
        "reds": ALL_SWEEP + [ASKED_ONCE, NO_SECOND_VOICE],
        "expect": "ALL TWENTY-FIVE sweep cases plus the two /settings cases that wait for the "
                  "bar. ⚠ IT WAS TWENTY-FOUR BEFORE: /settings was exempt, because its read "
                  "raised a bare Error that no session mechanism could see. Closing that is what "
                  "made this control's number go up, which is the tidiest evidence the exemption "
                  "was real and is gone",
    },
    {
        "id": "C6",
        "what": "a padding class on Spend's container changes and nothing else",
        "edits": [(SPEND, 'className="flex flex-col gap-4 px-gutter py-4"',
                          'className="flex flex-col gap-4 px-gutter py-5"')],
        "reds": [],
        "expect": "NOTHING. THE MUST-STAY-GREEN COMPANION. This file is a rule about WHICH ERROR "
                  "a panel reports; a guard that reds on any edit to Spend.tsx is a guard the "
                  "next person deletes, and without a control that must not fire, “everything "
                  "reds” is not a result",
    },
    {
        "id": "C7",
        "what": "revert the READ half — readDistill throws a bare Error again",
        "edits": [
            (DOCUMENTS, "  if (!res.ok) throw new ApiError(res.status, '/api/distill')\n  return (await res.json()) as DistillState",
                        "  if (!res.ok) throw new Error(String(res.status))\n  return (await res.json()) as DistillState"),
        ],
        "reds": [sweep("/settings", "/api/distill"), ASKED_ONCE, NO_SECOND_VOICE],
        "expect": "THREE, one per mechanism the TYPE controls: the bar stops appearing (the "
                  "sweep case), the refusal is retried (asked-once), and the screen goes back to "
                  "advice that is false in that state (second-voice). One untyped throw turns "
                  "off three things at once, which is exactly why the type is the fix and the "
                  "wording only follows. ⚠ THE WRITE CASES STAY GREEN — a separate throw, four "
                  "lines away, and C10 is its own control for a reason",
    },
    {
        "id": "C8",
        "what": "settled() goes back to its first draft — wait only for the absence of “Loading…”",
        "edits": [(GUARD, "  await waitFor(() => expect(requested.length).toBeGreaterThan(0), { timeout: 5000 })\n  let previous = -1",
                          "  let previous = requested.length\n  let _unused = -1"),
                  (GUARD, "      const stable = requested.length === previous\n      previous = requested.length\n      expect(stable && !/Loading…|Checking…/.test(pageText())).toBe(true)",
                          "      expect(!/Loading…|Checking…/.test(pageText())).toBe(true)")],
        "reds": ALL_ROUTE_TABLE + [B_SPEND, B_OVERVIEW],
        "expect": "A CONTROL ON THE INSTRUMENT, NOT ON THE PRODUCT, and it is here because this "
                  "was a REAL hole in the first draft. “No Loading… on screen” is TRUE AT t=0 "
                  "— AuthGate has not resolved /auth/me and the body is one empty <div> — so "
                  "every case settled instantly against a page that had never rendered. The ten "
                  "route tables derive [] and the two scoped cases cannot find a card. ⚠ THE "
                  "TWENTY-FIVE SWEEP CASES STAY GREEN THROUGHOUT, vacuously: an assertion that "
                  "something is ABSENT is the one shape an empty page satisfies perfectly. ⚠ WHEN THE "
                  "/settings pin still existed this reddened it too, for the same reason — it "
                  "read the distill query out of the cache and at t=0 that query does not exist "
                  "yet",
    },
    {
        "id": "C9",
        "what": "the swept table quietly loses one of /spend's four routes",
        "edits": [(GUARD, "'/spend': ['/api/lxc/history', '/api/spend/month', '/api/tokens/history', '/api/usage'],",
                          "'/spend': ['/api/lxc/history', '/api/spend/month', '/api/usage'],")],
        "reds": [FLOOR, route_table("/spend")],
        # Deleting a row from the table deletes the sweep case it generates, so this run
        # collects 48 rather than 49 — see run_guard's docstring.
        "collects": 52,
        "expect": "THE FLOOR AND THE TABLE, together. The pinned pair count says the sweep got "
                  "smaller; the per-address derivation says the product still asks for the route "
                  "that was dropped. Either alone could be argued away — the count could be "
                  "'we removed a screen', the derivation could be 'the table is the spec'",
    },
    {
        "id": "C10",
        "what": "revert the WRITE half — the save's throw goes back to a bare Error",
        "edits": [(DOCUMENTS, "      if (!res.ok) throw new ApiError(res.status, '/api/distill')",
                              "      if (!res.ok) throw new Error(String(res.status))")],
        "reds": [WRITE_401],
        "expect": "ONLY the write case. THE READ CASES STAY GREEN, and that is the point: a "
                  "mutation's error never enters the query cache, so no bar and no retry rule "
                  "react to it — the read's three catchers are all blind to this half. Without "
                  "its own case the write would have been fixed on faith",
    },
    {
        "id": "C11",
        "what": "the read's failure sentence is always the neutral placeholder",
        "edits": [(DOCUMENTS, "          {isSessionExpired(q.error) ? (", "          {true ? (")],
        "reds": [READ_500_GREEN],
        "expect": "ONLY the must-stay-green 500 case. This is the over-correction control — "
                  "'make 401 honest by saying the same thing about 500' fixes nothing, it moves "
                  "which failure is misdescribed. On a 500 the buttons really do still work",
    },
    {
        "id": "C12",
        "what": "the write's failure advice is always the terse one",
        "edits": [(DOCUMENTS, "        isSessionExpired(err)\n          ? 'That did not save, so nothing changed.'",
                              "        true\n          ? 'That did not save, so nothing changed.'")],
        "reds": [WRITE_500_GREEN],
        "expect": "ONLY the must-stay-green 500 write case — the same over-correction from the "
                  "write side. 'You can try again' is correct advice for a blip and dropping it "
                  "everywhere trades one wrong sentence for a less useful one",
    },
]


def run_guard(collects: int = 53) -> dict:
    """{failing test title: [failure messages]} — or a single synthetic key for a dead run.

    `collects` is how many assertions this run is expected to COLLECT, which is not always 49:
    C9 edits the swept table itself, so it legitimately generates one case fewer.

    ⚠ THE FIRST DRAFT HARDCODED 49 AND SCORED C9 AS `ERROR` — a working control, condemned by
    the harness's own verdict logic for doing precisely what it was written to do. The count
    check is here to catch a run that COLLAPSED, so it has to be a claim about each control
    rather than a constant about the file.
    """
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
        # A control must not be scored against a run that collapsed partway.
        if total != collects:
            return {"__PARTIAL_RUN__": [f"{total} assertions collected, expected {collects}"]}
        return failed
    finally:
        report.unlink(missing_ok=True)


def main() -> int:
    before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in TOUCHED}
    saved = {p: p.read_text() for p in TOUCHED}

    print("BASELINE (no mutation) — green, or every verdict below is noise")
    base = run_guard()
    if base:
        print(f"  FAIL: the guard is not green before the campaign: {sorted(base)}")
        return 2
    print("  ok\n")

    results = []
    try:
        for c in CONTROLS:
            # ⚠ ALL ANCHORS CHECKED BEFORE ANY WRITE.
            bad = None
            for path, find, _ in c["edits"]:
                n = saved[path].count(find)
                if n != 1:
                    bad = f"{path.name}: {n} matches for {find[:60]!r}"
                    break
            if bad:
                print(f"{c['id']}  ANCHOR NOT UNIQUE — control not run — {bad}\n")
                results.append((c, "ANCHOR", set()))
                continue

            pending = {}
            for path, find, repl in c["edits"]:
                pending[path] = pending.get(path, saved[path]).replace(find, repl)
            for path, text in pending.items():
                assert text != saved[path], f"{c['id']}: {path.name} unchanged by its own edit"
                path.write_text(text)

            got = run_guard(c.get("collects", 53))

            for path in pending:
                path.write_text(saved[path])
                assert hashlib.sha256(path.read_bytes()).hexdigest() == before[path], \
                    f"{c['id']}: {path.name} did not restore"

            predicted, actual = set(c["reds"]), set(got)
            if any(k.startswith("__") for k in actual):
                verdict = "ERROR"
            elif predicted == actual:
                verdict = "CAUGHT" if predicted else "NOT CAUGHT (as predicted)"
            else:
                verdict = "MISPREDICTED"
            results.append((c, verdict, actual))

            print(f"{c['id']}  {verdict}   ({len(actual)} case(s) red)")
            print(f"    mutation : {c['what']}")
            print(f"    predicted: {c['expect']}")
            for nm in sorted(actual)[:3]:
                msg = (got[nm][0] if got[nm] else "")
                first = next((ln for ln in msg.splitlines() if ln.strip()), "")
                print(f"    reddened : {nm}")
                print(f"               {first[:150]}")
            if len(actual) > 3:
                print(f"    ... and {len(actual) - 3} more")
            if verdict == "MISPREDICTED":
                print(f"    only-predicted: {sorted(predicted - actual)}")
                print(f"    only-actual   : {sorted(actual - predicted)}")
            print()
    finally:
        for p in TOUCHED:
            p.write_text(saved[p])
            after = hashlib.sha256(p.read_bytes()).hexdigest()
            if after != before[p]:
                print(f"⚠⚠ {p} DID NOT RESTORE — {before[p][:16]} -> {after[:16]}")
                return 3

    ok = sum(1 for _, v, _ in results if v in ("CAUGHT", "NOT CAUGHT (as predicted)"))
    print(f"{ok}/{len(results)} controls as predicted")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
