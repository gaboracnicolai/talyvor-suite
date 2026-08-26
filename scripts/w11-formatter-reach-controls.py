#!/usr/bin/env python3
"""Positive controls for apps/web/src/formatterReach.test.ts.

Every control names its PREDICTED CATCHER before it runs, and names a MUST-STAY-GREEN
companion — a compile error or a guard that fires for the wrong reason reads as a catch
otherwise. Files are snapshotted with cp and restored in a finally; the run ends by
asserting every sha256 matches the value taken before the first mutation.

⚠ CI DOES NOT RUN THIS, and it is kept anyway so the campaign can be re-run rather than
re-argued. It cannot rot into a false verdict: every anchor must match EXACTLY ONCE before
any file is written, so a moved seam exits with ANCHOR FAILED naming the file instead of
scoring a guard that never saw the mutation.

Result at the merge of this file: 7/7 as predicted, every typecheck ok, tree byte-identical
after restore. C6 is the one to read — with the defect restored, figureFace.test.ts stays
GREEN, which is exactly why the defect survived a guard written to classify it.

⚠ AND THE SENTENCE ABOVE ABOUT NOT ROTTING WAS TRUE AND NOT ENOUGH. `ANCHOR FAILED` did its
job perfectly — the campaign refused to run rather than score a guard that never saw the
mutation — and then NOTHING RAN IT, so the refusal was never heard. Measured by tab-7f4b at
`8e1d621` while running all 34 scripts/w11-*.py: this file had FOUR dead anchors and had been
unable to start for as long as it took `formatCost` to gain a parameter. Once re-anchored,
all 7 controls behave exactly as they always did: nothing about formatterReach had rotted,
only the campaign's grip on the source. An anchor check is a smoke alarm, not a fire brigade.

⚠ SO THE ANCHORS ARE THE SMALLEST STABLE THING, NOT THE PRETTIEST QUOTATION. All four deaths
were ordinary drift, not renames: `formatCost(usd: number): string {` gained `tokens = 0`,
and `import { formatCost }` gained three siblings. Quoting a whole signature, a whole import
list or a whole JSX element re-arms that decay on every future edit to a part the control does
not care about. They anchor on `export function formatCost(`, `formatCost,` and
`{formatCost(it.ai_cost_usd` now — prefixes that survive an argument or a sibling appearing,
each measured to occur EXACTLY ONCE before being chosen.

⚠ AND THE CENSUS I WROTE TO FIND THEM REPORTED "0 REMAINING" WHILE ONE WAS STILL DEAD. It
regexed for `("path", "old", ...)` triples and this file writes some anchors in SINGLE quotes,
so every one of those was outside its population by construction — the same shape of blindness
the controls here exist to catch, in the instrument looking for it. The AST rewrite found 14
anchors where the regex found fewer. Neither is shipped as an instrument: a static reader of
these scripts has now lied three times (tab-9c4d's importing census, tab-2b6c's exec screen,
and this one). THE HARNESS'S OWN RUNNER IS THE INSTRUMENT; it costs seconds for this file and
about twenty minutes for all 34.
"""
import hashlib
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "apps/web"

REACH = "src/formatterReach.test.ts"
FIGURE = "src/figureFace.test.ts"


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_tests(files):
    """Return (ok, failed_assertion_names) for a vitest run over `files`."""
    r = subprocess.run(
        ["npx", "vitest", "run", *files, "--reporter=default"],
        cwd=WEB, capture_output=True, text=True,
    )
    failed = []
    for line in r.stdout.splitlines():
        s = line.strip()
        if s.startswith("×"):
            failed.append(s.lstrip("× ").split(" > ")[-1].strip())
    return r.returncode == 0, failed, r.stdout


def typechecks() -> bool:
    return subprocess.run(["npx", "tsc", "--noEmit"], cwd=WEB, capture_output=True).returncode == 0


