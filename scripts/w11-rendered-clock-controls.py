#!/usr/bin/env python3
"""Positive controls for src/renderedClock.test.ts and the pinned gate clock (W1.1).

Every control names its PREDICTED CATCHER before it runs, so a CAUGHT verdict has to agree with
a prediction rather than merely be non-zero. Each mutation is applied to a real byte anchor,
verified present first, and restored in a `finally` with a sha256 comparison — a crash between
mutate and restore must not leave a mutated tree behind.

Run from the repo root:  python3 scripts/w11-rendered-clock-controls.py
"""

import hashlib
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "apps/web"

LENS_FMT = ROOT / "apps/web/src/areas/lens/format.ts"
TRACK_FMT = ROOT / "apps/web/src/areas/track/format.ts"
UI_FMT = ROOT / "packages/ui/src/lib/format.ts"
WEB_CFG = ROOT / "apps/web/vitest.config.ts"

# The case names this file predicts as catchers. Kept as literals so a renamed case makes the
# prediction fail loudly rather than silently match nothing.
CASE_EXACT = "draws a known instant as one exact string"
CASE_ONE_CLOCK = "is one clock: both shipped formatWhen implementations answer identically"
CASE_UTC_DAY = "is a different rule from the clock: a UTC calendar day, in every zone"


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_web() -> tuple[int, str]:
    """apps/web's vitest only — the project every control here targets."""
    r = subprocess.run(
        ["npx", "vitest", "run", "--reporter=default"],
        cwd=WEB, capture_output=True, text=True,
    )
    return r.returncode, r.stdout + r.stderr


def failing_cases(out: str) -> list[str]:
    """The test NAMES vitest reported as failed — never a bare count.

    A verdict read from an exit code cannot tell a caught mutation from a crashed run, and a
    verdict read from a count cannot tell WHICH assertion spoke.
    """
    names = []
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("×") or s.startswith("FAIL"):
            names.append(s)
    return names


def control(label: str, edits: list[tuple[pathlib.Path, str, str]], predicted: str,
            must_stay_green: str | None = None) -> bool:
    """Apply EVERY edit, run once, restore every file in a finally.

    A control that needs two files changed together must change them in ONE run: applying them
    as two runs measures two different mutations and answers a question nobody asked.
    """
    originals = {p: p.read_text() for p, _, _ in edits}
    before = {p: sha(p) for p in originals}
    print(f"\n=== {label}")
    print(f"    PREDICTED : {predicted}")
    for p, old, _ in edits:
        print(f"    file      : {p.relative_to(ROOT)}")
        if old not in originals[p]:
            print(f"    !! ANCHOR ABSENT: {old!r} — control cannot apply; NOT a NOT-CAUGHT result")
            return False
    ok = False
    try:
        for p, old, new in edits:
            mutated = originals[p].replace(old, new, 1)
            if mutated == originals[p]:
                print("    !! MUTATION INERT (replace changed nothing)")
                return False
            p.write_text(mutated)
        code, out = run_web()
        fails = failing_cases(out)
        caught = code != 0
        print(f"    verdict   : {'CAUGHT' if caught else 'NOT CAUGHT'} (exit {code})")
        for f in fails:
            print(f"      red: {f}")
        if caught:
            hit = any(predicted in f for f in fails)
            print(f"    prediction: {'CONFIRMED' if hit else '*** WRONG — a different assertion spoke ***'}")
            ok = hit
        if must_stay_green is not None:
            still_green = not any(must_stay_green in f for f in fails)
            print(f"    stay-green: {must_stay_green!r} -> {'green' if still_green else '*** ALSO RED ***'}")
            ok = ok and still_green
    finally:
        for p, original in originals.items():
            p.write_text(original)
            if sha(p) != before[p]:
                sys.exit(f"restore failed for {p} — tree is dirty, fix before continuing")
        print("    restored  : ok (sha256 match on every file)")
    return ok


