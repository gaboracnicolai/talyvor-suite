#!/usr/bin/env python3
"""
THE MOTION CENSUS W1.1.17 ASKS FOR — "Do that first; the number is the item." (tab-m3w8)

W1.1.0 gave the console its one display step and put it on `components/Region.tsx`, so all six
rebuilt screens got the page-scale heading BY CONSTRUCTION, in one line. W1.1.17 records what that
left open, and names motion first: "W1.1.0 applied motion to Overview ONLY, as its stated proof …
The other five have not been measured at all."

This is that measurement, and it is deliberately FIXTURE-FREE.

── WHY NOT A RENDERED SWEEP, WHICH IS THIS REPO'S USUAL INSTRUMENT ──────────────────────────────

I ran one first, over all twelve `CONSOLE_ROUTES` addresses with a BFF fake, counting elements in
the DOM whose class list carries a motion utility. Two things made it the wrong number:

  1. THE SHELL DOMINATES IT. Every address reported 14 motion-carrying elements before the screen
     rendered anything — the sidebar's twelve nav links and the theme toggle. Scoped to `<main>`
     the shell drops out, and the numbers become 0–7.
  2. ⚠ THE FIXTURE DECIDES THE ANSWER, AND A 404-EVERYTHING FIXTURE MEASURES TWELVE FAILURE
     SCREENS. Scoped to `<main>` under that fixture, `/` reports **0** — while Overview's source
     carries two motion links, because they sit in a branch that only renders once data arrives.
     A census of the empty state is a floor, not the screen. Making the fixture answer 200 instead
     did not fix it: a generic `{}` body crashes `Overview.tsx#SpendCard` (`rows.filter is not a
     function`), because a useful populated fixture is a per-screen object, not a default. That is
     its own piece of work and it is NOT done here.

So this counts what each screen's OWN CODE writes: the transitive local-import closure of the
component `CONSOLE_ROUTES` mounts, excluding `packages/ui`. ⚠ THAT EXCLUSION IS THE POINT, not a
limitation. `Button`, `Input`, `Select` and `Row` all carry `transition-colors duration-200`, so
every screen inherits motion on its controls whatever it does; the question W1.1.17 asks is whether
the SCREEN moves, and only the screen's own code can answer that.

── THE RESULT, MEASURED AT suite main `36f7437` ─────────────────────────────────────────────────

    address    files motion press  where
    /             15      6     0  areas/lens/Overview.tsx:4, areas/lens/CacheCard.tsx:2
    /ledger        7      0     0  —
    /billing       9      0     0  —
    /keys          8      0     0  —
    /setup         9      0     0  —
    /spend        12      2     0  areas/lens/CacheCard.tsx:2
    /members       7      0     0  —
    /settings      5      0     0  —
    /track        19     12     0  areas/track/IssueList.tsx:8, areas/track/IssueDetail.tsx:2, areas/track/SearchIssues.tsx:2
    /docs         19     14     0  areas/docs/SpaceList.tsx:4, areas/docs/AskAI.tsx:2, areas/docs/PageView.tsx:2, areas/docs/SearchDocs.tsx:2

⚠ SEVEN OF THE TEN WRITE NO MOTION AT ALL, and `/spend`'s two are a shared card it renders rather
than anything of its own — so on the count that matters it is eight.

⚠⚠ `active:scale-98` IS ZERO IN EVERY SCREEN CLOSURE. The one motion token this system declares —
preset.ts calls it "THE PRESS … the one motion token in the system" — is written ONLY inside
`packages/ui` (Button, ThemeToggle). No screen presses anything of its own. That is not obviously
wrong (a token belongs in the component), and it does mean "motion on state change" is, product-
wide, exactly one hover colour and one button press.

── THE CONTROLS, BECAUSE SEVEN ZEROS IS WHAT A BROKEN INSTRUMENT ALSO PRINTS ────────────────────

Run with `--controls`. 4/4 behaved as predicted; each mutates a real file and restores it, and the
final run is asserted byte-identical to the baseline output.

  P1  inject a motion class into a ZERO screen's OWN entry file  → /members 0 → 2.   CAUGHT
  P2  inject into `components/Region.tsx`, reached only THROUGH an import
                                                                 → /track 12 → 13, /docs 14 → 15.  CAUGHT
      ⚠ AND IT CORRECTED ME. I predicted /members would stay 0 because "Members does not import
      Region". It went to 1: `areas/lens/Members.tsx:7` imports it directly. The prediction was
      wrong, the instrument was right, and a control whose expectation I had not written down
      first would have let me read my own error as the instrument's.
  P3  NEGATIVE: the same classes inside a COMMENT in a zero screen → /keys stays 0.  CAUGHT
  P4  restore: the census output after all mutations is byte-identical to the baseline.

── WHAT IS NOT CLAIMED ──────────────────────────────────────────────────────────────────────────

A count of motion utilities is not a judgement about whether a screen FEELS static; it is the
number W1.1.17 asked for and the smallest thing that can be checked. It says nothing about the
other half of that item — whether each region is one idea and whether the whitespace is the site's
— which is a reading, not a count, and is left to the per-screen items.
"""

import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

WEB_SRC = Path(__file__).resolve().parent.parent / "apps/web/src"

MOTION = re.compile(
    r"\b(transition-(?:colors|transform|opacity|all)|duration-\d+|active:scale-98"
    r"|motion-reduce:[a-z-]+|animate-[a-z-]+)\b"
)
IMPORT = re.compile(r"""from\s+['"](\.[^'"]+)['"]""")

