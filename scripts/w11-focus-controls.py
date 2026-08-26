#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE FOCUS AUDIT (W1.1).

A guard that has never been observed failing is a guard nobody has tested. Each control below
injects ONE defect the audit claims to catch, runs the tests, and requires:

  1. an ANCHOR COUNT asserted BEFORE the edit — `dc0bd07` had two controls that silently did
     nothing (counts of 5 and 0 where 1 was expected) and would have been written down as
     evidence. A control that no-ops is worse than no control.
  2. the run to go RED, and the red to SAY THE THING IT IS SUPPOSED TO SAY — `89bd58d`'s C2
     reddened every test in a file for an unrelated reason and was about to be recorded as this
     audit's catch. A marker string is required in the output.
  3. a named test that must STAY GREEN in the same run — otherwise a syntax error reads as a
     caught mutation.
  4. the file restored SHA256-IDENTICAL afterwards.

⚠ EVERY EDIT IN A CONTROL IS APPLIED TO THE ACCUMULATED TEXT, NOT RECOMPUTED FROM THE ORIGINAL.
Two edits in one file computed independently means the second write discards the first — that is
how `89bd58d`'s C6 reported a working guard as blind.

Run:  python3 scripts/w11-focus-controls.py
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "apps" / "web"

AUDIT = "apps/web/src/focusAudit.ts"
AUDIT_TEST = "apps/web/src/focusAudit.test.tsx"
SETUP = "apps/web/src/test-setup.ts"
FOCUS = "packages/ui/src/lib/focus.ts"
ISSUE_DETAIL = "apps/web/src/areas/track/IssueDetail.tsx"
LANDING = "apps/web/src/areas/marketing/Landing.tsx"
SPACELIST = "apps/web/src/areas/docs/SpaceList.tsx"
BUTTON = "packages/ui/src/components/Button.tsx"

# Test files, per control, kept as small as the claim allows so the campaign finishes.
T_AUDIT = "src/focusAudit.test.tsx"
T_ISSUE = "src/areas/track/IssueDetail.test.tsx"
T_LANDING = "src/areas/marketing/Landing.test.tsx"
T_DOCS = "src/areas/docs/DocsArea.test.tsx"
T_KEYS = "src/areas/lens/Keys.test.tsx"


@dataclass
class Control:
    name: str
    why: str
    #  (path, anchor, replacement, expected_count)
    edits: list[tuple[str, str, str, int]]
    tests: list[str]
    #  A substring the FAILURE OUTPUT must contain — the red has to say the right thing.
    marker: str
    #  A test name that must still PASS in the same run, so a broken build is not read as a catch.
    stays_green: str
    expect: str = "red"
    extra: list[str] = field(default_factory=list)


