#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE CASE AUDIT (W1.1, µ under text-transform:uppercase).

Every control does four things, in this order, because each one has caught a different way a
"control" lies:

  1. ASSERT THE ANCHOR COUNT BEFORE EDITING. A substitution that matches nothing edits zero bytes
     and is byte-indistinguishable from a guard that works (talyvor-track #71, paid for twice).
  2. Run the test(s) that MUST GO RED and require them to fail.
  3. Run a test that MUST STAY GREEN, so a control cannot pass by breaking the build — a compile
     error reds everything and reads as a caught mutation (talyvor-track #74 control C1).
  4. Restore and verify sha256 is identical to before.

Run from the repo root:  python3 scripts/w11-case-controls.py
"""

import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "apps/web"

LANDING = ROOT / "apps/web/src/areas/marketing/Landing.tsx"
LANDING_TEST = ROOT / "apps/web/src/areas/marketing/Landing.test.tsx"
MUNUMERAL = ROOT / "packages/ui/src/components/MuNumeral.tsx"
AUDIT = ROOT / "apps/web/src/caseAudit.ts"
CASESAFE = ROOT / "packages/ui/src/components/CaseSafe.tsx"
LEDGER_TEST = "src/areas/lens/Ledger.test.tsx"
AUDIT_TEST = "src/caseAudit.test.tsx"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_tests(*files: str) -> tuple[bool, str]:
    """True when the run PASSED."""
    r = subprocess.run(
        ["npx", "vitest", "run", *files],
        cwd=WEB, capture_output=True, text=True,
    )
    return r.returncode == 0, r.stdout + r.stderr


class Control:
    def __init__(self, name: str, edits: list[tuple[Path, str, str, int]],
                 must_red: list[str], must_green: list[str], why: str,
                 must_mention: str | None = None):
        self.name, self.edits = name, edits
        self.must_red, self.must_green, self.why = must_red, must_green, why
        # ⚠ WHAT THE RED MUST SAY. A red from a DIFFERENT rule is not evidence about this one:
        # regressing MuNumeral cascades into the FIGURE floor, and a control that accepted any
        # failure would have credited the case audit for a figure guard's work.
        self.must_mention = must_mention

    def apply(self) -> None:
        """
        ⚠ ACCUMULATE PER FILE, then assert every anchor count BEFORE writing anything.

        The first version of this harness recomputed each edit from the file as read at the START of
        the loop, so for a control with TWO edits in ONE file the second write silently discarded
        the first. C6 and C8 both ran half-applied and C6 reported the guard blind — it is not; the
        same mutation applied by hand reds two ways. A control that applies half of itself is the
        #71 no-op lesson with a second door.
        """
        staged: dict[Path, str] = {}
        for path, old, new, expect in self.edits:
            src = staged.get(path, path.read_text())
            n = src.count(old)
            if n != expect:
                raise AssertionError(
                    f"{self.name}: anchor count {n}, expected {expect}, in {path.name} "
                    f"for {old[:60]!r} — CONTROL NOT RUN"
                )
            staged[path] = src.replace(old, new)
        for path, after in staged.items():
            path.write_text(after)


CONTROLS = [
    Control(
        "C1 regress the marketing fix — the shipped defect comes back",
        [(LANDING, "<CaseSafe>{unit}</CaseSafe>", "{unit}", 1)],
        must_red=["src/areas/marketing/Landing.test.tsx"],
        must_green=[AUDIT_TEST],
        why="the six µ unit labels are unprotected again; the audit must name them",
        must_mention='U+00B5 "µ" becomes "Μ"',
    ),
    Control(
        "C2 regress MuNumeral — the one site that was already right",
        # ⚠ THE BLINDING IS BEHAVIOURAL, NOT A COMPILE ERROR. The first attempt substituted a bare
        # `µ`, which in `{micro ? µ : null}` is an IDENTIFIER, not text — the module failed to
        # evaluate, every test in the file went red, and the FIGURE floor's cascade was reported as
        # the case audit's catch. A control that cannot tell "the guard caught it" from "nothing
        # ran" is not a control (talyvor-track #74, C1). The string literal renders the same µ.
        [(MUNUMERAL, "<CaseSafe>µ</CaseSafe>", "'µ'", 1)],
        must_red=[LEDGER_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="the µ inherits the uppercase unit label; offender AND the floor both fire",
        must_mention='U+00B5 "µ" becomes "Μ"',
    ),
    Control(
        "C3 blind the audit — every element reports no transform in effect",
        [(AUDIT,
          "    const declared = declaredTransformOn(e)\n    if (declared !== null) return { transform: declared, from: e }",
          "    const declared = declaredTransformOn(e)\n    if (false && declared !== null) return { transform: declared, from: e }",
          1)],
        must_red=[LEDGER_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="offenders drop to zero; ONLY the floor can notice, and it must",
        must_mention="audited NO µ under a live casing transform",
    ),
    Control(
        "C4 narrow the predicate to length-changes only — µ stops being hazardous",
        [(AUDIT, "  if (mapped.length !== 1) return true\n  return mapped.toLowerCase() !== ch",
          "  if (mapped.length !== 1) return true\n  return false", 1)],
        must_red=[AUDIT_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="rule 2's hand-pinned vocabulary is the only thing that can see this",
    ),
    Control(
        "C5 narrow BOTH implementations together — the shared-blindness attempt",
        [(AUDIT, "  if (mapped.length !== 1) return true\n  return mapped.toLowerCase() !== ch",
          "  if (mapped.length !== 1) return true\n  return false", 1),
         (CASESAFE, "  if (mapped.length !== 1) return true\n  return mapped.toLowerCase() !== ch",
          "  if (mapped.length !== 1) return true\n  return false", 1)],
        must_red=[AUDIT_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="narrowing guard and fix in step is the one edit that could go quietly green",
    ),
    Control(
        "C6 invert inheritance — the FARTHEST declaration wins instead of the nearest",
        [(AUDIT,
          "    const declared = declaredTransformOn(e)\n    if (declared !== null) return { transform: declared, from: e }\n  }\n  return { transform: 'none', from: null }",
          "    const declared = declaredTransformOn(e)\n    if (declared !== null) last = { transform: declared, from: e }\n  }\n  return last ?? { transform: 'none', from: null }",
          1),
         (AUDIT, "export function transformInEffect(el: Element | null): { transform: Transform; from: Element | null } {",
          "export function transformInEffect(el: Element | null): { transform: Transform; from: Element | null } {\n  let last: { transform: Transform; from: Element | null } | null = null",
          1)],
        must_red=[LEDGER_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="normal-case-inside-uppercase is the whole mechanism; reading it backwards must fail",
        must_mention='U+00B5 "µ" becomes "Μ"',
    ),
    Control(
        "C7 drop normal-case from the fix — a class that sets no text-transform",
        [(CASESAFE, '<span key={i} className="normal-case">',
           '<span key={i} className="tal-not-a-case-class">', 1)],
        must_red=[LEDGER_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="the CLASS NAME is load-bearing, not the wrapping span",
        must_mention='U+00B5 "µ" becomes "Μ"',
    ),
    Control(
        "C8 the floor's threat half — protection without anything to protect from",
        [(AUDIT,
          "  if (!from) return false // nothing declared anywhere: untouched prose",
          "  if (!from) return false // nothing declared anywhere: untouched prose\n  return true",
          1),
         (AUDIT,
          "    const declared = declaredTransformOn(e)\n    if (declared !== null) return { transform: declared, from: e }",
          "    const declared = declaredTransformOn(e)\n    if (false && declared !== null) return { transform: declared, from: e }",
          1)],
        must_red=[AUDIT_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="this is the bug my own test caught: with it, C3's blinding goes GREEN",
        must_mention="protected",
    ),
    Control(
        "C9 write U+03BC into product CODE — the hole closed from the other side",
        [(LANDING, "const CONTACT_MAILTO = ",
           "const GREEK_SPELLED = '\u03bc'\nconst CONTACT_MAILTO = ", 1)],
        must_red=[AUDIT_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="a µ typed as U+03BC would be uppercased with no offender reported",
        must_mention="Landing.tsx",
    ),
    Control(
        "C10 U+03BC in a COMMENT must NOT fire — the rule is about code",
        [(LANDING, "const CONTACT_MAILTO = ",
           "// a \u03bc in prose about the rule\nconst CONTACT_MAILTO = ", 1)],
        must_red=[],  # nothing may go red
        must_green=[AUDIT_TEST, "src/EmptyStates.test.tsx"],
        why="without this the sweep is the W1.8 trap and every explanation of it is a failure",
    ),
    Control(
        "C11 break the sweep's roots — a reader that opens nothing must throw, not pass",
        [(  # the walk is over apps/web/src and packages/ui/src; point one at nothing
            ROOT / "apps/web/src/caseAudit.test.tsx",
            "resolve(repoRoot, 'packages/ui/src')",
            "resolve(repoRoot, 'packages/ui/src-gone')", 2)],
        must_red=[AUDIT_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="a zero from a sweep that read nothing looks exactly like a clean sweep (W4.5)",
        must_mention="U+03BC in CODE",
    ),
    Control(
        "C12 remove the stepper test — three of the six defects go back out of reach",
        [(LANDING, "<CaseSafe>{unit}</CaseSafe>", "{unit}", 1),
         (LANDING_TEST, "fireEvent.click(screen.getByRole('button', { name: label }))",
          "// control: do not advance the stepper", 1)],
        must_red=["src/areas/marketing/Landing.test.tsx"],
        must_green=[AUDIT_TEST],
        why="MEASURED, not asserted: 3 offenders without the stepper test, 6 with it",
        must_mention='U+00B5 "µ" becomes "Μ"',
    ),
    Control(
        "C13 use an UNCLASSIFIED casing utility in a real class list — the refusal must fire",
        [(ROOT / "apps/web/src/areas/track/TrackArea.tsx",
          'uppercase text-faint">Workspace',
          'uppercase capitalize text-faint">Workspace', 1)],
        must_red=[AUDIT_TEST],
        must_green=["src/EmptyStates.test.tsx"],
        why="the audit models two of Tailwind's four; a third must fail until classified",
        must_mention="capitalize",
    ),
]


def main() -> int:
    only = sys.argv[1:]
    failures = []
    for c in CONTROLS:
        if only and not any(c.name.startswith(o) for o in only):
            continue
        before = {p: (p.read_text(), sha(p)) for p, _, _, _ in c.edits}
        print(f"\n=== {c.name}\n    {c.why}")
        try:
            c.apply()
        except AssertionError as e:
            print(f"    ✗ {e}")
            failures.append(c.name)
            for p, (text, _) in before.items():
                p.write_text(text)
            continue

        try:
            ok = True
            for f in c.must_red:
                passed, out = run_tests(f)
                if passed:
                    print(f"    ✗ {f} STAYED GREEN — the guard cannot see this mutation")
                    ok = False
                elif c.must_mention and c.must_mention not in out:
                    # ⚠ RED FOR THE WRONG REASON IS NOT EVIDENCE. Regressing MuNumeral cascades into
                    # the FIGURE floor, so a control that accepted any failure would have credited
                    # this audit with a different guard's catch.
                    print(f"    ✗ {f} went red but never said {c.must_mention!r} — "
                          "that red belongs to another rule")
                    ok = False
                else:
                    names = sorted({
                        line.strip() for line in out.splitlines()
                        if "U+00B5" in line or "audited NO" in line or "U+03BC" in line
                    })
                    print(f"    ✓ RED {f}" + (f"  (says {c.must_mention!r})" if c.must_mention else ""))
                    for n in names[:8]:
                        print(f"        {n[:150]}")
            for f in c.must_green:
                passed, out = run_tests(f)
                if not passed:
                    print(f"    ✗ {f} WENT RED TOO — this control breaks the build, it is not a control")
                    ok = False
                else:
                    print(f"    ✓ still green {f}")
            if not ok:
                failures.append(c.name)
        finally:
            for p, (text, digest) in before.items():
                p.write_text(text)
                assert sha(p) == digest, f"{p} NOT RESTORED byte-identically"
            print("    ✓ restored sha256-identical")

    print("\n" + "=" * 78)
    if failures:
        print(f"CONTROLS THAT DID NOT DO THEIR JOB ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"ALL {len(CONTROLS)} CONTROLS FIRED, none blind, every file restored sha256-identical.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
