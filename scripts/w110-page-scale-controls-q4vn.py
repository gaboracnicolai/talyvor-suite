#!/usr/bin/env python3
"""
POSITIVE CONTROLS for the console's `page` step and Overview's motion — W1.1.0, tab-q4vn.

WHY THIS EXISTS. `apps/web/src/pageScale.tsx`'s five assertions and Overview's motion sweep both
went red-first and then green, which is the right order and is NOT sufficient: a guard can go green
for a reason unrelated to the thing it names. This queue's standing rule is that a guard passing on
its first run is SUSPECT until each claim has been seen to fail on its own.

EVERY CONTROL, WITHOUT EXCEPTION, follows the convention w11-display-sweep-controls.py set:
  · asserts its anchor COUNT in the file BEFORE any write (a control that silently matches nothing
    reports NOT CAUGHT and reads as a dead guard);
  · verifies the bytes on disk actually changed after the write;
  · names a MUST-RED target AND a MUST-STAY-GREEN companion. Both red is SUSPECT, not CAUGHT — a
    control that merely breaks the build is not a control;
  · restores the tree byte-identically, verified by sha256 against the pre-write digest.

⚠ THE ANCHORS DO NOT QUOTE A TAG. That harness lost five controls to `<h1>` becoming `<h2>` while
the className stayed put; anchoring on the class list or the value survives an edit to a part the
control does not care about. Each anchor below was MEASURED to occur exactly once (or twice, where
declared) before being chosen.

⚠ C8 IS THE ONE THAT MATTERS MOST. It does not touch the token at all — it breaks the CONTENT GLOB,
so `text-page` is declared, classified and written on the heading, and simply never reaches the
stylesheet the browser downloads. That is the "declared but dead" failure this repo has already paid
for in three neighbouring instruments, and it is the reason pageScale runs the real generator
instead of reading preset.ts and calling it a day.

⚠⚠ TWO COMPANIONS WERE WRONG ON THE FIRST RUN, AND THE HARNESS SAID SO RATHER THAN SCORING ITSELF
8/8. Both were re-pointed and the reason is worth keeping, because it is a fact about the guard and
not about the harness:

  · C5 (nothing wears the token) was companioned with "REACHES THE STYLESHEET", and BOTH went red.
    That is not a broken control — it is Tailwind. `text-page` is worn in exactly ONE place
    (Region.tsx), and a JIT generator emits only what its content set mentions, so taking the class
    off the heading ALSO takes it out of the stylesheet. ⚠ THE CONSEQUENCE FOR THE READER: the
    assertion named "declared is not emitted" is really "declared AND worn somewhere". It cannot
    distinguish a token that was never declared from one that is declared and unused — both are
    absent from the sheet. That is a STRONGER guarantee than the name suggests, not a weaker one,
    but the name oversells its specificity and the test file now says so in its own words.
  · C8 was companioned with the harness FLOOR, and both went red — correctly: the floor asserts
    `text-title`/`text-body`/`text-eyebrow` are in the sheet, and those live in `apps/web/src` too,
    which is exactly the glob C8 breaks. Every emitted-sheet assertion is downstream of that glob,
    so no sheet-reading test can be C8's companion.

Both now use `T_PAGE_DECLARED`, which reads preset.ts's source and never runs the generator — the
only assertion in this file that is causally independent of both mutations.
"""

import hashlib
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "apps/web"

PRESET = REPO / "packages/ui/src/preset.ts"
REGION = REPO / "apps/web/src/components/Region.tsx"
OVERVIEW = REPO / "apps/web/src/areas/lens/Overview.tsx"
CACHECARD = REPO / "apps/web/src/areas/lens/CacheCard.tsx"
TWCONF = REPO / "apps/web/tailwind.config.ts"

PAGE_STEP = "        page: ['clamp(1.5rem, 3vw, 38px)', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '500' }],\n"

# test file : -t filter
T_PAGE_DECLARED = ("src/pageScale.test.tsx", "declared in preset.ts as a real fontSize step")
T_PAGE_EMITTED = ("src/pageScale.test.tsx", "REACHES THE STYLESHEET")
T_PAGE_STEP = ("src/pageScale.test.tsx", "it is a STEP, not a rename")
T_PAGE_DOM = ("src/pageScale.test.tsx", "THE HEADING RENDERS IT")
T_PAGE_FLOOR = ("src/pageScale.test.tsx", "the generator ran and produced a real stylesheet")
T_DISPLAY_CLASS = ("src/displayScale.test.ts", "every step preset.ts declares is classified")
T_DISPLAY_SWEEP = ("src/displayScale.test.ts", "no console surface reaches for it")
T_OVERVIEW_MOTION = ("src/areas/lens/Overview.test.tsx", "moves under a pointer")
T_OVERVIEW_HEAD = ("src/areas/lens/Overview.test.tsx", "opens with one page-scale heading")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(target) -> bool:
    """True if GREEN. Runs the one named test, from apps/web, exactly as CI's vitest would."""
    f, name = target
    r = subprocess.run(
        ["npx", "vitest", "run", f, "-t", name],
        cwd=WEB, capture_output=True, text=True,
    )
    return r.returncode == 0