class Control:
    def __init__(self, name, edits, predict, must_green, needs_tsc=True):
        self.name, self.edits, self.predict = name, edits, predict
        self.must_green, self.needs_tsc = must_green, needs_tsc


def apply_edits(edits, backup_dir):
    """Assert EVERY anchor before ANY write — a half-applied control is a false verdict.

    ⚠ EDITS ARE ACCUMULATED PER FILE, NOT COMPUTED FROM THE ORIGINAL EACH TIME. The first
    version of this function planned every edit against the text as first read and then wrote
    each result in turn, so TWO EDITS TO ONE FILE meant the second write erased the first.
    C2, C4 and C7 are all two-edits-in-one-file, and all three landed only their second half:
    a call site with no import. Every one broke the typecheck and was scored VOID, which reads
    as "the control could not be run" when the truth was "the harness could not apply it".
    """
    pending: dict[pathlib.Path, str] = {}
    for rel, old, new in edits:
        p = ROOT / rel
        text = pending.get(p, p.read_text())
        n = text.count(old)
        if n != 1:
            raise SystemExit(f"ANCHOR FAILED in {rel}: found {n} occurrences, need exactly 1")
        pending[p] = text.replace(old, new)
    for p in pending:
        shutil.copy2(p, backup_dir / p.name)
    for p, new_text in pending.items():
        p.write_text(new_text)
    return list(pending)


