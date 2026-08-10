#!/usr/bin/env python3
"""POSITIVE CONTROLS for the packages/ui audit gate.

Every claim this merge makes is a claim that some instrument would SPEAK if the thing it
watches broke. This mutates the product/guard one edit at a time and checks that the NAMED
instrument — predicted before the run, not read off the output — is the one that reds.

Each control:
  · asserts its anchor appears EXACTLY ONCE before writing (a half-applied control is a lie)
  · verifies the bytes changed ON DISK, so NOT CAUGHT cannot mean "nothing was edited"
  · names the catcher AND a must-stay-green companion, so a control that breaks the build
    cannot score as a catch
  · restores from a `cp` backup and verifies the tree is byte-identical afterwards

Usage:  python3 scripts/w11-ui-gate-controls.py
"""
import filecmp
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps/web"
UI = ROOT / "packages/ui"

GATE = ("gate", ["node", "scripts/check-audit-gate.mjs"], WEB)
UI_SUITE = ("packages/ui vitest", ["npx", "vitest", "run"], UI)
WEB_SUITE = ("apps/web vitest", ["npx", "vitest", "run"], WEB)


def run(cmd):
    label, argv, cwd = cmd
    p = subprocess.run(argv, cwd=cwd, capture_output=True, text=True)
    return p.returncode, f"{p.stdout}{p.stderr}"


class Control:
    def __init__(self, name, what, edits, catcher, expect, green):
        self.name, self.what, self.edits = name, what, edits
        self.catcher, self.expect, self.green = catcher, expect, green


def apply_edits(edits, backups):
    """Every anchor is asserted before ANY write — a control that applies half of itself
    reports a working guard as blind."""
    for path, old, _new in edits:
        text = path.read_text()
        n = text.count(old)
        if n != 1:
            return f"anchor appears {n}x in {path.relative_to(ROOT)} (expected 1)"
    for path, old, new in edits:
        backups[path] = Path(tempfile.mkdtemp()) / path.name
        shutil.copy2(path, backups[path])
        before = path.read_bytes()
        path.write_text(path.read_text().replace(old, new, 1))
        if path.read_bytes() == before:
            return f"bytes on disk unchanged for {path.relative_to(ROOT)}"
    return None


CONTROLS = [
    Control(
        "C1 one install removed from packages/ui's setup",
        "installEyebrowAudit() deleted — the audit is not observing this project at all",
        [(UI / "src/__tests__/setup.ts", "installEyebrowAudit()\n", "")],
        GATE,
        "packages/ui: the gate threw, but 1 audit(s) never named themselves in it: eyebrow",
        WEB_SUITE,
    ),
    Control(
        "C2 packages/ui's enforcement point blinded",
        "if (problems.length > 0) throw  ->  if (false) throw — the single line the whole gate rests on",
        [
            (
                UI / "src/__tests__/setup.ts",
                "  if (problems.length > 0) throw new Error(problems.join('\\n\\n'))",
                "  if (false) throw new Error(problems.join('\\n\\n'))",
            )
        ],
        GATE,
        "packages/ui: THE AUDIT GATE DID NOT THROW",
        WEB_SUITE,
    ),
    Control(
        "C3 a report block deleted from packages/ui's setup",
        "the plane block's opening phrase changed so the block no longer reports that audit",
        [
            (
                UI / "src/__tests__/setup.ts",
                "      'text scored against the plane it renders on and did not clear AA body (4.5:1) — or landed '",
                "      'some text did not clear AA body (4.5:1) — or landed '",
            )
        ],
        GATE,
        "packages/ui: the gate threw, but 1 audit(s) never named themselves in it: plane",
        WEB_SUITE,
    ),
    Control(
        "C4 the report-block count un-anchored",
        "/^\\s*problems.push(/gm -> /problems.push(/g — the count then reads its own documentation",
        [
            (
                WEB / "scripts/check-audit-gate.mjs",
                "match(/^\\s*problems\\.push\\(/gm)",
                "match(/problems\\.push\\(/g)",
            )
        ],
        GATE,
        "packages/ui: src/__tests__/setup.ts holds 8 report blocks and this script pins 7 audits",
        UI_SUITE,
    ),
    Control(
        "C5 the packages/ui probe written outside that project's include glob",
        "probe path moved to the package root, where vitest's include never reaches",
        [
            (
                WEB / "scripts/check-audit-gate.mjs",
                "    probe: 'src/__tests__/auditGateProbe.test.ts',",
                "    probe: 'auditGateProbe.test.ts',",
            )
        ],
        GATE,
        "packages/ui: the EMPTY probe failed",
        UI_SUITE,
    ),
    Control(
        "C6 the whole packages/ui project dropped from the gate",
        "PROJECTS loses its second entry — the state this merge found the repo in",
        [
            (
                WEB / "scripts/check-audit-gate.mjs",
                "  {\n    label: 'packages/ui',\n    root: resolve(appRoot, '../../packages/ui'),\n    setup: 'src/__tests__/setup.ts',\n    probe: 'src/__tests__/auditGateProbe.test.ts',\n  },\n",
                "",
            )
        ],
        GATE,
        "packages/ui",  # inverted: see verdict logic — this control expects the NAME to VANISH
        WEB_SUITE,
    ),
    # ⚠ C7 IS THE CONTROL THAT EARNS THE MERGE, and its FIRST version justified nothing.
    #
    # That version made HoldBar's label an eyebrow with no `uppercase` — a defect in a component
    # whose only render in this repo is packages/ui/src/__tests__/components.test.tsx:46. It was
    # caught, and it was ALSO caught by apps/web's `eyebrowAudit.test.tsx`, which sweeps BOTH
    # packages' SOURCE for `text-eyebrow` without `uppercase` and names the file and line. The
    # companion reddened, the control scored INVALID, and that is the correct verdict: a mutation
    # two guards see justifies neither of them.
    #
    # The plane rule is the one with no source counterpart — `planeAudit.ts` exists because a
    # curated contrast matrix cannot ask what the product actually renders, and `contrast.test.ts`
    # scores canvas/surface/sidebar only. So the mutation below is a defect that NOTHING in this
    # repo could see before this merge.
    Control(
        "C7 a defect ONLY the new setup can see, in a component only packages/ui renders",
        "FixtureNotice gets a tinted chip: text-faint on bg-accent-tint is 3.97:1 light / "
        "3.63:1 dark, under the AA body floor — and no source rule scores a plane",
        [
            (
                UI / "src/components/FixtureNotice.tsx",
                '<div className="flex items-center gap-1.5 text-caption text-faint">',
                '<div className="flex items-center gap-1.5 rounded-pill bg-accent-tint text-caption text-faint">',
            )
        ],
        UI_SUITE,
        "text scored against the plane it renders on",
        WEB_SUITE,
    ),
    Control(
        "C8 ONE-DIRECTIONAL — a correct eyebrow must NOT be condemned",
        "HoldBar's label becomes a PROPERLY cased eyebrow; the rule must stay silent",
        [
            (
                UI / "src/components/HoldBar.tsx",
                'className="shrink-0 font-figure text-caption text-muted"',
                'className="shrink-0 font-figure text-eyebrow uppercase text-muted"',
            )
        ],
        None,  # nothing may red
        None,
        UI_SUITE,
    ),
]


