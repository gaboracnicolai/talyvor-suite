#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE RENDERED-PLACEHOLDER GUARD (W1.1).

Every control makes ONE edit to a real file, runs a real test command, and requires three things
before it counts as a catch:

  1. THE ANCHOR COUNT IS ASSERTED BEFORE THE WRITE. `dc0bd07` shipped two controls that never ran
     — counts of 5 and 0 where 1 was expected — and reported a no-op as evidence. An anchor that
     does not match is a FAILED control here, never a silent skip.
  2. THE RED MUST SAY THE THING IT IS SUPPOSED TO SAY. `89bd58d`'s C2 reddened a whole file for an
     unrelated reason and was nearly written down as that audit's catch.
  3. A COMPANION TEST MUST STAY GREEN. A control that breaks the build reds everything, and
     "everything is red" is not evidence that this guard saw anything.

Every file is restored and its sha256 compared with the original.

⚠ THE OFFENDER RULE IS SILENT WHEN THE PRODUCT IS CORRECT, which is the state a broken predicate
is indistinguishable from. So the controls are split deliberately: C1–C3 and C9 put a defect back
into the PRODUCT, C4/C8/C11 attack the FLOOR and the keys it is read by, and C5–C7/C10 attack the
PREDICATE, which no product edit can reach once the three sites are fixed.