# The component `CONSOLE_ROUTES` mounts at each address. ⚠ `/settings` renders `Sharing.tsx`, not a
# `Settings.tsx` — there is no such file, the same correction W0.3 had to make about `/billing`
# rendering `TopUp.tsx`. Read from App.tsx, not guessed.
SCREENS = [
    ("/", "areas/lens/Overview.tsx"),
    ("/ledger", "areas/lens/Ledger.tsx"),
    ("/billing", "areas/lens/TopUp.tsx"),
    ("/keys", "areas/lens/Keys.tsx"),
    ("/setup", "areas/lens/Setup.tsx"),
    ("/spend", "areas/lens/Spend.tsx"),
    ("/members", "areas/lens/Members.tsx"),
    ("/settings", "areas/lens/Sharing.tsx"),
    ("/track", "areas/track/TrackArea.tsx"),
    ("/docs", "areas/docs/DocsArea.tsx"),
]


def strip_comments(text: str) -> str:
    """Blocks then lines. A class NAMED in prose is not a class APPLIED — P3 pins that."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"//[^\n]*", "", text)


def resolve(importer: Path, rel: str):
    p = (importer.parent / rel).resolve()
    for ext in (".tsx", ".ts", "/index.tsx", "/index.ts"):
        cand = Path(str(p) + ext)
        if cand.exists():
            return cand
    return p if p.is_file() else None


def closure(entry: Path):
    """Every local file the screen reaches. `packages/ui` is outside WEB_SRC and so outside this."""
    seen, stack = set(), [entry]
    while stack:
        f = stack.pop()
        if f in seen or WEB_SRC not in f.parents and f != WEB_SRC:
            if f in seen:
                continue
        if f in seen:
            continue
        try:
            f.relative_to(WEB_SRC)
        except ValueError:
            continue
        seen.add(f)
        try:
            text = f.read_text(encoding="utf-8")
        except OSError:
            continue
        for rel in IMPORT.findall(text):
            r = resolve(f, rel)
            if r is not None and ".test." not in r.name:
                stack.append(r)
    return {f for f in seen if ".test." not in f.name}


def census() -> str:
    out = [f"{'address':10s} {'files':>5s} {'motion':>6s} {'press':>5s}  where"]
    for address, rel in SCREENS:
        entry = WEB_SRC / rel
        if not entry.exists():
            out.append(f"{address:10s} ✗ MISSING {rel}")
            continue
        counts, per = Counter(), {}
        for f in closure(entry):
            hits = MOTION.findall(strip_comments(f.read_text(encoding="utf-8")))
            if hits:
                per[str(f.relative_to(WEB_SRC))] = len(hits)
            counts.update(hits)
        # ⚠ SORTED BY (-count, NAME), not by count alone. With count alone a TIE ordered by
        # whatever the set walk happened to produce, so two runs of this census printed
        # different `where` columns for `/docs` — and P4, which compares the census to itself,
        # would have failed at random and been read as a restore bug.
        where = ", ".join(f"{k}:{v}" for k, v in sorted(per.items(), key=lambda x: (-x[1], x[0]))[:4]) or "—"
        out.append(
            f"{address:10s} {len(closure(entry)):5d} {sum(counts.values()):6d} "
            f"{counts.get('active:scale-98', 0):5d}  {where}"
        )
    return "\n".join(out)


def value(text: str, address: str):
    for line in text.split("\n"):
        f = line.split()
        if f and f[0] == address:
            return int(f[2])
    return None


def controls() -> int:
    base = census()
    print(base + "\n")
    ok = []

    def probe(cid, desc, path, old, new, expectations):
        p = WEB_SRC / path
        src = p.read_text(encoding="utf-8")
        if src.count(old) != 1:
            print(f"  {cid}  ✗ ANCHOR DEAD in {path}")
            return False
        p.write_text(src.replace(old, new, 1), encoding="utf-8")
        try:
            after = census()
            got = {a: value(after, a) for a in expectations}
        finally:
            p.write_text(src, encoding="utf-8")
        good = got == expectations
        print(f"  {cid}  {'CAUGHT' if good else '✗ NOT AS PREDICTED'}\n      {desc}")
        for a, want in expectations.items():
            print(f"      {a:10s} predicted {want}  measured {got[a]}")
        return good

    ok.append(probe(
        "P1", "a motion class in a ZERO screen's OWN entry file — the zero must move",
        "areas/lens/Members.tsx", "export function Members(",
        'const PROBE = "transition-colors duration-200"\nvoid PROBE\nexport function Members(',
        {"/members": 2}))

    ok.append(probe(
        "P2", "a motion class in a file reached only THROUGH an import — the closure walk, not the "
              "entry file. ⚠ I predicted /members 0 here and was WRONG: Members.tsx:7 imports Region.",
        "components/Region.tsx", "export function RegionScreen(",
        'const PROBE2 = "animate-pulse"\nvoid PROBE2\nexport function RegionScreen(',
        {"/track": 13, "/docs": 15, "/members": 1}))

    ok.append(probe(
        "P3", "NEGATIVE — the same classes inside a COMMENT are prose, not motion",
        "areas/lens/Keys.tsx", "export function Keys(",
        "// transition-colors duration-200 active:scale-98 animate-pulse\nexport function Keys(",
        {"/keys": 0}))

    same = census() == base
    print(f"  P4  {'CAUGHT' if same else '✗ RESTORE FAILED'}\n      the census after every mutation "
          f"is byte-identical to the baseline")
    ok.append(same)
    print(f"\n{sum(ok)}/{len(ok)} controls behaved as predicted")
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(controls() if "--controls" in sys.argv else (print(census()) or 0))
