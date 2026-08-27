#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE MOTION CENSUS'S DERIVED POPULATION (W1.1.21g, tab-c7k5).

⚠ THE DEFECT. `w1117-motion-census-m3w8.py` answered "does the SCREEN move" over a HAND-WRITTEN
list of ten address→component pairs, under a comment reading "Read from App.tsx, not guessed".
It was guessed, and it was WRONG ON THE DAY IT WAS WRITTEN — the file's own header describes the
rejected rendered sweep as running "over all twelve `CONSOLE_ROUTES` addresses" while the table
below it listed TEN. `/billing/success` and `/billing/cancel` entered CONSOLE_ROUTES at `7513c91`
(#108, 2026-08-10), sixteen days before this file was written at `7214b70` (#267, 2026-08-26).
Then `/chat` (#271) and `/earnings` (#273) landed on top. Ten of fourteen.

⚠⚠ AND THE MISSING FOUR ARE THE DIRECTION THAT LOOKS FINE: the two newest screens. Nobody
re-reads a census for the screens that did not exist when it was written. Measured after
deriving: `/earnings` 0 motion, `/chat` 2, `/billing/success` 0, `/billing/cancel` 0 — so
W1.1.17's question had three more zero-motion screens hidden behind the population boundary.

⚠⚠⚠ THIS FILE IS NAMED `…controls…` DELIBERATELY. `w1117-motion-census-m3w8.py` matches `w1*.py`
but NOT the anchor check's `w1*controls*.py` glob, so it is a real instrument with NO instrument
over it — which is how its route table rotted unseen. The mutation anchors below DO fall under the
anchor check, so the next rename of `CONSOLE_ROUTES` is caught here even if nobody runs this file.

  M0  pristine — fourteen addresses, and the four that were missing are named
  M1  a fifteenth route added to App.tsx -> the census GROWS to fifteen
  M2  the SAME tree with the population reverted to the hand-written ten -> it does NOT.
      The decisive one: it separates "deriving fixes it" from "the tree happens to agree today"
  M3  the element's import re-pointed -> the census FOLLOWS it. `/settings` renders `Sharing.tsx`,
      a correction the old comment was proud of making BY HAND; this proves it is now read
  M4  CONSOLE_ROUTES renamed -> RAISES by name, and does NOT report a smaller console
  M5  an element with no local import -> RAISES naming the address, rather than dropping it
  M6  the table cut below the floor -> RAISES
  M7  vacuity — the four existing probes still pass, so deriving has not disarmed the census

Every file is restored from saved bytes and sha256-verified in a finally.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CENSUS = ROOT / "scripts/w1117-motion-census-m3w8.py"
APP = ROOT / "apps/web/src/App.tsx"

ROUTE_ANCHOR = "  { path: '/keys', title: 'API keys', element: <Keys /> },"
ROUTE_PLUS = ("  { path: '/w1117-probe', title: 'API keys', element: <Keys /> },\n"
              "  { path: '/keys', title: 'API keys', element: <Keys /> },")
SETTINGS_IMPORT = "import { Settings } from './areas/lens/Sharing'"
# ⚠ RE-POINTED AT A FILE WITH MOTION IN IT, AND THAT IS NOT COSMETIC. The first cut aimed
# at `Ledger`, which has ZERO motion — the same zero `/settings` already reported — so the
# observable could not move and M3 FAILED having tested nothing. A control whose treatment
# and baseline produce the same reading is the no-op this whole campaign is about.
SETTINGS_REPOINTED = "import { Settings } from './areas/track/TrackArea'"
EXPORT_ANCHOR = "export const CONSOLE_ROUTES"
EXPORT_RENAMED = "export const CONSOLE_PAGES_C7K5"
# ⚠ AN ELEMENT WITH NO LOCAL IMPORT — the shape a lazy route would take. Renaming the IMPORT and
# not the usage is the smallest edit that produces it without touching the route table.
KEYS_IMPORT = "import { Keys } from './areas/lens/Keys'"
KEYS_IMPORT_GONE = "import { Keys as KeysRenamedByC7K5 } from './areas/lens/Keys'"
# The population, reverted to what stood before — the hand-written ten, verbatim.
DERIVED_ARM = "SCREENS = screens()"
DERIVED_OFF = '''SCREENS = [
    ("/", "areas/lens/Overview.tsx"),
    ("/ledger", "areas/lens/Ledger.tsx"),
    ("/billing", "areas/lens/TopUp.tsx"),
    ("/keys", "areas/lens/Keys.tsx"),
    ("/setup", "areas/lens/Setup.tsx"),
    ("/spend", "areas/lens/Spend.tsx"),
    ("/members", "areas/lens/Members.tsx"),
    ("/settings", "areas/lens/Sharing.tsx"),
    ("/track", "areas/track/TrackArea.tsx"),
    ("/docs", "areas/docs/DocsArea.tsx"),
]'''


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_census(controls: bool = False) -> tuple[int, str]:
    cmd = [sys.executable, str(CENSUS)] + (["--controls"] if controls else [])
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=900)
    return r.returncode, r.stdout + r.stderr


def addresses(out: str) -> list[str]:
    """The address column, parsed from the table rather than grepped out of the whole output —
    the `where` column contains file paths and would otherwise be counted as addresses."""
    return [m.group(1) for m in
            (re.match(r"^(/\S*)\s+\d+\s+\d+\s+\d+\s", ln) for ln in out.split("\n")) if m]


def where_for(out: str, address: str) -> str:
    for ln in out.split("\n"):
        m = re.match(r"^(/\S*)\s+\d+\s+\d+\s+\d+\s+(.*)$", ln)
        if m and m.group(1) == address:
            return m.group(2).strip()
    return ""


def row_for(out: str, address: str) -> str:
    """The whole row for one address — files, motion, press and where. Comparing only `where`
    reads `—` against `—` when both sides are zero-motion, which is a control that cannot fail."""
    for ln in out.split("\n"):
        m = re.match(r"^(/\S*)\s+(\d+\s+\d+\s+\d+\s+.*)$", ln)
        if m and m.group(1) == address:
            return m.group(2).strip()
    return ""


def swap(path: pathlib.Path, old: str, new: str, cid: str) -> None:
    text = path.read_text(encoding="utf8")
    n = text.count(old)
    if n != 1:
        raise AssertionError(
            f"{cid}: the mutation anchor occurs {n} time(s) in {path.name}, expected exactly 1. "
            "This control has gone stale — it would otherwise change nothing and score a pass.")
    path.write_text(text.replace(old, new, 1), encoding="utf8")


def main() -> int:
    files = [CENSUS, APP]
    saved = {p: (p.read_bytes(), sha(p)) for p in files}
    results: list[tuple[str, bool, str]] = []

    def record(cid: str, ok: bool, detail: str) -> None:
        results.append((cid, ok, detail))
        print(f"  {'OK  ' if ok else '*** FAILED ***'}  {cid}\n        {detail}")

    def restore() -> None:
        for p, (b, _s) in saved.items():
            p.write_bytes(b)

    try:
        _rc, out = run_census()
        base = addresses(out)
        missing_four = {"/earnings", "/chat", "/billing/success", "/billing/cancel"}
        record("M0  pristine — fourteen addresses, including the four that were missing",
               len(base) == 14 and missing_four <= set(base),
               f"{len(base)} addresses; the four: "
               f"{sorted(missing_four & set(base))} (expected 14 and all four)")

        # ── M1 / M2, the decisive pair ────────────────────────────────────────────────────────
        swap(APP, ROUTE_ANCHOR, ROUTE_PLUS, "M1")
        _rc, out = run_census()
        m1 = addresses(out)
        record("M1  a fifteenth route added -> the census GROWS",
               len(m1) == 15 and "/w1117-probe" in m1,
               f"{len(m1)} addresses, probe present={'/w1117-probe' in m1} (expected 15, True)")

        swap(CENSUS, DERIVED_ARM, DERIVED_OFF, "M2")
        _rc, out = run_census()
        m2 = addresses(out)
        record("M2  SAME tree, population reverted to the hand-written ten -> it does NOT",
               len(m2) == 10 and "/w1117-probe" not in m2,
               f"{len(m2)} addresses, probe present={'/w1117-probe' in m2} (expected 10, False) "
               "— this separates 'deriving fixes it' from 'the tree happens to agree today'")
        restore()

        # ── M3 the mapping is READ, not remembered ────────────────────────────────────────────
        # ⚠ THE BASELINE IS RE-MEASURED ON A PRISTINE TREE, not carried over from M2's output.
        # The first cut read it from the variable M2 left behind — a ten-address census of a
        # mutated checker — and compared a treatment against the wrong control.
        _rc, out = run_census()
        base_row = row_for(out, "/settings")
        swap(APP, SETTINGS_IMPORT, SETTINGS_REPOINTED, "M3")
        _rc, out = run_census()
        m3_row = row_for(out, "/settings")
        record("M3  the element's import re-pointed -> the census FOLLOWS it",
               m3_row != base_row and m3_row != "" and base_row != "",
               f"/settings: {base_row!r} -> {m3_row!r} — `Settings` renders `Sharing.tsx` "
               "because the IMPORT says so, not because someone remembered to write it down")
        restore()

        # ── M4 / M5 / M6 refusals ─────────────────────────────────────────────────────────────
        swap(APP, EXPORT_ANCHOR, EXPORT_RENAMED, "M4")
        rc, out = run_census()
        record("M4  CONSOLE_ROUTES renamed -> RAISES, never a smaller console",
               rc != 0 and "could not be located" in out,
               f"exit={rc}, names the table={'could not be located' in out}")
        restore()

        swap(APP, KEYS_IMPORT, KEYS_IMPORT_GONE, "M5")
        rc, out = run_census()
        record("M5  an element with no local import -> RAISES naming the address",
               rc != 0 and "<Keys />" in out and "/keys" in out,
               f"exit={rc}, names the element and address="
               f"{'<Keys />' in out and '/keys' in out} — a lazy route must be decided, not dropped")
        restore()

        for anchor in ("  { path: '/settings', title: 'Settings', element: <Settings /> },\n",
                       "  { path: '/setup', title: 'Setup', element: <Setup /> },\n",
                       "  { path: '/spend', title: 'Spend & routing', element: <Spend /> },\n"):
            swap(APP, anchor, "", "M6")
        rc, out = run_census()
        record("M6  the table cut below the floor -> RAISES",
               rc != 0 and "floor is" in out, f"exit={rc}, floor fired={'floor is' in out}")
        restore()

        # ── M7 vacuity ────────────────────────────────────────────────────────────────────────
        rc, out = run_census(controls=True)
        record("M7  vacuity: the census's own four probes still pass",
               rc == 0 and "4/4 controls behaved as predicted" in out,
               f"exit={rc} — deriving the population has not disarmed the thing being censused")
    finally:
        restore()
        clean = all(sha(p) == s for p, (_b, s) in saved.items())
        print(f"\n  all files restored, sha256-verified: {clean}")
        if not clean:
            results.append(("RESTORE", False, "a file did not restore byte-identically"))

    bad = [c for c, ok, _d in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} controls behaved as specified")
    if bad:
        print("NOT PROVEN: " + ", ".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