Usage: python3 scripts/w11-placeholder-controls.py [substring-of-control-id]
"""
import hashlib
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "apps", "web")

AUDIT = "apps/web/src/placeholderAudit.ts"
INPUT = "packages/ui/src/components/Input.tsx"
ISSUE_LIST = "apps/web/src/areas/track/IssueList.tsx"
SPACE_LIST = "apps/web/src/areas/docs/SpaceList.tsx"
SPACE_VIEW = "apps/web/src/areas/docs/SpaceView.tsx"

FIXED = "text-body text-ink placeholder:text-faint ${focusRing}"
UNFIXED = "text-body text-ink ${focusRing}"

OBSERVE = """  new MutationObserver(scan).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'class'],
  })"""

OWN_CLASS = "  return (el.getAttribute('class') ?? '').split(/\\s+/).includes(PLACEHOLDER_CLASS)"


class Control:
    def __init__(self, cid, why, edits, cmd, must_say, companion):
        self.cid, self.why, self.edits = cid, why, edits
        self.cmd, self.must_say, self.companion = cmd, must_say, companion


def web_test(*targets):
    return ["npx", "vitest", "run", *targets]


# The audit's own file is the companion for every control that puts a defect back into a SURFACE:
# it exercises the predicate directly, so it survives a red surface and dies with a broken build.
AUDIT_GREEN = r"✓ src/placeholderAudit\.test\.tsx"

CONTROLS = [
    Control(
        "C1-regress-issue-list",
        "the Track create-issue field back on the user agent's grey must be caught as it renders",
        [(ISSUE_LIST, FIXED, UNFIXED, 1)],
        web_test("src/areas/track/IssueList.test.tsx", "src/placeholderAudit.test.tsx"),
        r"What needs doing\?",
        AUDIT_GREEN,
    ),
    Control(
        "C2-regress-space-list",
        "the Docs create-space field must be caught on a DIFFERENT surface, not just the first one",
        [(SPACE_LIST, FIXED, UNFIXED, 1)],
        web_test("src/areas/docs/DocsArea.test.tsx", "src/placeholderAudit.test.tsx"),
        r"Engineering",
        AUDIT_GREEN,
    ),
    Control(
        "C3-regress-space-view",
        "the third site is a real offender held back by the fix, not an absent defect",
        [(SPACE_VIEW, FIXED, UNFIXED, 1)],
        web_test("src/areas/docs/DocsArea.test.tsx", "src/placeholderAudit.test.tsx"),
        r"What are you writing\?",
        AUDIT_GREEN,
    ),
    Control(
        "C4-blind-the-observer",
        "a dead observer must be caught by the FLOOR — the offender rule goes green for nothing",
        [(AUDIT, OBSERVE, "  void scan", 1)],
        web_test("src/areas/lens/Keys.test.tsx", "src/placeholderAudit.test.tsx"),
        r"audited NO rendered placeholder",
        AUDIT_GREEN,
    ),
    Control(
        "C5-change-the-design-system",
        "the audit states the literal, so the component moving away from it must go red, not follow",
        [(INPUT, "placeholder:text-faint", "placeholder:text-muted", 1)],
        web_test("src/placeholderAudit.test.tsx", "src/areas/track/IssueList.test.tsx"),
        r"no longer declares placeholder:text-faint",
        r"✓ src/areas/track/IssueList\.test\.tsx",
    ),
    Control(
        "C6-walk-the-ancestors",
        "walking up the tree reports a green Chrome does not paint — ::placeholder does not inherit",
        [(AUDIT, OWN_CLASS,
          "  for (let e: Element | null = el; e; e = e.parentElement) {\n"
          "    if ((e.getAttribute('class') ?? '').split(/\\s+/).includes(PLACEHOLDER_CLASS)) return true\n"
          "  }\n  return false", 1)],
        web_test("src/placeholderAudit.test.tsx", "src/areas/lens/Keys.test.tsx"),
        r"an ANCESTOR carrying the class does not style a descendant placeholder",
        r"✓ src/areas/lens/Keys\.test\.tsx",
    ),
    Control(
        "C7-accept-any-faint",
        "a predicate widened to any `text-faint` calls all three offenders styled — they carry text-ink today and are one rename away",
        [(AUDIT, OWN_CLASS,
          "  return (el.getAttribute('class') ?? '').split(/\\s+/).some((c) => c.includes('text-faint'))", 1)],
        web_test("src/placeholderAudit.test.tsx", "src/areas/lens/Keys.test.tsx"),
        r"a plain colour utility is not a placeholder colour",
        r"✓ src/areas/lens/Keys\.test\.tsx",
    ),
    Control(
        "C8-fixture-stops-rendering-the-field",
        "a file that stops rendering its fields must red the floor rather than quietly guard nothing",
        # ⚠ THIS CONTROL DELETES BOTH OF DocsArea's PLACEHOLDERS, AND THE FIRST VERSION — WHICH
        # DELETED ONLY "Engineering" — MEASURED **NOT CAUGHT**. That is not a hole in the floor,
        # it is what a floor IS: `0292cf0` recorded the same shape for MUST_RENDER_QUANTITY. A
        # floor asks "did this file audit one of these", never "did it audit THIS one", so as long
        # as SpaceView's field still renders into DocsArea.test.tsx the entry stays satisfied.
        # The limit is recorded in placeholderAudit.ts rather than tuned away, and the control now
        # tests the claim the floor actually makes.
        [(SPACE_LIST, 'placeholder="Engineering"', "", 1),
         (SPACE_VIEW, 'placeholder="What are you writing?"', "", 1)],
        web_test("src/areas/docs/DocsArea.test.tsx", "src/placeholderAudit.test.tsx"),
        r"audited NO rendered placeholder",
        AUDIT_GREEN,
    ),
    Control(
        "C9-a-brand-new-hand-rolled-field",
        "a field added to a surface today is swept the moment it renders — the claim in the docstring, checked",
        [(SPACE_LIST,
          '        <label className="flex min-w-0 flex-1 flex-col gap-1">\n'
          '          <span className="text-caption text-muted">Space name</span>',
          '        <input placeholder="A brand-new hand-rolled field" className={focusRing} />\n'
          '        <label className="flex min-w-0 flex-1 flex-col gap-1">\n'
          '          <span className="text-caption text-muted">Space name</span>', 1)],
        web_test("src/areas/docs/DocsArea.test.tsx", "src/placeholderAudit.test.tsx"),
        r"A brand-new hand-rolled field",
        AUDIT_GREEN,
    ),
    Control(
        "C10-widen-the-empty-carve-out",
        "the one carve-out must stay narrow: it exists because an empty placeholder paints nothing",
        [(AUDIT, "    if (placeholder === '') continue", "    if (placeholder === '\\u0000') continue", 1)],
        web_test("src/placeholderAudit.test.tsx"),
        r"an EMPTY placeholder paints nothing",
        r"✓ [^\n]*a bare field is an offender",
    ),
    Control(
        "C11-key-the-floor-by-basename",
        "#101's C3 through the same door: a basename key never matches and the floor never fires once",
        [(AUDIT, "  'src/areas/lens/Keys.test.tsx':", "  'Keys.test.tsx':", 1)],
        web_test("src/placeholderAudit.test.tsx"),
        r"is not a src-relative path",
        r"✓ [^\n]*a bare field is an offender",
    ),
]


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def run(control):
    originals = {}
    print(f"\n=== {control.cid} — {control.why}")
    try:
        for rel, old, new, want in control.edits:
            path = os.path.join(ROOT, rel)
            with open(path, encoding="utf8") as fh:
                text = fh.read()
            if path not in originals:
                originals[path] = (text, sha(path))
            found = text.count(old)
            if found != want:
                print(f"    ANCHOR FAILED: {rel} has {found} occurrence(s) of the anchor, expected {want}")
                print("    -> control NOT RUN. This is the no-op that gets reported as evidence.")
                return "ANCHOR-FAILED"
            print(f"    anchor ok: {rel} x{found}")
            # ⚠ Recomputed from the CURRENT text, never from a snapshot: `89bd58d`'s C6 applied two
            # edits to one file from the original string and the second write discarded the first.
            with open(path, "w", encoding="utf8") as fh:
                fh.write(text.replace(old, new, want))

        proc = subprocess.run(control.cmd, cwd=WEB, capture_output=True, text=True, timeout=900)
        out = proc.stdout + proc.stderr
        went_red = proc.returncode != 0
        said_it = re.search(control.must_say, out) is not None
        # ⚠ vitest prints per-TEST ✓ lines only for files that FAILED; a passing file prints one
        # summary line. `78822bb`'s harness looked for "✓ <test name>" and condemned three working
        # controls. The companion is a REGEX so it can name a test OR a whole file.
        companion_green = re.search(control.companion, out) is not None

        if not went_red:
            verdict = "NOT CAUGHT"
        elif not said_it:
            verdict = "RED BUT SILENT (unproven — it did not name its own defect)"
        elif not companion_green:
            verdict = "RED BUT WHOLESALE (no companion left green — cannot tell a catch from a broken build)"
        else:
            verdict = "CAUGHT"
        print(f"    exit={proc.returncode} says-it={said_it} companion-green={companion_green} -> {verdict}")
        return verdict
    finally:
        for path, (text, before) in originals.items():
            with open(path, "w", encoding="utf8") as fh:
                fh.write(text)
            after = sha(path)
            state = "restored byte-identical" if after == before else f"RESTORE FAILED {before}->{after}"
            print(f"    {os.path.relpath(path, ROOT)}: {state}")


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    results = {}
    for c in CONTROLS:
        if only and only not in c.cid:
            continue
        results[c.cid] = run(c)
    print("\n" + "=" * 78)
    for cid, verdict in results.items():
        print(f"  {verdict:70s} {cid}")
    bad = [c for c, v in results.items() if v != "CAUGHT"]
    print(f"\n{len(results) - len(bad)}/{len(results)} CAUGHT")
    if bad:
        print("NOT PROVEN: " + ", ".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
