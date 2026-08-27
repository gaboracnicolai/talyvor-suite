#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE GLYPH-COVERAGE GUARD (W1.1).

Every control makes ONE edit to a real file, runs a real test command, and requires three things
before it counts as a catch:

  1. THE ANCHOR COUNT IS ASSERTED BEFORE THE WRITE. `dc0bd07` shipped two controls that never ran
     — counts of 5 and 0 where 1 was expected — and reported a no-op as evidence. An anchor that
     does not match is a FAILED control here, never a silent skip.
  2. THE RED MUST SAY THE THING IT IS SUPPOSED TO SAY. `89bd58d`'s C2 reddened a whole file for an
     unrelated reason and was nearly written down as this audit's catch. A control that goes red
     without naming its own defect is reported as UNPROVEN.
  3. A COMPANION TEST MUST STAY GREEN. A control that breaks the build — a syntax error, a missing
     import — reds everything, and "everything is red" is not evidence that this guard saw
     anything. Each control names a test that must still pass in the same run.

Every file is restored and its sha256 compared with the original.

Usage: python3 scripts/w11-glyph-controls.py [substring-of-control-id]
"""
import hashlib
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "apps", "web")

GLYPH = "apps/web/src/glyphAudit.ts"
THEME = "packages/ui/src/theme.css"

# Characters are built from codepoints for the same reason the tables are keyed that way: this
# harness sits outside the swept source set, but spelling them here would still invite a copy of
# the classified set that can drift from the one in glyphAudit.ts.
LEFT_ARROW = chr(0x2190)
RIGHT_ARROW = chr(0x2192)
SINGLE_LEFT = chr(0x2039)
SINGLE_RIGHT = chr(0x203A)
CHECK = chr(0x2713)


class Control:
    def __init__(self, cid, why, edits, cmd, must_say, companion):
        self.cid, self.why, self.edits = cid, why, edits
        self.cmd, self.must_say, self.companion = cmd, must_say, companion


def web_test(*targets):
    """
    ⚠ A CONTROL WHOSE TARGET RIDES EVERY TEST NEEDS ITS COMPANION IN ANOTHER FILE. These audits run
    in `afterEach`, so mutating a surface reds every test that renders it — and "the whole file is
    red" cannot be told apart from a syntax error. glyphAudit.test.tsx is added as the companion
    file for surface controls: it exercises the parser directly and must survive them.
    """
    return ["npx", "vitest", "run", *targets]


CONTROLS = [
    Control(
        "C1-regress-a-fixed-site",
        "a left arrow put into IssueDetail's way back must be caught as it renders",
        # ⚠ RE-ANCHORED 2026-08-27. THIS CONTROL HAD NOT RUN SINCE #265 AND SAID SO EVERY TIME —
        # to a reader, not to a gate. W1.1.8 rebuilt this screen's way back from "‹ Issues" to
        # "All issues" (the rewrite is documented at the `wayBack` binding and is correct: a
        # chevron is an instruction about history, not the name of a place), and the anchor went
        # with it. Every run since has printed ANCHOR FAILED and returned "control NOT RUN".
        #
        # ⚠⚠ AND `w1120-anchor-check` — the check whose ENTIRE SUBJECT is stale anchors — could
        # not see it, because the anchor was an f-string and f-strings were skipped without being
        # counted. The census read "every decidable anchor matches the tree" with this one outside
        # the population and no line saying so. Fixed in the same merge; see that file's `chr`
        # and JoinedStr branches. The replacement still spells the arrow as a codepoint, which is
        # this file's convention and the reason the anchor was invisible in the first place.
        [("apps/web/src/areas/track/IssueDetail.tsx", "      All issues\n",
          f"      {LEFT_ARROW} All issues\n", 1)],
        web_test("src/areas/track/IssueDetail.test.tsx", "src/glyphAudit.test.tsx"),
        r"U\+2190",
        r"✓ src/glyphAudit\.test\.tsx",
    ),
    Control(
        "C2-borrow-the-data-exemption",
        "a right arrow typed into THIS repo's copy must not inherit the exemption argued for Lens",
        [("apps/web/src/areas/lens/setupSnippets.ts",
          f"'Settings {SINGLE_RIGHT} Models {SINGLE_RIGHT} OpenAI API Key.'",
          f"'Settings {RIGHT_ARROW} Models {RIGHT_ARROW} OpenAI API Key.'", 1)],
        web_test("src/glyphAudit.test.tsx"),
        r"arriving from data|borrows an exemption",
        r"✓ [^\n]*the two tables name different characters",
    ),
    Control(
        "C3-blind-the-observer",
        "a dead observer must be caught by the mono floor, not pass as a clean product",
        [(GLYPH, "  new MutationObserver(scan).observe(document, { subtree: true, childList: true, characterData: true })",
          "  void scan", 1)],
        web_test("src/areas/lens/Overview.test.tsx", "src/glyphAudit.test.tsx"),
        r"audited NO character on the mono family",
        r"✓ src/glyphAudit\.test\.tsx",
    ),
    Control(
        "C4-coverage-says-yes-to-everything",
        "the green-for-nothing direction: a predicate that serves everything must be caught",
        [(GLYPH, "export function coverage(family: Family, cp: number): Coverage {",
          "export function coverage(family: Family, cp: number): Coverage {\n  if (cp) return 'served'", 1)],
        web_test("src/glyphAudit.test.tsx"),
        r"undeclared",
        r"✓ [^\n]*finds characters a real subset HAS",
    ),
    Control(
        "C5-delete-a-classification",
        "the classified characters are real offenders held back by the table, not absent defects",
        [(GLYPH, "  'U+2248': [", "  'U+2248_DISABLED': [", 1)],
        web_test("src/areas/lens/Overview.test.tsx", "src/glyphAudit.test.tsx"),
        r"U\+2248",
        r"✓ src/glyphAudit\.test\.tsx",
    ),
    Control(
        "C6-classify-a-served-character",
        "a stale entry — a character the faces DO have — must fail rather than sit in the table",
        [(GLYPH, "export const AWAITING_A_DECISION: Record<string, string> = {",
          "export const AWAITING_A_DECISION: Record<string, string> = {\n  'U+0041': 'bogus',", 1)],
        web_test("src/glyphAudit.test.tsx"),
        r"is now SERVED by a face",
        r"✓ [^\n]*the two tables name different characters",
    ),
    Control(
        "C7-drop-a-face-from-the-stylesheet",
        "the guard reads theme.css, so a face leaving it must change the answer",
        [(THEME, "@font-face {\n  font-family: 'IBM Plex Mono';\n  font-style: normal;\n  font-weight: 600;\n  font-display: swap;\n  src: url('./fonts/ibm-plex-mono-600-latin.woff2') format('woff2');",
          "@font-face {\n  font-family: 'IBM Plex Mono';\n  font-style: normal;\n  font-weight: 600;\n  font-display: swap;\n  src: url('./fonts/ibm-plex-mono-500-latin.woff2') format('woff2');", 1)],
        web_test("src/glyphAudit.test.tsx"),
        r"is declared 600|to be 600",
        r"✓ [^\n]*finds characters a real subset HAS",
    ),
    Control(
        "C8-break-a-font-path",
        "a url that resolves to nothing must THROW, never silently skip the face",
        [(THEME, "url('./fonts/space-grotesk-latin.woff2')", "url('./fonts/space-grotesk-latin-MISSING.woff2')", 1)],
        web_test("src/glyphAudit.test.tsx"),
        r"ENOENT|no such file",
        r"✓ [^\n]*finds characters a real subset HAS",
    ),
    Control(
        "C9-blind-the-family-walk",
        "the ancestor walk decides which files are consulted; blinding it must be caught",
        [(GLYPH, "export function effectiveFamily(el: Element | null): Family {",
          "export function effectiveFamily(el: Element | null): Family {\n  if (el) return 'sans'", 1)],
        web_test("src/glyphAudit.test.tsx"),
        r"expected 'sans' to be 'mono'",
        r"✓ [^\n]*finds characters a real subset HAS",
    ),
    Control(
        "C10-plant-a-new-offender-on-a-surface",
        "a character nobody has classified must fail until somebody does",
        [("apps/web/src/areas/lens/Overview.tsx", "<CardHeader>Recent activity</CardHeader>",
          f"<CardHeader>{CHECK} Recent activity</CardHeader>", 1)],
        web_test("src/areas/lens/Overview.test.tsx", "src/glyphAudit.test.tsx"),
        r"U\+2713",
        r"✓ src/glyphAudit\.test\.tsx",
    ),
    Control(
        "C11-spell-an-emoji-in-our-own-copy",
        "the data exemption covers tenant icons, not a suite label that copies one",
        [("apps/web/src/areas/lens/Keys.tsx", "export function Keys(", f"const _icon = '{chr(0x1F4D8)}'\n\nexport function Keys(", 1)],
        web_test("src/glyphAudit.test.tsx"),
        r"arriving from data|borrows an exemption",
        r"✓ [^\n]*the two tables name different characters",
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
            originals[path] = (text, sha(path))
            found = text.count(old)
            if found != want:
                print(f"    ANCHOR FAILED: {rel} has {found} occurrence(s) of the anchor, expected {want}")
                print("    -> control NOT RUN. This is the no-op that gets reported as evidence.")
                return "ANCHOR-FAILED"
            print(f"    anchor ok: {rel} x{found}")
            # ⚠ Recomputed from the CURRENT text, never from the snapshot: `89bd58d`'s C6 applied
            # two edits to one file from the original string and the second write discarded the
            # first, reporting a working guard as blind.
            with open(path, "w", encoding="utf8") as fh:
                fh.write(text.replace(old, new, want))

        proc = subprocess.run(control.cmd, cwd=WEB, capture_output=True, text=True, timeout=900)
        out = proc.stdout + proc.stderr
        went_red = proc.returncode != 0
        said_it = re.search(control.must_say, out) is not None
        # ⚠ THE FIRST VERSION OF THIS CHECK WAS WRONG AND CONDEMNED THREE WORKING CONTROLS.
        # vitest's default reporter prints per-TEST ✓ lines only for files that failed; a file
        # that passes prints a single summary line. Looking for "✓ <test name>" therefore
        # reported "no companion left green" for every surface control while the companion file
        # was green the whole time. The companion is matched as a REGEX so it can name either a
        # test that must pass or a whole file that must stay green.
        companion_green = re.search(control.companion, out) is not None

        if not went_red:
            verdict = "NOT CAUGHT"
        elif not said_it:
            verdict = "RED BUT SILENT (unproven — it did not name its own defect)"
        elif not companion_green:
            verdict = "RED BUT WHOLESALE (no companion left green — cannot distinguish a catch from a broken build)"
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
