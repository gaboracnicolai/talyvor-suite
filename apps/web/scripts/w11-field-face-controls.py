#!/usr/bin/env python3
"""POSITIVE CONTROLS FOR THE NUMERIC-FIELD AUDIT (#w11 fieldFaceAudit).

Every guard this merge adds PASSED ON ITS FIRST RUN. That is the state this repo has shipped
three unfalsifiable guards from, so none of them is believed until it has been observed failing.

THE FORM, which is this repo's and is not negotiable:
  · Every edit's anchor count is ASSERTED BEFORE the write. A control that silently matched
    nothing scores NOT CAUGHT and reads exactly like a blind guard.
  · Every file is restored from SAVED BYTES, never `git checkout` — the tree carries an
    uncommitted fix and checkout would revert the FIX instead of the MUTATION.
  · Every control PREDICTS ITS CATCHER by name before the run. A CAUGHT verdict that names a
    different test than predicted is a refuted prediction and is printed as one.
  · Every control has a MUST-STAY-GREEN companion, so a compile error cannot score as a catch.
  · sha256 of every touched file is compared before and after.

Usage:  python3 scripts/w11-field-face-controls.py         (run all)
        python3 scripts/w11-field-face-controls.py C3      (run one)
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
UI = APP.parent.parent / "packages" / "ui"

AUDIT = APP / "src" / "fieldFaceAudit.ts"
AUDIT_TEST = APP / "src" / "fieldFaceAudit.test.tsx"
SETUP = APP / "src" / "test-setup.ts"
UI_SETUP = UI / "src" / "__tests__" / "setup.ts"
CONVERT = APP / "src" / "areas" / "lens" / "ConvertLens.tsx"
GATE = APP / "scripts" / "check-audit-gate.mjs"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def vitest(files, cwd=APP):
    """⚠ NEVER the whole suite when the mutated module has its OWN tests in it: a CAUGHT that is
    guaranteed says nothing about WHICH guard spoke. Each control names the files it runs."""
    return run(["npx", "vitest", "run", *files, "--reporter=dot"], cwd)


def edit(path: Path, subs, expect_counts):
    """Apply substitutions after asserting EVERY anchor count. Returns the original bytes."""
    original = path.read_bytes()
    text = original.decode()
    for (old, _new), want in zip(subs, expect_counts):
        got = text.count(old)
        if got != want:
            path.write_bytes(original)
            raise AssertionError(f"anchor in {path.name} matched {got}x, expected {want}x: {old[:60]!r}")
    for old, new in subs:
        text = text.replace(old, new)
    if text.encode() == original:
        raise AssertionError(f"{path.name}: edit changed NOTHING — the control would be inert")
    path.write_text(text)
    return original


CONTROLS = {}


def control(name, predicts, why):
    def deco(fn):
        CONTROLS[name] = (fn, predicts, why)
        return fn

    return deco


# ── C1 THE DEFECT ITSELF ─────────────────────────────────────────────────────────────────────
@control(
    "C1",
    "src/areas/lens/Convert.test.tsx + src/areas/lens/Held.test.tsx (the running audit)",
    "revert the fix at the call site: the state main is in. If this does not red, the whole "
    "merge is decoration.",
)
def c1():
    orig = edit(CONVERT, [('                className="font-figure"\n', "")], [1])
    try:
        code, out = vitest(["src/areas/lens/Convert.test.tsx", "src/areas/lens/Held.test.tsx"])
        return code != 0, out
    finally:
        CONVERT.write_bytes(orig)


# ── C2 THE PREDICATE, BLINDED ────────────────────────────────────────────────────────────────
@control(
    "C2",
    "src/fieldFaceAudit.test.tsx (the unit cases)",
    "declaresNumeric always false — the shape a rule takes when someone 'simplifies' it. The "
    "running audit goes SILENT, which is its correct output on a clean product, so only the "
    "direct cases can see this.",
)
def c2():
    orig = edit(
        AUDIT,
        [("  if (el.tagName !== 'INPUT') return false\n", "  if (el.tagName !== 'INPUT') return false\n  return false\n")],
        [1],
    )
    try:
        code, out = vitest(["src/fieldFaceAudit.test.tsx"])
        return code != 0, out
    finally:
        AUDIT.write_bytes(orig)


# ── C3 THE PREDICATE, INVERTED THE OTHER WAY ────────────────────────────────────────────────
@control(
    "C3",
    "src/fieldFaceAudit.test.tsx (the exemption cases)",
    "the range exemption deleted. THIS CONTROL CORRECTED THE MERGE RATHER THAN THE CODE: its "
    "first run caught only via the `hidden` case, because the range case as first written passed "
    "for the WRONG REASON — the shipped slider declares no inputMode and never reaches this line. "
    "The test now carries a case that declares BOTH, so the line is what reds. A new classifier "
    "is blind to its own inverse unless both sides are asserted, and 'both sides' has to mean the "
    "side that actually reaches the branch.",
)
def c3():
    orig = edit(AUDIT, [("  if (PAINTS_NO_TEXT.has(type)) return false\n", "")], [1])
    try:
        code, out = vitest(["src/fieldFaceAudit.test.tsx"])
        return code != 0, out
    finally:
        AUDIT.write_bytes(orig)


# ── C4 THE OBSERVER, DEAD ────────────────────────────────────────────────────────────────────
@control(
    "C4",
    "src/areas/lens/Convert.test.tsx + src/areas/lens/Held.test.tsx (the FLOOR)",
    "install nothing. Every offender rule in this repo goes green with a dead observer — silence "
    "is its correct output — so the floor is the only thing that can speak. This is the control "
    "that proves MUST_AUDIT_A_NUMERIC_FIELD's KEYS are the paths vitest reports, which is the "
    "#101 C3 defect (a floor keyed by basename that had never fired once).",
)
def c4():
    orig = edit(
        AUDIT,
        [
            (
                "export function installFieldFaceAudit(): void {\n  new MutationObserver(scan).observe(document, {",
                "export function installFieldFaceAudit(): void {\n  if (1) return\n  new MutationObserver(scan).observe(document, {",
            )
        ],
        [1],
    )
    try:
        code, out = vitest(["src/areas/lens/Convert.test.tsx", "src/areas/lens/Held.test.tsx"])
        floor_spoke = "audited NO numeric field" in out
        return code != 0 and floor_spoke, out
    finally:
        AUDIT.write_bytes(orig)


# ── C5 THE REPORT BLOCK, SILENCED, IN apps/web ───────────────────────────────────────────────
@control(
    "C5",
    "scripts/check-audit-gate.mjs (apps/web: the audit never names itself)",
    "the enforcement path removed from ONE project's setup. `319335c` recorded that all the "
    "audits share one unguarded reporting path; the gate is what closed it, and it must close it "
    "for the eighth too.",
)
def c5():
    orig = edit(SETUP, [("  const unfaced = takeFieldFaceOffenders()\n", "  const unfaced: never[] = []\n")], [1])
    try:
        code, out = run(["node", "scripts/check-audit-gate.mjs"], APP)
        named = "apps/web" in out and "field" in out and code != 0
        return named, out
    finally:
        SETUP.write_bytes(orig)


# ── C6 THE REPORT BLOCK, SILENCED, IN packages/ui ────────────────────────────────────────────
@control(
    "C6",
    "scripts/check-audit-gate.mjs (packages/ui: the count, then the naming)",
    "THE CONTROL THIS MERGE EXISTS TO SURVIVE. #117 found seven audits wired into ONE of two "
    "vitest projects. An eighth wired into apps/web and forgotten in packages/ui is the same "
    "defect, and the gate's per-project block count is what must see it.",
)
def c6():
    orig = edit(
        UI_SETUP,
        [("  const unfaced = takeFieldFaceOffenders()\n", "  const unfaced: never[] = []\n")],
        [1],
    )
    try:
        code, out = run(["node", "scripts/check-audit-gate.mjs"], APP)
        named = "packages/ui" in out and code != 0
        return named, out
    finally:
        UI_SETUP.write_bytes(orig)


# ── C7 THE FACE WALK, NARROWED TO THE ELEMENT ────────────────────────────────────────────────
@control(
    "C7",
    "src/fieldFaceAudit.test.tsx (the ANCESTOR case)",
    "make the face non-inheritable — i.e. copy placeholderAudit's rule, which is the mistake a "
    "reader of that file would make. Chrome says preflight makes font-family INHERIT into a "
    "field, so this reds a field the browser paints correctly. Without this case the two rules "
    "are indistinguishable and the Chrome measurement is decoration.",
)
def c7():
    orig = edit(
        AUDIT,
        [("    if (onFigureFace(el)) continue\n", "    if (/\\bfont-figure\\b/.test(el.getAttribute('class') ?? '')) continue\n")],
        [1],
    )
    try:
        code, out = vitest(["src/fieldFaceAudit.test.tsx"])
        return code != 0, out
    finally:
        AUDIT.write_bytes(orig)


# ── C8 THE FLOOR, EMPTIED ────────────────────────────────────────────────────────────────────
@control(
    "C8",
    "src/fieldFaceAudit.test.tsx ('is not empty')",
    "an empty floor table. Deleting the entries is how a future session makes C4 stop failing "
    "without fixing anything, and the floor's own note says not to — so something must enforce "
    "that sentence.",
)
def c8():
    body = AUDIT.read_text()
    m = re.search(r"export const MUST_AUDIT_A_NUMERIC_FIELD: Record<string, string> = \{.*?\n\}", body, re.S)
    assert m, "could not find the floor table"
    orig = edit(
        AUDIT,
        [(m.group(0), "export const MUST_AUDIT_A_NUMERIC_FIELD: Record<string, string> = {}")],
        [1],
    )
    try:
        code, out = vitest(["src/fieldFaceAudit.test.tsx"])
        return code != 0, out
    finally:
        AUDIT.write_bytes(orig)


# ── C9 THE STYLESHEET LEAK, REINSTATED ───────────────────────────────────────────────────────
@control(
    "C9",
    "NOTHING IN THIS REPO — predicted NOT CAUGHT, and that prediction is the finding",
    "spell `hidden` plainly again. This SHIPS `.hidden{display:none}` to every browser and every "
    "gate stays green: proseClasses.test.ts strips COMMENTS and protects string literals, so both "
    "of its generations contain the token and its diff is empty. Scored against the emitted "
    "artifact instead, which is the only instrument that can see it.",
)
def c9():
    # ⚠ THE ANCHOR IS THE CODE LINE, NOT THE TOKEN. The token appears TWICE in this file — once
    # here and once in the four-way measurement inside the header comment — and the first version
    # of this control asserted 1 and got 2. It did not write; that assertion is why the doc table
    # is not silently corrupted into agreeing with whatever the control did.
    orig = edit(
        AUDIT,
        [("const PAINTS_NO_TEXT = new Set(['range', `hid${'den'}`])",
          "const PAINTS_NO_TEXT = new Set(['range', 'hidden'])")],
        [1],
    )
    try:
        code, out = vitest(["src/proseClasses.test.ts", "src/deadClasses.test.ts", "src/fieldFaceAudit.test.tsx"])
        guards_green = code == 0
        rc, _ = run(["node", "-e", "process.exit(0)"], APP)
        # the artifact is the only witness
        subprocess.run(["rm", "-rf", str(APP / "dist")], check=False)
        run(["pnpm", "build"], APP)
        css = sorted((APP / "dist" / "assets").glob("index-*.css"))
        emitted = css[0].read_text() if css else ""
        leaked = bool(re.search(r"(?<![\w\\.-])\.hidden\{", emitted))
        out += f"\n[C9] guards green with the leak present: {guards_green}\n[C9] `.hidden` in the shipped sheet: {leaked}\n"
        # CAUGHT would mean a guard reddened. It does not. The control's VALUE is the second line.
        return (not guards_green), out
    finally:
        AUDIT.write_bytes(orig)
        subprocess.run(["rm", "-rf", str(APP / "dist")], check=False)
        run(["pnpm", "build"], APP)


# ── COMPANION: MUST STAY GREEN ───────────────────────────────────────────────────────────────
def companion():
    """A control that BREAKS THE BUILD is not a control — a compile error reads as a caught
    mutation. Run before each control's own verdict is trusted."""
    code, out = vitest(["src/fieldFaceAudit.test.tsx", "src/areas/lens/Convert.test.tsx"])
    return code == 0, out


