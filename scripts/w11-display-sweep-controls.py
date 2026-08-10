#!/usr/bin/env python3
"""
POSITIVE CONTROLS for displayScale.test.ts's sweep — W1.1, tab-2e7b.

THE DEFECT UNDER CONTROL. The file spelled "behind the gate" twice. `7513c91` moved every console
page into a `CONSOLE_ROUTES` table, which empties the JSX reader the SWEEP used, while the floor
test used the union and stayed green. Measured at `298b659`: floor closure 67 files, sweep closure
0. This harness exists because the fix — one memoised `gatedFiles()` read by both — made the sweep
PASS ON ITS FIRST RUN, which is the state this queue treats as suspect until controlled.

EVERY CONTROL, WITHOUT EXCEPTION:
  · asserts its anchor COUNT in the file BEFORE any write (a control that silently matches nothing
    reports NOT CAUGHT and reads as a dead guard — see the C2 note in `47486d3`);
  · verifies the bytes on disk actually changed after the write;
  · names a MUST-RED target AND a MUST-STAY-GREEN companion. Both red is SUSPECT, not CAUGHT —
    a control that breaks the build is not a control;
  · restores the tree byte-identically and verifies it against git.

⚠ C1c IS THE ONE THAT EARNS THE MERGE. C1a shows the FIXED sweep catches a planted offender — that
would also be true of a sweep that had never been broken, so it is necessary and not sufficient.
C1c restores the pre-fix reader AND removes the floor this merge adds, reproducing main exactly, and
asserts the same offender sails through GREEN. That is the defect reproduced rather than described.
C1b sits between them: reader re-split but floor present, which must red ON THE FLOOR.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web"

GUARD = REPO / "apps/web/src/displayScale.test.ts"
ISSUE_DETAIL = REPO / "apps/web/src/areas/track/IssueDetail.tsx"
LANDING = REPO / "apps/web/src/areas/marketing/Landing.tsx"
CARD = REPO / "packages/ui/src/components/Card.tsx"
PRIVACY = REPO / "apps/web/src/routes/Privacy.tsx"

SWEEP_TEST = "no console surface reaches for it"

# The exact pre-fix expression, restored verbatim from `8555e1e`.
FIXED_READER = "const gated = [...gatedFiles()].sort()"
BROKEN_READER = "const gated = [...closure(entryFiles(routedComponents(shellBlock ?? '')))].sort()"


@dataclass
class Edit:
    path: Path
    old: str
    new: str
    expect_count: int = 1


@dataclass
class Control:
    name: str
    why: str
    edits: list[Edit]
    must_red: str          # vitest -t filter that MUST fail
    must_green: str        # vitest -t filter that MUST still pass
    expect_red: bool = True
    green_file: Path = field(default=GUARD)
    red_file: Path = field(default=GUARD)


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_vitest(target: Path, name_filter: str) -> tuple[bool, str]:
    """True if the filtered tests PASSED. Also returns output for the report."""
    rel = target.relative_to(WEB) if target.is_relative_to(WEB) else target
    proc = subprocess.run(
        ["npx", "vitest", "run", str(rel), "-t", name_filter],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    # ⚠ DO NOT TRUST THE EXIT CODE ALONE: vitest exits non-zero when a -t filter matches NOTHING,
    # which would read as "caught" for every control. Require that tests actually ran.
    ran = "Tests " in out and "no test found" not in out.lower()
    if not ran:
        raise SystemExit(f"vitest ran no test for filter {name_filter!r} on {rel}\n{out[-2000:]}")
    return proc.returncode == 0, out


def apply_edits(edits: list[Edit]) -> None:
    for e in edits:
        src = e.path.read_text()
        found = src.count(e.old)
        if found != e.expect_count:
            raise SystemExit(
                f"ANCHOR MISS in {e.path.relative_to(REPO)}: expected {e.expect_count} "
                f"occurrence(s) of {e.old[:70]!r}, found {found}. "
                "Refusing to run — an unapplied control reports NOT CAUGHT and lies about the guard."
            )
        before = sha(e.path)
        e.path.write_text(src.replace(e.old, e.new))
        if sha(e.path) == before:
            raise SystemExit(f"WRITE DID NOT CHANGE BYTES in {e.path.relative_to(REPO)}")


def git_restore(paths: set[Path]) -> None:
    subprocess.run(
        ["git", "checkout", "--"] + [str(p.relative_to(REPO)) for p in paths],
        cwd=REPO,
        check=True,
    )


CONTROLS: list[Control] = [
    Control(
        name="C1a  planted offender, FIXED reader",
        why="a console surface reaching for display type is the defect the file exists to refuse",
        edits=[Edit(ISSUE_DETAIL, '<h1 className="text-title text-ink">', '<h1 className="text-display-3 text-ink">')],
        must_red=SWEEP_TEST,
        must_green="the scale is still in use on the public page",
    ),
    Control(
        name="C1b  planted offender, PRE-FIX reader, floor PRESENT",
        why="re-splitting the definition must red on the sweep's OWN floor rather than going quiet",
        edits=[
            Edit(ISSUE_DETAIL, '<h1 className="text-title text-ink">', '<h1 className="text-display-3 text-ink">'),
            Edit(GUARD, FIXED_READER, BROKEN_READER),
        ],
        # The sweep's own floor is what speaks now. It MUST red — but on the FLOOR, not the offender.
        must_red=SWEEP_TEST,
        must_green="the two closures reach real files",
    ),
    Control(
        name="C1c  planted offender, PRE-FIX reader AND the sweep's floor blinded",
        why="the exact state main was in: reader empty, nothing asserting it read anything. MUST NOT CATCH.",
        edits=[
            Edit(ISSUE_DETAIL, '<h1 className="text-title text-ink">', '<h1 className="text-display-3 text-ink">'),
            Edit(GUARD, FIXED_READER, BROKEN_READER),
            Edit(GUARD, "expect(gated.length, 'the sweep below reached no files", "expect(gated.length + 99, 'the sweep below reached no files"),
            Edit(
                GUARD,
                "for (const f of ['areas/track/IssueDetail.tsx', 'areas/lens/Overview.tsx']) {\n      expect(gated.some((p) => p.endsWith(f)), `${f} is routed behind the gate but the SWEEP's closure missed it`).toBe(true)\n    }",
                "",
            ),
        ],
        must_red=SWEEP_TEST,
        must_green="the two closures reach real files",
        expect_red=False,  # ⚠ EXPECTED NOT CAUGHT — this reproduces main, and main was green.
    ),
    Control(
        name="C2   offender on a PUBLIC-ONLY page",
        why=(
            "the boundary is one-directional. ⚠ Landing would have been the lazy target and it "
            "proves nothing — it ALREADY carries all six steps, so the no-change would say nothing "
            "about the sweep. Privacy is routed publicly and carries none, so the edit is the only "
            "marketing step in the file."
        ),
        edits=[Edit(PRIVACY, '<div className="mx-auto w-full max-w-3xl px-gutter py-10">', '<div className="text-lede mx-auto w-full max-w-3xl px-gutter py-10">')],
        must_red=SWEEP_TEST,
        must_green="the scale is still in use on the public page",
        expect_red=False,
    ),
    Control(
        name="C3   offender in a SHARED packages/ui component",
        why="a design-system component renders on both sides, so it is in the gated closure too",
        edits=[Edit(CARD, "'flex items-center justify-between gap-gutter", "'text-lede flex items-center justify-between gap-gutter")],
        must_red=SWEEP_TEST,
        must_green="the scale is still in use on the public page",
    ),
    Control(
        name="C4   offender in a COMMENT in a gated file",
        why="stripComments is load-bearing; prose about a class is not a use of it (the W1.8 trap)",
        edits=[Edit(ISSUE_DETAIL, '<h1 className="text-title text-ink">', '{/* never text-display-3 here */}\n          <h1 className="text-title text-ink">')],
        must_red=SWEEP_TEST,
        must_green="the detector tells a class from a sentence about one",
        expect_red=False,
    ),
    Control(
        name="C5   the FAMILY, not the size, in a gated file",
        why="`font-figure` is what eight money surfaces wear; a /figure/ detector would red them all",
        edits=[Edit(ISSUE_DETAIL, '<h1 className="text-title text-ink">', '<h1 className="font-figure text-title text-ink">')],
        must_red=SWEEP_TEST,
        must_green="the detector tells a class from a sentence about one",
        expect_red=False,
    ),
    Control(
        name="C6   CONSOLE_ROUTES renamed — the seam moves again",
        why="the next router refactor must red loudly, not empty the closure the way `7513c91` did",
        edits=[Edit(REPO / "apps/web/src/App.tsx", "CONSOLE_ROUTES", "CONSOLE_PAGES", expect_count=-1)],
        must_red=SWEEP_TEST,
        must_green="the detector tells a class from a sentence about one",
    ),
]


def main() -> int:
    if subprocess.run(["git", "diff", "--quiet"], cwd=REPO).returncode != 0:
        print("⚠ working tree is dirty — commit or stash first; restore-verification needs a clean base")
        return 2

    baseline = {p: sha(p) for p in {GUARD, ISSUE_DETAIL, LANDING, CARD, PRIVACY, REPO / "apps/web/src/App.tsx"}}
    results: list[tuple[str, bool, str]] = []

    for c in CONTROLS:
        touched = {e.path for e in c.edits}
        # C6 uses a repo-wide rename count discovered at run time rather than a guessed literal.
        for e in c.edits:
            if e.expect_count == -1:
                e.expect_count = e.path.read_text().count(e.old)
                if e.expect_count == 0:
                    raise SystemExit(f"{c.name}: anchor {e.old!r} occurs 0 times")
        try:
            apply_edits(c.edits)
            red_passed, red_out = run_vitest(c.red_file, c.must_red)
            green_passed, _ = run_vitest(c.green_file, c.must_green)
            caught = not red_passed
            ok = (caught == c.expect_red) and green_passed
            if not green_passed:
                verdict = "SUSPECT — companion went red too; this control breaks the build rather than tripping the guard"
            elif caught and c.expect_red:
                first = next((l.strip() for l in red_out.splitlines() if "→" in l), "")
                verdict = f"CAUGHT — {first[:150]}"
            elif not caught and not c.expect_red:
                verdict = "NOT CAUGHT, as designed"
            elif caught and not c.expect_red:
                verdict = "FALSE POSITIVE — guard red on something it must permit"
            else:
                verdict = "NOT CAUGHT — the guard is blind to this"
            results.append((c.name, ok, verdict))
        finally:
            git_restore(touched)

    for p, h in baseline.items():
        if sha(p) != h:
            print(f"⚠ TREE NOT RESTORED: {p.relative_to(REPO)}")
            return 2

    print("\n" + "=" * 100)
    print("W1.1 tab-2e7b — displayScale sweep control matrix   (tree restored byte-identically)")
    print("=" * 100)
    for name, ok, verdict in results:
        print(f"  [{'ok ' if ok else 'FAIL'}] {name}\n         {verdict}")
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n  {passed}/{len(results)} controls behaved as designed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
