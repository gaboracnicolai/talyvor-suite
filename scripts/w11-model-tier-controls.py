#!/usr/bin/env python3
"""Positive controls for apps/web/src/areas/lens/ModelTier.test.tsx.

This guard protects behaviour that is ALREADY CORRECT, so it passes on the first run and the
controls are the only evidence it works at all. Every control names its predicted catcher
before it runs.

⚠ EDITS ARE STAGED PER FILE. Two edits to one file computed from the same original text mean
the second write erases the first; that failure scored three controls VOID in this repo's
previous campaign. Anchors are asserted against the STAGED text and every file is written once.

BASELINE, measured before any of this existed: putting `?? 'cheap'` back into modelTier left
the whole suite green — 1028 apps/web tests, 350 packages/ui tests. C1 is that same mutation.
"""
import hashlib
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "apps/web"
GUARD = "src/areas/lens/ModelTier.test.tsx"
NEIGHBOURS = ["src/areas/lens/Spend.test.tsx", "src/areas/lens/Overview.test.tsx"]


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(files):
    r = subprocess.run(["npx", "vitest", "run", *files, "--reporter=default"],
                       cwd=WEB, capture_output=True, text=True)
    failed = [l.strip().lstrip("× ").split(" > ")[-1].strip()
              for l in r.stdout.splitlines() if l.strip().startswith("×")]
    return r.returncode == 0, failed


def typechecks() -> bool:
    return subprocess.run(["npx", "tsc", "--noEmit"], cwd=WEB, capture_output=True).returncode == 0


MT = "apps/web/src/areas/lens/ModelTier.tsx"

CONTROLS = [
    ("C1  THE SHIPPED DEFECT RESTORED — the fixture default comes back",
     [(MT, "  return TIERS[model]\n", "  return TIERS[model] ?? 'cheap'\n")],
     "ModelTier.test.tsx — the absence cases AND the mixed-set count",
     "the suite's other lens tests, which is the whole point: they were green through this"),

    ("C2  the lookup stops answering at all (the inverse defect)",
     # `return undefined` alone leaves `model` unused and tsc rejects it — a compile error is
     # not a caught mutation. Referencing the parameter keeps the control a BEHAVIOUR change.
     # `return undefined` alone leaves BOTH `model` and `TIERS` unread and tsc rejects it
     # (TS6133) — a compile error is not a caught mutation. Both are referenced and discarded
     # so this stays a pure BEHAVIOUR change: the map is consulted by nobody, deliberately.
     [(MT, "  return TIERS[model]\n", "  void TIERS\n  void model\n  return undefined\n")],
     "ModelTier.test.tsx — the CATEGORISED cases; the absence cases cannot tell this apart",
     "nothing else — this is why the inverse assertion is not decoration"),

    ("C3  a model is added to the curated map without a decision",
     [(MT, "  'claude-sonnet-5': 'capable',",
       "  'claude-sonnet-5': 'capable',\n  'claude-opus-5': 'cheap',")],
     "ModelTier.test.tsx — the hardcoded census; claude-opus-5 is pinned uncategorised",
     "typecheck"),

    ("C4  the dot loses the tier from its accessible name",
     [("packages/ui/src/components/TierDot.tsx",
       "      aria-label={label ?? tier}", "      aria-label={label ?? 'model'}")],
     "ModelTier.test.tsx — the announced-name case; a count-only guard would miss it",
     "typecheck"),

    ("C5  MUST-STAY-GREEN: a categorised model's tier is re-spelled consistently everywhere",
     [(MT, "  'claude-haiku-4-5': 'cheap',", "  'claude-haiku-4-5': 'cheap', // touched")],
     "NOTHING — a guard that fails on any edit to the file is not a guard",
     "ModelTier.test.tsx must stay green"),
]


def apply_edits(edits, backup):
    pending: dict[pathlib.Path, str] = {}
    for rel, old, new in edits:
        p = ROOT / rel
        text = pending.get(p, p.read_text())
        n = text.count(old)
        if n != 1:
            raise SystemExit(f"ANCHOR FAILED in {rel}: {n} occurrences, need exactly 1")
        pending[p] = text.replace(old, new)
    for p in pending:
        shutil.copy2(p, backup / p.name)
    for p, t in pending.items():
        p.write_text(t)
    return list(pending)


def main():
    targets = sorted({ROOT / rel for _, edits, _, _ in CONTROLS for rel, _, _ in edits})
    before = {p: sha(p) for p in targets}

    for name, edits, predict, must_green in CONTROLS:
        print(f"\n=== {name}")
        print(f"    PREDICT RED    : {predict}")
        print(f"    MUST STAY GREEN: {must_green}")
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="mt-"))
        touched = []
        try:
            touched = apply_edits(edits, tmp)
            tsc = typechecks()
            g_ok, g_failed = run([GUARD])
            n_ok, n_failed = run(NEIGHBOURS)
            print(f"    typecheck      : {'ok' if tsc else 'BROKEN — control void'}")
            print(f"    ModelTier guard: {'green' if g_ok else 'RED -> ' + '; '.join(g_failed)}")
            print(f"    lens neighbours: {'green' if n_ok else 'RED -> ' + '; '.join(n_failed)}")
        finally:
            for p in touched:
                shutil.copy2(tmp / p.name, p)
            shutil.rmtree(tmp, ignore_errors=True)

    bad = [str(p) for p in targets if sha(p) != before[p]]
    print("\n=== restore check")
    print("    " + ("every file byte-identical to before the first mutation"
                    if not bad else "NOT RESTORED: " + ", ".join(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