CONTROLS: list[Control] = [
    Control(
        "C1 regress a fixed control (Track description editor)",
        "the merge's own fix must be what keeps it green",
        [(ISSUE_DETAIL, " ${focusRing}`}", "`}", 1)],
        [T_ISSUE],
        "keyboard-focusable element(s) with no accent focus ring",
        "a ticket can be worked",
    ),
    Control(
        "C2 regress a fixed control in the OTHER area (marketing pool slider)",
        "one area passing does not mean the audit rides every surface",
        [(LANDING, "`tal-range mt-2 w-full ${focusRing}`", "'tal-range mt-2 w-full'", 1)],
        [T_LANDING],
        "tal-range",
        "renders standalone",
    ),
    Control(
        "C3 restore the hand-rolled PARTIAL ring on the space row",
        "half a ring reads as a ring in review; Chrome renders it 1px at offset 0",
        # ⚠ RE-ANCHORED AT W1.1.19: the space row gained `transition-colors duration-200` when
        # SpaceList was rebuilt (W1.1.9a), so this anchor matched nothing and the control could not
        # arm. The DEFECT is unchanged — a hand-rolled PARTIAL ring in place of the token — and the
        # transition classes are carried through it so the mutation changes only the ring.
        [(SPACELIST, "`cursor-pointer transition-colors duration-200 hover:bg-canvas ${focusRing}`",
          "'cursor-pointer transition-colors duration-200 outline-accent hover:bg-canvas focus-visible:outline'", 1)],
        [T_DOCS],
        "carries only focus-visible:outline",
        "renders one row per space",
    ),
    Control(
        "C4 a BRAND-NEW hand-rolled control, added for the occasion",
        "'a new control is swept the moment it is rendered' is a claim in my own docstring",
        [(ISSUE_DETAIL, "<div className=\"flex gap-2\">",
          "<div className=\"flex gap-2\"><input aria-label=\"injected\" className=\"injected-control-probe\" />", 1)],
        [T_ISSUE],
        "injected-control-probe",
        "a ticket can be worked",
    ),
    Control(
        "C5 an <a> dressed as a tile — NOT underlined",
        "the exemption is a SHAPE, not a tag; this is the half that stops it widening",
        [(ISSUE_DETAIL, "<div className=\"flex gap-2\">",
          "<div className=\"flex gap-2\"><a href=\"/x\" className=\"rounded-card border p-3\">tile</a>", 1)],
        [T_ISSUE],
        "keyboard-focusable element(s) with no accent focus ring",
        "a ticket can be worked",
    ),
    Control(
        "C6 blind isKeyboardFocusable — the single edit that switches the audit off",
        "NOT the floor — measured: ringedByRawAttribute never asks this predicate. The unit tests catch it",
        [(AUDIT, "  if (!el.matches(FOCUSABLE_SELECTOR)) return false",
          "  if (!el.matches(FOCUSABLE_SELECTOR)) return false\n  return false", 1)],
        [T_AUDIT],
        "reaches a button, a link with an href, and the form controls",
        "finds the constant at all",
    ),
    Control(
        "C7 blind carriesFocusRing to always-true",
        "silences every offender AND would satisfy a floor computed from the same predicate",
        [(AUDIT, "export function carriesFocusRing(el: Element): boolean {\n  const cs = classesOf(el)",
          "export function carriesFocusRing(el: Element): boolean {\n  return true\n  const cs = classesOf(el)", 1)],
        [T_AUDIT],
        "rejects a ring missing",
        "finds the constant at all",
    ),
    Control(
        "C8 widen the exemption to EVERY anchor",
        "'anchors are exempt' is the rule this carve-out must not decay into",
        [(AUDIT, "  const cs = classesOf(el)\n  return UNDERLINE_CLASSES.some((c) => cs.includes(c))",
          "  return true", 1)],
        [T_AUDIT],
        "does NOT exempt an <a> that is not underlined",
        "finds the constant at all",
    ),
    Control(
        "C9 drop a class from the audit's vocabulary",
        "the audit and focus.ts can only agree by actually agreeing",
        [(AUDIT, "  'focus-visible:outline-offset-2',\n", "", 1)],
        [T_AUDIT],
        "every class the system ships is one this audit requires",
        "finds the constant at all",
    ),
    Control(
        "C10 change the ring in focus.ts and not in the audit",
        "the same parity, driven from the SOURCE side",
        [(FOCUS, " focus-visible:outline-offset-2", "", 1)],
        [T_AUDIT],
        "every class this audit requires is one the system ships",
        "finds the constant at all",
    ),
    Control(
        "C11 break the path the parity test reads",
        "a file-reading test must THROW, never silently skip — the usual way one goes blind",
        [(AUDIT_TEST, "'../../../packages/ui/src/lib/focus.ts'", "'../../../packages/ui/src/lib/NOPE.ts'", 1)],
        [T_AUDIT],
        "ENOENT",
        None,  # every test in the file dies with the read; that IS the point here
        extra=["expect-file-level-failure"],
    ),
    Control(
        "C12 strip focusRing out of the design system's Button",
        "the ring leaving the SYSTEM: caught by the offender rule, since every Button becomes an offender",
        [(BUTTON, "        focusRing,\n", "", 1)],
        [T_KEYS],
        "keyboard-focusable element(s) with no accent focus ring",
        None,
        extra=["expect-file-level-failure"],
    ),
    Control(
        "C13 never install the observer",
        "capture at commit time is the mechanism; a dead observer must not read as clean",
        [(SETUP, "installFocusAudit()", "// installFocusAudit()", 1)],
        [T_DOCS],
        "audited NO element wearing the accent focus ring",
        "renders one row per space",
    ),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_tests(tests: list[str]) -> tuple[int, str]:
    proc = subprocess.run(
        ["npx", "vitest", "run", *tests],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    failures: list[str] = []
    for ctl in CONTROLS:
        touched = sorted({e[0] for e in ctl.edits})
        originals = {p: (ROOT / p).read_text() for p in touched}
        shas = {p: sha(ROOT / p) for p in touched}

        # 1 — ASSERT EVERY ANCHOR BEFORE ANY WRITE.
        acc = dict(originals)
        ok = True
        for path, anchor, _repl, want in ctl.edits:
            got = acc[path].count(anchor)
            if got != want:
                failures.append(f"{ctl.name}: ANCHOR {path!r} expected {want}, found {got} — control did NOT run")
                ok = False
        if not ok:
            continue

        # 2 — apply, each edit against the ACCUMULATED text.
        for path, anchor, repl, _want in ctl.edits:
            acc[path] = acc[path].replace(anchor, repl, 1)
        for path, text in acc.items():
            (ROOT / path).write_text(text)

        try:
            code, out = run_tests(ctl.tests)
            red = code != 0
            said_it = ctl.marker in out
            green_ok = True
            if ctl.stays_green:
                # the named test must still be reported passing in the same run
                green_ok = f"✓" in out and ctl.stays_green in out
            verdict = "PASS" if (red and said_it and green_ok) else "FAIL"
            if verdict == "FAIL":
                detail = []
                if not red:
                    detail.append("stayed GREEN")
                if not said_it:
                    detail.append(f"red did not mention {ctl.marker!r}")
                if not green_ok:
                    detail.append(f"companion test {ctl.stays_green!r} did not pass")
                failures.append(f"{ctl.name}: " + "; ".join(detail))
            print(f"[{verdict}] {ctl.name}\n        {ctl.why}")
        finally:
            # 3 — restore and prove it.
            for path, text in originals.items():
                (ROOT / path).write_text(text)
            for path in touched:
                if sha(ROOT / path) != shas[path]:
                    failures.append(f"{ctl.name}: {path} NOT restored byte-identically")

    print()
    if failures:
        print("CONTROL CAMPAIGN FAILED:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"all {len(CONTROLS)} controls fired, each said the right thing, each file restored sha256-identical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
