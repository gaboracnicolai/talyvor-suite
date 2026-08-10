#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR src/proseClasses.test.ts — and for the config change it guards.

Every control names, BEFORE it runs, (a) the test it predicts will catch the mutation and
(b) a MUST-STAY-GREEN companion that is expected to be blind to it. A control that reds the
whole suite justifies nothing: it cannot tell you which guard spoke. A control that reds
NOTHING is only interesting if the mutation was behaviourally real, so each one asserts its
anchor exists exactly once before any byte is written, and asserts the file changed on disk
after.

The tree is restored by sha256, not by an exit code.

    python3 apps/web/scripts/w18-prose-class-controls.py            # all
    python3 apps/web/scripts/w18-prose-class-controls.py C3         # one
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile

REPO = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
CFG = os.path.join(REPO, "apps/web/tailwind.config.ts")
SRCTEXT = os.path.join(REPO, "packages/ui/src/lib/sourceText.ts")
PRESET = os.path.join(REPO, "packages/ui/src/preset.ts")


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class Edit:
    """One (file, old, new) substitution, asserted to match exactly once."""

    def __init__(self, path, old, new):
        self.path, self.old, self.new = path, old, new


def apply_edits(edits):
    """ALL anchors asserted before ANY write — a half-applied control is a lie either way."""
    originals = {}
    for e in edits:
        src = originals.get(e.path) or read(e.path)
        originals[e.path] = src
        n = src.count(e.old)
        if n != 1:
            raise AssertionError(f"anchor matched {n}x (want 1) in {e.path}: {e.old[:70]!r}")
    before = {p: sha(p) for p in originals}
    pending = dict(originals)
    for e in edits:
        pending[e.path] = pending[e.path].replace(e.old, e.new, 1)
    for p, text in pending.items():
        write(p, text)
    for p in originals:
        if sha(p) == before[p]:
            raise AssertionError(f"{p} is byte-identical after the edit — nothing was applied")
    return originals


def restore(originals):
    for p, text in originals.items():
        write(p, text)


def vitest(project_dir):
    """Every failing test id in one project, from the JSON reporter."""
    out = tempfile.mktemp(suffix=".json")
    subprocess.run(
        ["npx", "vitest", "run", "--reporter=json", f"--outputFile={out}"],
        cwd=os.path.join(REPO, project_dir),
        capture_output=True,
        text=True,
    )
    if not os.path.exists(out):
        return ["<vitest produced no report — the run itself failed>"]
    with open(out) as f:
        report = json.load(f)
    os.unlink(out)
    failed = []
    for suite in report.get("testResults", []):
        rel = os.path.relpath(suite["name"], REPO)
        for t in suite.get("assertionResults", []):
            if t["status"] == "failed":
                # the MESSAGE, not just the name: a test can fail on a crash rather than on the
                # claim it exists to make, and the two read identically in a list of names.
                msg = " ".join((t.get("failureMessages") or [""])[0].split())[:150]
                failed.append(f"{rel} > {t.get('fullName') or t.get('title')}\n        └ {msg}")
    return failed


def run_all():
    return vitest("apps/web") + vitest("packages/ui")


TRANSFORM_LIVE = """export const contentTransform: Record<string, (src: string) => string> = {
  ts: stripComments,
  tsx: stripComments,
}"""