def main() -> int:
    print("U0 — no mutation: the tree as committed must be green.")
    code, out = run_web()
    print(f"    verdict   : exit {code}")
    if code != 0:
        for f in failing_cases(out):
            print(f"      red: {f}")
        return 1

    # C5's PREMISE. Removing the pin can only be observed from a machine whose own zone is not
    # the pinned one. Asserted, not assumed: on a box that happened to sit at +14 the control
    # would be inert and its NOT CAUGHT would mean nothing.
    ambient = subprocess.run(
        ["node", "-e", "process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone + ' ' + String(-new Date('2026-07-19T14:52:59Z').getTimezoneOffset()))"],
        capture_output=True, text=True,
    ).stdout.strip()
    print(f"\nC5 premise — this machine's ambient zone: {ambient} (pinned zone is +840 minutes)")
    if ambient.endswith(" 840"):
        print("    !! ambient zone EQUALS the pin — C5 would be inert here; run it elsewhere")

    results = {}

    # C1 — the defect this file was written for, verbatim. Measured at 3b27d13 against the OLD
    # assertions: 1069/1069 green. BOTH implementations move together in ONE run, so the
    # cross-module case cannot see it — which is what leaves the exact-string case alone to
    # catch it, and what makes this control about that case rather than about duplication.
    results["C1 ledger clock flips to 12-hour (both modules together)"] = control(
        "C1  hour12 false -> true, in BOTH shipped formatWhen",
        [(LENS_FMT, "hour12: false,", "hour12: true,"),
         (TRACK_FMT, "hour12: false,", "hour12: true,")],
        predicted=CASE_EXACT, must_stay_green=CASE_ONE_CLOCK,
    )

    # C2 — the plausible-looking repair. Pinning the clock to UTC is the change a reader of this
    # file is most likely to make; it must not pass silently, because it changes the day every
    # ledger row shows.
    results["C2 lens clock pinned to UTC"] = control(
        "C2  timeZone: 'UTC' added to lens formatWhen",
        [(LENS_FMT, "    hour12: false,\n  })", "    hour12: false,\n    timeZone: 'UTC',\n  })")],
        predicted=CASE_EXACT, must_stay_green=CASE_UTC_DAY,
    )

    # C3 — ONE module moves. The exact-string case reads lens only, so track drifting alone is
    # exactly the hole the cross-module case exists to close: figureFace.test.ts calls track's
    # copy "the same shape and same answer" and, until this file, nothing compared them.
    results["C3 track's clock drifts alone"] = control(
        "C3  month: 'short' -> 'long' in TRACK's formatWhen only",
        [(TRACK_FMT, "month: 'short',", "month: 'long',")],
        predicted=CASE_ONE_CLOCK, must_stay_green=CASE_EXACT,
    )

    # C4 — the shared package's UTC rule loses its pin. The must-stay-green companion earning its
    # keep in the other direction: it has a catcher of its own. Scoped to apps/web deliberately,
    # so packages/ui's OWN unit test cannot supply the red and make CAUGHT unfalsifiable.
    results["C4 formatDay loses its UTC pin"] = control(
        "C4  timeZone: 'UTC' removed from packages/ui formatDay",
        [(UI_FMT, ", timeZone: 'UTC' }", " }")],
        predicted=CASE_UTC_DAY, must_stay_green=CASE_EXACT,
    )

    # C5 — THE PIN ITSELF, the half of this merge that is not a test file. Without it the gate's
    # answer is the developer's location.
    results["C5 the TZ pin is removed"] = control(
        "C5  env: { TZ } deleted from apps/web/vitest.config.ts",
        [(WEB_CFG, "    env: { TZ: 'Pacific/Kiritimati' },\n", "")],
        predicted=CASE_EXACT, must_stay_green=CASE_UTC_DAY,
    )

    print("\n──────── SUMMARY ────────")
    for k, v in results.items():
        print(f"  {'PASS' if v else 'FAIL'}  {k}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
