#!/usr/bin/env python3
"""POSITIVE CONTROLS FOR THE REACH AUDIT.

A guard that passes on its first run has proved nothing. This mutates the shipped files one edit
at a time and requires the guard to speak — and requires it to say the RIGHT thing, because a red
that names a different failure is not this guard's catch.

Every control:
  · ASSERTS ITS ANCHOR COUNT BEFORE THE EDIT. A control that silently matches nothing reports the
    guard blind; that has happened twice in this repo and both times the count was the only
    evidence. A count that is not what the control expects aborts, it does not proceed.
  · NAMES A CHECK THAT MUST STAY GREEN. A mutation that breaks the build reds everything, and
    "everything is red" is not evidence that this guard noticed anything.
  · RESTORES THE FILE AND VERIFIES sha256-IDENTITY.

Run from apps/web:  python3 scripts/w11-reach-controls.py
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(cmd: list[str]) -> tuple[int, str]:
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


VITEST = ["npx", "vitest", "run", "--reporter=dot"]
REACH = ["node", "scripts/check-audit-reach.mjs"]
UNIT = ["npx", "vitest", "run", "--reporter=dot", "src/reachAudit.test.ts"]


@dataclass
class Edit:
    path: str
    old: str
    new: str
    anchors: int = 1


@dataclass
class Control:
    name: str
    edits: list[Edit]
    # Which command must go RED, and the phrase its output must contain.
    red_cmd: str  # 'reach' | 'unit'
    phrase: str
    # A command that must STAY GREEN, so a control that merely breaks the build is not a catch.
    green_cmd: str = "unit"
    notes: str = ""
    files: dict[str, tuple[str, str]] = field(default_factory=dict)


CONTROLS = [
    Control(
        name="C1  blind the hook — commits stop being recorded",
        edits=[
            Edit(
                "src/reachAudit.ts",
                "      walkFiber(root?.current, (type) => {\n        record.note(type)\n      })",
                "      void root",
            )
        ],
        red_cmd="reach",
        phrase="never recorded as committed",
        notes="the state a hook installed after react-dom leaves behind",
    ),
    Control(
        name="C2  blind the predicate TRUE — every export counts as a component",
        edits=[
            Edit(
                "src/reachAudit.ts",
                "export function isComponentExport(name: string, value: unknown): boolean {\n  if (typeof value === 'function') return /^[A-Z]/.test(name)",
                "export function isComponentExport(name: string, value: unknown): boolean {\n  if (name || value) return true\n  if (typeof value === 'function') return /^[A-Z]/.test(name)",
            )
        ],
        red_cmd="unit",
        phrase="registers only components",
        green_cmd="none",
        notes="⚠ THE FLOORS CANNOT SEE THIS ONE. A registry that accepts everything still contains "
        "all four literal floor entries, so MUST_REGISTER/MUST_COMMIT stay green; what goes red is "
        "the direct predicate test. Named here because a floor and a predicate catch different "
        "edits and only listing both says which is doing the work.",
    ),
    Control(
        name="C3  blind the predicate FALSE — the registry empties",
        edits=[
            Edit(
                "src/reachAudit.ts",
                "export function isComponentExport(name: string, value: unknown): boolean {\n  if (typeof value === 'function') return /^[A-Z]/.test(name)",
                "export function isComponentExport(name: string, value: unknown): boolean {\n  if (name || value) return false\n  if (typeof value === 'function') return /^[A-Z]/.test(name)",
            )
        ],
        red_cmd="unit",
        phrase="registers only components",
        green_cmd="none",
        notes="the reach floors ALSO fire on this one (an empty registry has no Button), but the "
        "unit test fails first and vitest never gets to the checker",
    ),
    Control(
        name="C4  drop the eager glob — apps/web leaves the registry",
        edits=[
            Edit(
                "src/reachRegistry.ts",
                "for (const [path, mod] of Object.entries(modules)) {",
                "for (const [path, mod] of Object.entries(modules).slice(0, 0)) {",
            )
        ],
        red_cmd="reach",
        phrase="apps/web/src/areas/lens/Overview.tsx#Overview is not in the registry",
    ),
    Control(
        name="C5  drop the package import — packages/ui leaves the registry",
        edits=[
            Edit(
                "src/reachRegistry.ts",
                "registerModule('packages/ui', UI as unknown as Record<string, unknown>)",
                "void UI",
            )
        ],
        red_cmd="reach",
        phrase="packages/ui#Button is not in the registry",
    ),
    Control(
        name="C6  a new exported component nobody renders",
        edits=[
            Edit(
                "src/areas/lens/Capability.tsx",
                "export function CapabilityOff(",
                "export function CapabilityNobodyRenders() {\n  return <span>unrendered</span>\n}\n\nexport function CapabilityOff(",
            )
        ],
        red_cmd="reach",
        phrase="Capability.tsx#CapabilityNobodyRenders is exported and NO test renders it",
        notes="the claim in this guard's own docstring, checked rather than asserted",
    ),
    Control(
        name="C7  a classified component starts being rendered — the entry goes stale",
        edits=[
            Edit(
                "src/areas/lens/Capability.tsx",
                "import { Row } from '@talyvor/ui'",
                "import { HoldBar, Row } from '@talyvor/ui'",
            ),
            Edit(
                "src/areas/lens/Capability.tsx",
                "        Off\n      </span>",
                "        Off\n      </span>\n      <HoldBar elapsed={1} total={2} />",
            ),
        ],
        red_cmd="reach",
        phrase="packages/ui#HoldBar is listed in UNREACHED but a test now renders it",
        notes="⚠ THE FIRST VERSION OF THIS CONTROL PASSED remainingLabel=\"1 left\" AND REDDENED "
        "deadClasses INSTEAD — Tailwind's extractor read the word `left` out of a PROP VALUE and "
        "reported a class that emits no CSS. The control was measuring its own string, not the "
        "guard. It is also W1.8's argument arriving inside a positive control for something else.",
    ),
    Control(
        name="C8  delete a classification — the component is unexplained again",
        edits=[
            Edit(
                "scripts/check-audit-reach.mjs",
                "  'packages/ui#HoldBar':",
                "  'packages/ui#HoldBarRenamedAway':",
            )
        ],
        red_cmd="reach",
        phrase="packages/ui#HoldBar is exported and NO test renders it",
    ),
    Control(
        name="C9  regress the fix — PrivacyCard comes back",
        edits=[
            Edit(
                "src/routes/Privacy.tsx",
                "import { LegalHeader, LawyerReview, Section } from './legalParts'",
                "import { Card, CardHeader } from '@talyvor/ui'\nimport { LegalHeader, LawyerReview, Section } from './legalParts'\n\nexport function PrivacyCard() {\n  return (\n    <Card>\n      <CardHeader>Privacy</CardHeader>\n      <Privacy />\n    </Card>\n  )\n}",
            )
        ],
        red_cmd="reach",
        phrase="Privacy.tsx#PrivacyCard is exported and NO test renders it",
    ),
    Control(
        name="C10 regress the fix — SelectGroup comes back",
        edits=[
            Edit(
                "../../packages/ui/src/components/Select.tsx",
                "export const SelectValue = SelectPrimitive.Value",
                "export const SelectGroup = SelectPrimitive.Group\nexport const SelectValue = SelectPrimitive.Value",
            ),
            Edit(
                "../../packages/ui/src/components/index.ts",
                "  SelectValue,",
                "  SelectGroup,\n  SelectValue,",
            ),
        ],
        red_cmd="reach",
        phrase="packages/ui#SelectGroup is exported and NO test renders it",
    ),
    Control(
        name="C11 the workers write nothing — no shards at all",
        edits=[
            Edit(
                "src/reachAudit.ts",
                "export function flushReach(dir: string): void {\n  mkdirSync(dir, { recursive: true })",
                "export function flushReach(dir: string): void {\n  if (dir) return\n  mkdirSync(dir, { recursive: true })",
            )
        ],
        red_cmd="reach",
        phrase="does not exist",
        notes="a missing record must red, never read as 'everything is reached'",
    ),
    Control(
        name="C12 key the registry by NAME instead of identity",
        edits=[
            Edit(
                "src/reachAudit.ts",
                "      if (!identities.has(value)) identities.set(value, `${where}#${name}`)",
                "      identities.set(name, `${where}#${name}`)",
            ),
            Edit(
                "src/reachAudit.ts",
                "      const hit = identities.get(type)",
                "      const hit = identities.get((type as { name?: string })?.name)",
            ),
        ],
        red_cmd="unit",
        phrase="two components sharing a name stay distinct",
        green_cmd="none",
        notes="the Button2 failure — the floors cannot see it, the unit test can",
    ),
]


def apply(c: Control) -> bool:
    for e in c.edits:
        p = (ROOT / e.path).resolve()
        text = p.read_text()
        n = text.count(e.old)
        if n != e.anchors:
            print(f"  ABORT anchor count {n}, expected {e.anchors}, in {e.path}")
            return False
        # ⚠ Recompute from the text on disk for every edit. Two edits to one file computed from
        # the ORIGINAL text make the second write discard the first, and the control then reports
        # a working guard as blind.
        p.write_text(text.replace(e.old, e.new, 1))
    return True


def main() -> int:
    results = []
    for c in CONTROLS:
        print(f"\n=== {c.name}")
        c.files = {}
        for e in c.edits:
            p = (ROOT / e.path).resolve()
            if str(p) not in c.files:
                c.files[str(p)] = (p.read_text(), sha(p))
        if not apply(c):
            results.append((c.name, "ABORTED (anchor)"))
            for path, (text, _) in c.files.items():
                Path(path).write_text(text)
            continue

        code_v, out_v = run(VITEST)
        code_r, out_r = (run(REACH) if code_v == 0 else (None, "<vitest red; reach not run>"))
        code_u, out_u = run(UNIT)

        red_out = out_r if c.red_cmd == "reach" else out_u
        red_code = code_r if c.red_cmd == "reach" else code_u
        caught = red_code not in (0, None) and c.phrase in red_out
        green_ok = True
        if c.green_cmd == "unit":
            green_ok = code_u == 0

        verdict = "CAUGHT" if caught and green_ok else ("NOT CAUGHT" if not caught else "CAUGHT but companion red")
        detail = f"vitest={code_v} reach={code_r} unit={code_u}"
        print(f"  {verdict}  ({detail})")
        if not caught:
            print("  ---- output ----")
            print("\n".join(red_out.splitlines()[:12]))
        results.append((c.name, f"{verdict} ({detail})"))

        for path, (text, digest) in c.files.items():
            Path(path).write_text(text)
            assert sha(Path(path)) == digest, f"restore drifted: {path}"

    print("\n================ SUMMARY ================")
    for name, verdict in results:
        print(f"  {verdict:44s} {name}")
    return 0 if all(r[1].startswith("CAUGHT (") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