CONTROLS = [
    dict(
        id="C1",
        what="the build's own config goes back to a bare glob list (the tests keep buildContent)",
        why="the seam that decides what the BROWSER gets. Every instrument here composes its own "
        "content, so all of them stay green while the shipped sheet regains 20 classes.",
        catcher="src/proseClasses.test.ts > the instrument > the BUILD carries the transform",
        green="src/deadClasses.test.ts, src/motion.test.tsx, src/tokenDoor.test.ts — all read "
        "buildContent, so none of them can see this",
        edits=lambda: [Edit(CFG, "  content: { files: content, transform: contentTransform },", "  content,")],
    ),
    dict(
        id="C2",
        what="the transform map is emptied — the exact state this branch found the repo in",
        why="reproduces the defect end to end rather than a proxy for it",
        catcher="src/proseClasses.test.ts — the work floor, all three fixture controls, the "
        "shipped-sheet census, and the extension-coverage rule",
        green="src/deadClasses.test.ts — emitted GROWS, so used ⊆ emitted still holds and it "
        "cannot see the regression at all",
        edits=lambda: [
            Edit(CFG, TRANSFORM_LIVE, "export const contentTransform: Record<string, (src: string) => string> = {}")
        ],
    ),
    dict(
        id="C3",
        what="a transformer for .ts only — .tsx comments still reach the extractor",
        why="the half-fix. Six classes come back and every other guard in the repo is blind to "
        "which file types were covered.",
        catcher="src/proseClasses.test.ts — the census naming `inline` and `transition`, and the "
        "extension-coverage rule naming tsx",
        green="src/motion.test.tsx's globs pin — it compares the config to itself, so a missing "
        "transformer is invisible to it",
        edits=lambda: [Edit(CFG, "  ts: stripComments,\n  tsx: stripComments,", "  ts: stripComments,")],
    ),
    dict(
        id="C4",
        what="stripComments becomes the identity function",
        why="⚠ NOT A JUSTIFICATION FOR proseClasses — packages/ui's typeface.test.tsx owns this "
        "stripper's controls and must also speak. Run to see BOTH, and to confirm the guard "
        "rests on a stripper that is itself controlled.",
        catcher="packages/ui typeface.test.tsx AND src/proseClasses.test.ts (two catchers)",
        green="(none claimed — this mutation is deliberately over-covered)",
        edits=lambda: [
            Edit(
                SRCTEXT,
                "export function stripComments(src: string): string {\n  let out = ''",
                "export function stripComments(src: string): string {\n  return src\n  let out = ''",
            )
        ],
    ),
    dict(
        id="C5",
        what="stripComments returns the empty string",
        why="the stripper that would satisfy 'the comment class is gone' while deleting the "
        "product. This is what the code-direction half of each fixture control exists for.",
        catcher="src/proseClasses.test.ts fixture controls, message 'the stripper ate CODE'",
        green="(none claimed — a stripper that emits nothing reds widely, which is the point)",
        edits=lambda: [
            Edit(
                SRCTEXT,
                "export function stripComments(src: string): string {\n  let out = ''",
                "export function stripComments(src: string): string {\n  return ''\n  let out = ''",
            )
        ],
    ),
    dict(
        id="C6",
        what="a content glob for a file type nothing strips comments from",
        why="the failure the coverage rule is FOR: behaviourally inert on this tree (there is no "
        ".md under src/) and a live hole the moment one is added. Nothing else in the repo "
        "relates a content glob to a transformer.",
        catcher="src/proseClasses.test.ts > every extension in the content set has a transformer",
        green="src/tokenDoor.test.ts and src/motion.test.tsx globs pins — both derive the "
        "expected globs from the same array they check, so a new glob is invisible to them",
        edits=lambda: [Edit(CFG, "  './src/**/*.{ts,tsx}',", "  './src/**/*.{ts,tsx}',\n  './src/**/*.md',")],
    ),
    dict(
        id="C7",
        what="the comment that supplies `tabular-nums` is deleted from preset.ts",
        why="a pinned fixture dying. The guard must SAY SO rather than passing quietly — a "
        "source-derived pin that cannot see its own premise disappear is the failure mode.",
        catcher="src/proseClasses.test.ts > carries no class that only prose asks for, via the "
        "PROSE_ONLY-fixture-gone branch",
        green="src/deadClasses.test.ts — a comment losing a word changes nothing it reads",
        edits="preset_tabular",
    ),
    dict(
        id="C8",
        what="a comment naming a class the product ALREADY renders (`text-body`)",
        why="the harness's own control. If this reds, the harness reports CAUGHT for any edit and "
        "every verdict above is worthless.",
        catcher="(NOTHING — this must be NOT CAUGHT)",
        green="the entire suite",
        edits=lambda: [
            Edit(
                CFG,
                "const content = [\n  './index.html',",
                "const content = [\n  // a comment naming text-body, which the product renders anyway\n  './index.html',",
            )
        ],
        expect_caught=False,
    ),
]


def preset_tabular_edits():
    src = read(PRESET)
    hits = [ln for ln in src.split("\n") if "tabular-nums" in ln]
    if not hits:
        raise AssertionError("preset.ts no longer mentions tabular-nums — C7's premise is gone")
    line = hits[0]
    return [Edit(PRESET, line, line.replace("tabular-nums", "the tabular figure utility"))]


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    picked = [c for c in CONTROLS if not only or c["id"] == only]
    tracked = [CFG, SRCTEXT, PRESET]
    clean = {p: sha(p) for p in tracked}

    print("BASELINE — the tree must be green before any control means anything")
    base_failures = run_all()
    if base_failures:
        print("  the suite is ALREADY red; every verdict below would be noise:")
        for f in base_failures:
            print("    " + f)
        return 1
    print("  green.\n")

    results = []
    for c in picked:
        print(f"=== {c['id']} — {c['what']}")
        print(f"    why      : {c['why']}")
        print(f"    PREDICT  : {c['catcher']}")
        print(f"    must stay: {c['green']}")
        edits = preset_tabular_edits() if c["edits"] == "preset_tabular" else c["edits"]()
        originals = apply_edits(edits)
        try:
            failures = run_all()
        finally:
            restore(originals)
        for p in tracked:
            if sha(p) != clean[p]:
                print(f"    ⚠⚠ {p} DID NOT RESTORE — stop and fix the tree by hand")
                return 2
        want = c.get("expect_caught", True)
        caught = bool(failures)
        mine = [f for f in failures if "proseClasses" in f]
        verdict = "CAUGHT" if caught else "NOT CAUGHT"
        ok = caught == want
        print(f"    RESULT   : {verdict} — {len(failures)} failing test(s), {len(mine)} in proseClasses")
        for f in failures[:8]:
            print("      " + f)
        if len(failures) > 8:
            print(f"      … and {len(failures) - 8} more")
        print(f"    {'✓' if ok else '✗'} {'as predicted' if ok else 'PREDICTION REFUTED — read it, do not retarget the control'}\n")
        results.append((c["id"], ok, verdict, len(mine)))

    print("SUMMARY")
    for cid, ok, verdict, mine in results:
        print(f"  {cid}  {'✓' if ok else '✗'}  {verdict:<10} proseClasses failures: {mine}")
    passed = sum(1 for _, ok, _, _ in results if ok)
    print(f"  {passed}/{len(results)} controls behaved as predicted")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