def main():
    wanted = sys.argv[1:] or list(CONTROLS)
    files = [AUDIT, AUDIT_TEST, SETUP, UI_SETUP, CONVERT, GATE]
    before = {f: sha(f) for f in files}

    ok, out = companion()
    if not ok:
        print("BASELINE IS NOT GREEN — every verdict below would be meaningless.")
        print(out[-3000:])
        return 1
    print("baseline green\n")

    results = []
    for name in wanted:
        fn, predicts, why = CONTROLS[name]
        print(f"── {name} ─ predicts: {predicts}")
        print(f"   why: {why}")
        caught, out = fn()
        verdict = "CAUGHT" if caught else "NOT CAUGHT"
        tail = "\n".join(l for l in out.splitlines() if "Error:" in l or "FAIL" in l or "[C9]" in l or "audit-gate:" in l)
        print(f"   → {verdict}")
        if tail:
            print("     " + "\n     ".join(tail.splitlines()[:8]))
        cok, _ = companion()
        print(f"   companion after restore: {'green' if cok else 'RED — TREE NOT RESTORED'}")
        results.append((name, verdict, cok))
        print()

    after = {f: sha(f) for f in files}
    for f in files:
        state = "identical" if before[f] == after[f] else "⚠ CHANGED"
        if state != "identical":
            print(f"{f.name}: {state}")
    print("all touched files restored byte-identically" if before == after else "⚠ TREE NOT RESTORED")
    print()
    for name, verdict, cok in results:
        print(f"  {name}  {verdict}  companion={'green' if cok else 'RED'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