def verdict(control):
    backups = {}
    try:
        problem = apply_edits(control.edits, backups)
        if problem:
            return "INVALID", problem

        if control.catcher is None:
            code, out = run(control.green)
            if code == 0:
                return "CAUGHT", f"{control.green[0]} stayed green, as required"
            return "NOT CAUGHT", f"{control.green[0]} reddened on a legitimate change:\n{out[-1200:]}"

        code, out = run(control.catcher)

        if control.name.startswith("C6"):
            # The mutation REMOVES a project, so the catcher cannot fail — the observable is that
            # packages/ui is never mentioned again. A gate that still passes while checking one
            # project is exactly the state this merge found.
            if code == 0 and "packages/ui" not in out:
                caught = True
                why = "the gate passed WITHOUT ever naming packages/ui — one project checked, one silent"
            else:
                caught, why = False, f"packages/ui still appears / gate failed:\n{out[-800:]}"
            if not caught:
                return "NOT CAUGHT", why
            gcode, gout = run(control.green)
            if gcode != 0:
                return "INVALID", f"companion {control.green[0]} reddened:\n{gout[-800:]}"
            return "CAUGHT", why

        if code == 0:
            return "NOT CAUGHT", f"{control.catcher[0]} stayed green:\n{out[-800:]}"
        if control.expect not in out:
            return "WRONG CATCH", (
                f"{control.catcher[0]} failed but not with the predicted message.\n"
                f"  predicted: {control.expect}\n  got:\n{out[-1200:]}"
            )
        gcode, gout = run(control.green)
        if gcode != 0:
            return "INVALID", (
                f"must-stay-green companion {control.green[0]} ALSO reddened — a control that "
                f"breaks the build is not a control:\n{gout[-800:]}"
            )
        return "CAUGHT", f"{control.catcher[0]} named it: {control.expect}"
    finally:
        for path, backup in backups.items():
            shutil.copy2(backup, path)
            if not filecmp.cmp(backup, path, shallow=False):
                print(f"!! RESTORE FAILED for {path}", file=sys.stderr)


def main():
    dirty = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True
    ).stdout
    print(f"tree before: {len(dirty.splitlines())} modified path(s)\n")
    results = []
    for c in CONTROLS:
        print(f"── {c.name}\n   {c.what}")
        v, why = verdict(c)
        print(f"   => {v}: {why}\n")
        results.append((c.name, v))
    after = subprocess.run(
        ["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True
    ).stdout
    print("── summary")
    for name, v in results:
        print(f"   {v:<11} {name}")
    caught = sum(1 for _, v in results if v == "CAUGHT")
    print(f"\n   {caught}/{len(results)} CAUGHT")
    print(f"   tree after: {len(after.splitlines())} modified path(s) (must equal before)")
    return 0 if caught == len(results) and after == dirty else 1


if __name__ == "__main__":
    sys.exit(main())
