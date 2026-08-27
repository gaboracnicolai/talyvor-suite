#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE SCROLL-RESET HARNESS'S DERIVED ROUTE TABLE (W1.1.21f, tab-c7k5).

⚠ THE DEFECT THIS REPLACED. `w11-scroll-reset-controls.py` predicted which test cases would run
from a HAND-WRITTEN list of twelve gated addresses, under a comment claiming it was "exactly as
App.tsx's CONSOLE_ROUTES spells them … so a thirteenth page appears in both or neither". `/chat`
landed at `24979ab` (#271) and `/earnings` at `b79320e` (#273). They appeared in ONE.

⚠⚠ AND THE COST WAS THE WHOLE HARNESS. The prediction table is reconciled against the cases that
actually ran BEFORE any control is scored, so every run since #271 ended four lines in with
`ABORT: the predictions do not match the cases that ran` and scored ZERO controls. The scroll-reset
guard went unproven across two screens' worth of merges. Nothing said so: the anchor check reports
this file clean, and it is — every anchor it splices is present. A present anchor proves the splice
will LAND, not that the harness will ever reach it.

  D1  a fifteenth route added to App.tsx -> the harness ABSORBS it and still scores 6/6
  D2  the SAME tree with the derivation reverted to the old hand-written twelve -> it ABORTS.
      This is the decisive one: it is what separates "deriving fixes it" from "the tree happens
      to agree today"
  D3  CONSOLE_ROUTES renamed in App.tsx -> the reader RAISES by name, and does NOT return []
  D4  the table cut below the floor -> RAISES, rather than predicting a smaller product
  D5  vacuity — a test case renamed in scrollReset.test.tsx -> the reconciliation still ABORTS,
      so deriving both sides from one file has not made the check toothless

Every file is restored from saved bytes and sha256-verified in a finally.
"""
import hashlib
import pathlib
import re
import subprocess
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent
ROOT = WEB.parent.parent
HARNESS = WEB / "scripts/w11-scroll-reset-controls.py"
APP = WEB / "src/App.tsx"
TEST = WEB / "src/scrollReset.test.tsx"

# A fifteenth route, spelled the way the table spells the others.
ROUTE_ANCHOR = "  { path: '/keys', title: 'API keys', element: <Keys /> },"
ROUTE_PLUS = ("  { path: '/w11-derivation-probe', title: 'API keys', element: <Keys /> },\n"
              "  { path: '/keys', title: 'API keys', element: <Keys /> },")
# The name the reader looks for, and the floor it refuses below.
EXPORT_ANCHOR = "export const CONSOLE_ROUTES"
EXPORT_RENAMED = "export const CONSOLE_PAGES_C7K5"
# ⚠ CUT TO ELEVEN, NOT TO ZERO. Zero would also trip the "could not locate" arm and D4 would pass
# on the wrong refusal — the floor has to be what fires.
FLOOR_CUT_ANCHOR = ("  { path: '/spend', title: 'Spend & routing', element: <Spend /> },\n"
                    "  { path: '/members', title: 'Members', element: <Members /> },\n")
FLOOR_CUT = "  { path: '/spend', title: 'Spend & routing', element: <Spend /> },\n"
# The derivation, reverted to what stood before — the hand-written twelve, verbatim.
DERIVED_ARM = "GATED_ADDRESSES = gated_addresses()"
DERIVED_OFF = ('GATED_ADDRESSES = [\n'
               '    "/", "/ledger", "/billing", "/billing/success", "/billing/cancel", "/keys",\n'
               '    "/setup", "/spend", "/members", "/settings", "/track", "/docs",\n'
               ']')
# A name the reconciliation must notice moving. It is in the POP block, which is NOT derived from
# App.tsx — so D5 tests the half of the prediction table that deriving did not touch.
CASE_ANCHOR = "going back does not request the top"
CASE_MOVED = "going back does not ask for the top"


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_harness() -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(HARNESS)], cwd=ROOT,
                       capture_output=True, text=True, timeout=2400)
    return r.returncode, r.stdout + r.stderr


def scored(out: str) -> int:
    """How many controls the harness actually SCORED. `ABORT` scores none, and the whole point of
    this file is that scoring none looked exactly like a quiet success from the outside."""
    m = re.search(r"(\d+)/(\d+) controls behaved exactly as predicted", out)
    return int(m.group(1)) if m else -1


def swap(path: pathlib.Path, old: str, new: str, cid: str) -> None:
    text = path.read_text(encoding="utf8")
    n = text.count(old)
    if n != 1:
        raise AssertionError(
            f"{cid}: the mutation anchor occurs {n} time(s) in {path.name}, expected exactly 1. "
            "This control has gone stale — it would otherwise change nothing and score a pass, "
            "which is the failure mode this whole file exists to answer.")
    path.write_text(text.replace(old, new, 1), encoding="utf8")


def derived() -> tuple[bool, str]:
    """Call the harness's reader in-process. Returns (raised?, message-or-repr)."""
    r = subprocess.run(
        [sys.executable, "-c",
         "import importlib.util,sys;"
         f"s=importlib.util.spec_from_file_location('sr',{str(HARNESS)!r});"
         "m=importlib.util.module_from_spec(s);\n"
         "try:\n"
         "    s.loader.exec_module(m)\n"
         "    print('OK', len(m.GATED_ADDRESSES))\n"
         "except SystemExit:\n"
         "    print('OK', len(m.GATED_ADDRESSES))\n"
         "except AssertionError as e:\n"
         "    print('RAISED', e)\n"],
        cwd=ROOT, capture_output=True, text=True, timeout=300)
    out = (r.stdout + r.stderr).strip()
    return out.startswith("RAISED"), out


def main() -> int:
    files = [HARNESS, APP, TEST]
    saved = {p: (p.read_bytes(), sha(p)) for p in files}
    results: list[tuple[str, bool, str]] = []

    def record(cid: str, ok: bool, detail: str) -> None:
        results.append((cid, ok, detail))
        print(f"  {'OK  ' if ok else '*** FAILED ***'}  {cid}\n        {detail}")

    def restore() -> None:
        for p, (b, _s) in saved.items():
            p.write_bytes(b)

    try:
        raised, msg = derived()
        record("D0  pristine — the reader sees the whole table",
               not raised and msg == "OK 14", f"{msg} (expected OK 14)")

        # ── D1 / D2, the decisive pair ────────────────────────────────────────────────────────
        swap(APP, ROUTE_ANCHOR, ROUTE_PLUS, "D1")
        _rc, out = run_harness()
        d1 = scored(out)
        record("D1  a fifteenth route added -> the harness ABSORBS it and still scores",
               d1 == 6 and "ABORT" not in out,
               f"scored {d1}/6, abort={'ABORT' in out} (expected 6 and False)")

        swap(HARNESS, DERIVED_ARM, DERIVED_OFF, "D2")
        _rc, out = run_harness()
        d2 = scored(out)
        record("D2  SAME tree, derivation reverted to the hand-written twelve -> ABORTS",
               d2 == -1 and "ABORT" in out,
               f"scored {d2} (expected -1, i.e. none), abort={'ABORT' in out} — this is what "
               "separates 'deriving fixes it' from 'the tree happens to agree today'")
        restore()

        # ── D3 refusal ────────────────────────────────────────────────────────────────────────
        swap(APP, EXPORT_ANCHOR, EXPORT_RENAMED, "D3")
        raised, msg = derived()
        record("D3  CONSOLE_ROUTES renamed -> the reader RAISES, never returns []",
               raised and "could not be located" in msg,
               f"{msg[:110]} (expected RAISED, naming the table)")
        restore()

        # ── D4 floor ──────────────────────────────────────────────────────────────────────────
        swap(APP, FLOOR_CUT_ANCHOR, FLOOR_CUT, "D4")
        # one deletion is 13, still above the floor — take two more so the floor is what fires
        swap(APP, "  { path: '/settings', title: 'Settings', element: <Settings /> },\n", "", "D4")
        swap(APP, "  { path: '/setup', title: 'Setup', element: <Setup /> },\n", "", "D4")
        raised, msg = derived()
        record("D4  the table cut below the floor -> RAISES rather than predicting a smaller product",
               raised and "floor is" in msg,
               f"{msg[:110]} (expected RAISED on the floor)")
        restore()

        # ── D5 vacuity ────────────────────────────────────────────────────────────────────────
        swap(TEST, CASE_ANCHOR, CASE_MOVED, "D5")
        _rc, out = run_harness()
        d5 = scored(out)
        record("D5  vacuity: a NON-derived case renamed -> the reconciliation still ABORTS",
               d5 == -1 and "ABORT" in out,
               f"scored {d5} (expected -1), abort={'ABORT' in out} — deriving both sides of the "
               "gated block from one file has not made the reconciliation toothless")
        restore()
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