def control(cid, desc, path, old, new, must_red, must_green, expect_count=1):
    src = path.read_text(encoding="utf-8")
    n = src.count(old)
    if n != expect_count:
        print(f"  {cid}  ✗ ANCHOR DEAD — {path.relative_to(REPO)} contains the anchor {n}×, expected {expect_count}.")
        print(f"      A control that matches nothing reports NOT CAUGHT and reads as a dead guard. Re-anchor it.")
        return False
    before = sha(path)
    path.write_text(src.replace(old, new, expect_count), encoding="utf-8")
    if sha(path) == before:
        print(f"  {cid}  ✗ THE WRITE CHANGED NOTHING — anchor and replacement are identical.")
        return False
    try:
        red_is_red = not run(must_red)
        green_stayed = run(must_green)
    finally:
        path.write_text(src, encoding="utf-8")
        assert sha(path) == before, f"{cid}: RESTORE FAILED — {path} is not byte-identical"

    if red_is_red and green_stayed:
        verdict, ok = "CAUGHT", True
    elif red_is_red and not green_stayed:
        verdict, ok = "SUSPECT (companion also red — this control breaks the build, it does not probe)", False
    else:
        verdict, ok = "NOT CAUGHT ⚠ THE GUARD IS BLIND TO THIS", False
    print(f"  {cid}  {verdict}")
    print(f"      {desc}")
    print(f"      must-red   {must_red[1]!r} → {'RED' if red_is_red else 'GREEN'}")
    print(f"      must-green {must_green[1]!r} → {'GREEN' if green_stayed else 'RED'}")
    return ok


def main():
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=REPO, capture_output=True, text=True).stdout
    print("W1.1.0 — POSITIVE CONTROLS (tab-q4vn)")
    print(f"tree has {len([l for l in dirty.splitlines() if l.strip()])} modified path(s) — restores are verified by sha256, not by git\n")

    results = []

    results.append(control(
        "C1", "the step is DELETED from the scale entirely",
        PRESET, PAGE_STEP, "",
        must_red=T_PAGE_DECLARED, must_green=T_DISPLAY_SWEEP,
    ))

    results.append(control(
        "C2", "the step is declared but NOT FLUID — a fixed 24px, i.e. `title` under a new name",
        PRESET, "'clamp(1.5rem, 3vw, 38px)'", "'24px'",
        must_red=T_PAGE_STEP, must_green=T_DISPLAY_CLASS,
    ))

    results.append(control(
        "C3", "the CEILING is collapsed onto the floor — fluid in form, a rename in effect",
        PRESET, "clamp(1.5rem, 3vw, 38px)", "clamp(1.5rem, 3vw, 24px)",
        must_red=T_PAGE_STEP, must_green=T_DISPLAY_CLASS,
    ))

    results.append(control(
        "C4", "⚠ THE FLOOR GOES BACK TO px — the exact value W1.1.0 specifies, identical at a 16px root, and a SHRINK from 36px to 24px for a reader on Chrome Very Large",
        PRESET, "clamp(1.5rem, 3vw, 38px)", "clamp(24px, 3vw, 38px)",
        must_red=T_PAGE_STEP, must_green=T_DISPLAY_CLASS,
    ))

    results.append(control(
        "C5", "the token is perfect and NOTHING WEARS IT — the heading reverts to `text-title`",
        REGION, "text-page text-ink", "text-title text-ink",
        must_red=T_PAGE_DOM, must_green=T_PAGE_DECLARED,
    ))

    results.append(control(
        "C6", "Overview's own empty-state link goes still again",
        OVERVIEW, ' className="underline transition-colors duration-200 hover:text-ink"', ' className="underline"',
        must_red=T_OVERVIEW_MOTION, must_green=T_PAGE_DOM, expect_count=2,
    ))

    results.append(control(
        "C7", "the transition stays and its DURATION is dropped — the shape motion.test.tsx forbids",
        CACHECARD, "underline transition-colors duration-200 hover:text-ink", "underline transition-colors hover:text-ink",
        must_red=T_OVERVIEW_MOTION, must_green=T_PAGE_DOM,
    ))

    results.append(control(
        "C8", "⚠ DECLARED BUT DEAD — the token is untouched and the CONTENT GLOB stops reaching the app",
        TWCONF, "'./src/**/*.{ts,tsx}',", "'./src/**/*.{ts,tsxNOPE}',",
        must_red=T_PAGE_EMITTED, must_green=T_PAGE_DECLARED,
    ))

    print()
    caught = sum(1 for r in results if r)
    print(f"{caught}/{len(results)} controls CAUGHT")
    for p in (PRESET, REGION, OVERVIEW, CACHECARD, TWCONF):
        subprocess.run(["git", "diff", "--quiet", "--", str(p)], cwd=REPO)
    print("all mutated files restored and sha256-verified inside each control")
    return 0 if caught == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