CONTROLS = [
    Control(
        "C1  a formatter that IS classified but nothing calls — the case only this guard sees",
        [
            ("apps/web/src/areas/track/format.ts",
             "export function formatCost(",
             "export function formatOrphan(n: number): string {\n  return String(n)\n}\n\nexport function formatCost("),
            ("apps/web/src/figureFace.test.ts",
             "  'apps/web/src/areas/track/format.ts#formatCost': true,",
             "  'apps/web/src/areas/track/format.ts#formatCost': true,\n  'apps/web/src/areas/track/format.ts#formatOrphan': 'control',"),
        ],
        predict="formatterReach A (measured dead set gains track#formatOrphan)",
        must_green="figureFace — it IS classified, so rule B must stay silent",
    ),
    Control(
        "C2  a PINNED-DEAD formatter gains a real caller, THROUGH THE @talyvor/ui BARREL",
        [
            ("apps/web/src/areas/track/IssueDetail.tsx",
             "  focusRing,\n} from '@talyvor/ui'",
             "  focusRing,\n  formatDay,\n} from '@talyvor/ui'"),
            ("apps/web/src/areas/track/IssueDetail.tsx",
             '{formatCost(it.ai_cost_usd',
             '{formatDay(it.created_at)}{formatCost(it.ai_cost_usd'),
        ],
        predict="formatterReach A (measured dead set LOSES ui#formatDay while the pin still lists it) — and it only fires if the barrel hop resolves",
        must_green="figureFace — formatDay is classified 'not a figure' and is not money-named",
    ),
    Control(
        "C3  a production module namespace-imports the design system",
        [
            ("apps/web/src/areas/track/StatusPill.tsx",
             "import { statusLabel } from './format'",
             "import * as UI from '@talyvor/ui'\nimport { statusLabel } from './format'\nvoid UI"),
        ],
        predict="formatterReach C (namespace importers != [reachRegistry.ts])",
        must_green="figureFace",
    ),
    Control(
        "C4  the LIVE formatUSD loses one of its three call sites",
        [
            # ⚠ RE-ANCHORED AT W1.1.19: the span was reformatted onto three lines, so the
            # single-line anchor matched nothing and this control could not arm. Same defect —
            # formatUSD loses this call site — expressed against the wrapped form.
            ("apps/web/src/areas/lens/TopUp.tsx",
             '<span className="font-figure text-body text-muted">\n                  \u2248 {formatUSD(balance.data.usd_value_uusd)}\n                </span>',
             '<span className="font-figure text-body text-muted">\n                  \u2248 paused\n                </span>'),
            ("apps/web/src/areas/lens/TopUp.tsx",
             "import { formatUSD } from './format'",
             "import './format'"),
        ],
        predict="formatterReach D (the per-module call-site list for lens#formatUSD changes)",
        must_green="figureFace — five money render sites remain, above its >=5 floor",
    ),
    Control(
        "C5  the barrel resolver goes blind",
        [
            ("apps/web/src/formatterReach.test.ts",
             "  return sources.find((s) => !s.test && s.abs.startsWith(UI_SRC)",
             "  if (name) return undefined\n  return sources.find((s) => !s.test && s.abs.startsWith(UI_SRC)"),
        ],
        predict="formatterReach E (the cn hop through the barrel resolves to nothing)",
        must_green="formatterReach A and C — no format* is imported through the barrel today, which is exactly why E has to exist",
    ),
    Control(
        "C6  THE FINDING ITSELF restored — the dead money export comes back",
        [
            ("apps/web/src/areas/track/format.ts",
             "export function formatCost(",
             "export function formatUSD(usd: number): string {\n  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })\n}\n\nexport function formatCost("),
            ("apps/web/src/figureFace.test.ts",
             "  'apps/web/src/areas/track/format.ts#formatCost': true,",
             "  'apps/web/src/areas/track/format.ts#formatCost': true,\n  'apps/web/src/areas/track/format.ts#formatUSD': true,"),
        ],
        predict="formatterReach A (track#formatUSD is dead and unpinned) — the defect this merge repairs",
        must_green="figureFace — classified, so rule B is satisfied; this is why the defect survived before",
    ),
    Control(
        "C7  MUST-STAY-GREEN: a new formatter that IS classified AND IS called",
        [
            ("apps/web/src/areas/track/format.ts",
             "export function formatCost(",
             "export function formatTokens(n: number): string {\n  return String(n)\n}\n\nexport function formatCost("),
            ("apps/web/src/figureFace.test.ts",
             "  'apps/web/src/areas/track/format.ts#formatCost': true,",
             "  'apps/web/src/areas/track/format.ts#formatCost': true,\n  'apps/web/src/areas/track/format.ts#formatTokens': 'control — a count rendered in the caption sans, classified as not a figure',"),
            ("apps/web/src/areas/track/IssueDetail.tsx",
             "formatCost,",
             "formatCost, formatTokens,"),
            ("apps/web/src/areas/track/IssueDetail.tsx",
             "<span className=\"text-caption text-faint\">{it.ai_tokens} tokens</span>",
             "<span className=\"text-caption text-faint\">{formatTokens(it.ai_tokens)} tokens</span>"),
        ],
        predict="NOTHING — a guard that fails on any change is not a guard",
        must_green="formatterReach and figureFace both",
    ),
]


def main():
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                           capture_output=True, text=True).stdout
    print("tree before controls (expected: only this merge's files):")
    print("".join(f"    {l}\n" for l in dirty.splitlines()) or "    (clean)")

    targets = sorted({ROOT / rel for c in CONTROLS for rel, _, _ in c.edits})
    before = {p: sha(p) for p in targets}

    results = []
    for c in CONTROLS:
        print(f"\n=== {c.name}")
        print(f"    PREDICT RED : {c.predict}")
        print(f"    MUST STAY GREEN: {c.must_green}")
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="ctl-"))
        touched = []
        try:
            touched = apply_edits(c.edits, tmp)
            tsc = typechecks() if c.needs_tsc else True
            reach_ok, reach_failed, _ = run_tests([REACH])
            fig_ok, fig_failed, _ = run_tests([FIGURE])
            results.append((c, tsc, reach_ok, reach_failed, fig_ok, fig_failed))
            print(f"    typecheck      : {'ok' if tsc else 'BROKEN — this control is void'}")
            print(f"    formatterReach : {'green' if reach_ok else 'RED -> ' + '; '.join(reach_failed)}")
            print(f"    figureFace     : {'green' if fig_ok else 'RED -> ' + '; '.join(fig_failed)}")
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
