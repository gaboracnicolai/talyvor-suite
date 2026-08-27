#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE PRESS GUARD (motion.test.tsx), W1.1 / `w11-press-guard`.

WHY THIS FILE EXISTS. The guard it controls PASSED ON ITS FIRST RUN, which in this repo is the
signal to suspect it rather than to ship it. Three sessions have shipped guards that could not
fail and each was caught only by a control.

WHAT IS BEING CONTROLLED, stated so a reader can check the claim rather than trust it: the
check this merge replaces asked the STYLESHEET whether `--tw-scale-*: 0.98` exists and called
itself "the vacuity guard". Measured by deleting `active:scale-98` from all three product sites
and regenerating, the sheet was BYTE-IDENTICAL (30,321 -> 30,321) and the count unchanged
(6 -> 6), because comments compile into CSS. The replacement reads comment-stripped SOURCE.

⚠ THE VERDICT LOGIC IS INHERITED FROM `scripts/w11-selection-controls.py` (`a6e66ff`) AND IS
RE-VALIDATED HERE RATHER THAN TRUSTED. A helper that carries good evidence carries it for the
INPUT it was gathered on, not for a new one — so C8 is a deliberate no-op that changes real
bytes and no behaviour, and it must come back NOT CAUGHT. A harness that reports everything as
caught is an instrument that is telling you nothing.

EACH CONTROL:
  · every anchor count asserted BEFORE any file is written (a half-applied control is a no-op
    reported as evidence, and a two-edit control that recomputes from the original text
    silently discards all but the last write);
  · the red must SAY the thing it is supposed to say, searched only in the block after vitest's
    "Failed Tests" banner — the default reporter prints EVERY title in a failing file, so
    matching whole output scores a PASSING test's title as the catch;
  · a COMPANION test named per control that must STAY GREEN, so "the guard caught it" is
    distinguishable from "the file stopped compiling";
  · every file restored and its sha256 compared to the original.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path("/Users/ng/talyvor-suite")
WEB = ROOT / "apps/web"

GUARD = "apps/web/src/motion.test.tsx"
BUTTON = "packages/ui/src/components/Button.tsx"
TOGGLE = "packages/ui/src/components/ThemeToggle.tsx"
LANDING = "apps/web/src/areas/marketing/Landing.tsx"
SWITCH = "packages/ui/src/components/Switch.tsx"

TOUCHED = {GUARD, BUTTON, TOGGLE, LANDING, SWITCH}


@dataclass
class Control:
    name: str
    what: str
    says: str
    companion: str
    # path -> [(anchor, expected_count, replacement)]
    edits: list[tuple[str, list[tuple[str, int, str]]]]
    expect_caught: bool = True
    observed: str = field(default="")


CONTROLS: list[Control] = [
    Control(
        name="C1 revert-the-resolver",
        what="restore `content.map((g) => resolve(root, g))` — the form that destroys the `!` "
             "negations and pulls every test file back into the guard's content set",
        says="this file is reading itself",
        companion="no class list carries a transition without one",
        # ⚠⚠ THE NEXT MEASUREMENT THIS NOTE ASKED FOR, TAKEN 2026-08-27 (W1.1.21h) — AND THE
        # ANSWER IS NEITHER OF THE TWO IT OFFERED. The guard is NOT blind to the resolver, and the
        # replacement did not merely stop expressing the defect: **IT STOPPED RUNNING.**
        # `tailwind.config.ts` now exports `content: { files, transform }` — an OBJECT — so
        # `(tailwindConfig.content as string[]).map(...)` threw `default.content.map is not a
        # function` and reddened every case in the file. Measured, not inferred: the harness
        # reported `red=True says-it=False`, i.e. it went red WITHOUT naming its own defect, which
        # is precisely the "RED BUT WHOLESALE" state this family of harnesses exists to refuse.
        # A broken build and a catch are the same observation until something separates them.
        #
        # ⚠ THE PREVIOUS NOTE'S LEAD WAS REASONABLE AND WRONG, WHICH IS WHY IT WAS RIGHT TO WRITE
        # IT DOWN AS A LEAD: it guessed the comment-stripping half of `buildContent` was doing the
        # work. The shape of `tailwindConfig.content` had changed underneath, one line away.
        #
        # ⚠⚠ THE DEFECT IS UNCHANGED AND SO IS THE INSTRUCTION: the naive resolver destroys the
        # `!` negations, `negated.length` reads 0 where the guard requires 2, and the assertion
        # says "this file is reading itself". The replacement now takes the RAW glob list from
        # `content.files` — where it lives today — so the mutation changes the RESOLVER and
        # nothing else. NOT a weakened assertion and NOT an anchor that cannot run, which is what
        # the previous note forbade.
        #
        # ⚠ RE-ANCHORED AT W1.1.19: the guard moved from `absoluteContent` to `buildContent`, which
        # returns `{ files }` rather than an array, so both the anchor and the shape below it moved
        # and this control could not arm. The DEFECT is unchanged — the resolver reverted to the
        # naive `content.map((g) => resolve(root, g))` that destroys the `!` negations — and the
        # replacement keeps the `{ files }` shape so the mutation changes the RESOLVER and nothing
        # else about how the value is consumed.
        edits=[(GUARD, [(
            "  const content = buildContent(appRoot)\n  shippedContent = content.files",
            1,
            "  const content = { files: (tailwindConfig.content as { files: string[] }).files"
            ".map((g) => resolve(appRoot, g)) }\n"
            "  shippedContent = content.files",
        )])],
    ),
    Control(
        name="C2 button-stops-pressing",
        what="delete the press from Button's class list, LEAVING its comment — the sheet cannot "
             "tell the difference, the code scan can",
        says="a classified press site no longer presses",
        companion="no class list carries a transition without one",
        edits=[(BUTTON, [(
            "'text-body font-medium transition-colors duration-200 active:scale-98',", 1,
            "'text-body font-medium transition-colors duration-200',",
        )])],
    ),
    Control(
        name="C3 themetoggle-stops-pressing",
        what="delete the press from the hand-rolled ThemeToggle",
        says="a classified press site no longer presses",
        companion="no class list carries a transition without one",
        edits=[(TOGGLE, [("        'active:scale-98',\n", 1, "")])],
    ),
    Control(
        name="C4 landing-stepper-stops-pressing",
        what="⚠ THE ONE NOTHING HELD. Delete the press from the Landing stepper. Measured before "
             "this merge: 591/591 green. The companion is Button's render assertion, which must "
             "stay green — this has to be the new guard catching it, not collateral damage",
        says="a classified press site no longer presses",
        companion="Button presses",
        edits=[(LANDING, [(
            "transition-colors duration-200 active:scale-98 ", 1,
            "transition-colors duration-200 ",
        )])],
    ),
    Control(
        name="C5 a-fourth-unclassified-site",
        what="put the press on Switch, which nobody classified — a new press site is a design "
             "decision and must fail until someone writes down why",
        says="an unclassified press site",
        companion="every classified press site still presses",
        edits=[(SWITCH, [(
            "'peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-pill border border-transparent',", 1,
            "'peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-pill border border-transparent active:scale-98',",
        )])],
    ),
    Control(
        name="C6 blind-the-scanner",
        what="make pressSitesInCode return nothing — the floor must refuse to pass by scanning "
             "nothing, which is how a source-derived guard usually goes quiet",
        says="no class list in either package carries the press",
        companion="Button presses",
        # ⚠ RE-ANCHORED AT W1.1.19: `  return [...out].sort()` now occurs TWICE in the guard —
        # a second scanner grew the same tail — so the anchor was AMBIGUOUS rather than absent
        # and the harness refused it (count 2, expected 1). That refusal is the driver working:
        # applying it to whichever came first would have blinded a different function and the
        # control would have "passed" while proving nothing about pressSitesInCode. The anchor
        # now carries the two lines above it, which are unique to the press scanner.
        edits=[(GUARD, [(
            "      if (tokensOf(list).includes(PRESS)) out.add(f.path)\n    }\n  }\n  return [...out].sort()",
            1,
            "      if (tokensOf(list).includes(PRESS)) out.add(f.path)\n    }\n  }\n  return []",
        )])],
    ),
    Control(
        name="C7 read-prose-as-code",
        what="⚠ THE PROPERTY THE WHOLE MERGE RESTS ON. Point the scanner at raw file text instead "
             "of comment-stripped class lists — exactly the blindness the sheet check has. "
             "preset.ts:117 writes `active:scale-98` in a COMMENT, so it becomes a fourth site",
        says="an unclassified press site",
        companion="every classified press site still presses",
        edits=[(GUARD, [(
            "    for (const list of classLists(f.text)) {\n"
            "      if (tokensOf(list).includes(PRESS)) out.add(f.path)\n"
            "    }", 1,
            "    for (const list of [f.text]) {\n"
            "      if (tokensOf(list).includes(PRESS)) out.add(f.path)\n"
            "    }",
        )])],
    ),
    Control(
        name="C8 no-op (MUST NOT be caught)",
        what="reword a comment: real bytes change, no behaviour does. If this reads CAUGHT the "
             "harness is scoring noise and every verdict above it is worthless",
        says="a classified press site no longer presses",
        companion="Button presses",
        expect_caught=False,
        edits=[(GUARD, [(
            "// the substantive property first, so a revert reds with a sentence rather than a glob diff", 1,
            "// substantive property first: a revert should red with a sentence, not a glob diff",
        )])],
    ),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_suite() -> tuple[bool, str]:
    p = subprocess.run(
        ["npx", "vitest", "run", "src/motion.test.tsx", "--reporter=default"],
        cwd=WEB, capture_output=True, text=True,
    )
    return p.returncode == 0, p.stdout + p.stderr


def check_c1_shape() -> None:
    """C1's replacement hard-codes where the RAW glob list lives, and that moved once already.

    ⚠ THIS EXISTS BECAUSE OF WHAT HAPPENED WITHOUT IT. `tailwind.config.ts` changed
    `content` from an array to `{ files, transform }`, and C1's replacement — written against the
    array — threw `default.content.map is not a function` and reddened every case in the file.
    The harness scored `red=True says-it=False`, i.e. NOT CAUGHT, and the tab that found it could
    not tell whether the guard had gone blind or the mutation had gone stale. It was the second,
    and one shape check ahead of the campaign would have said so in a sentence.

    An anchor check cannot reach this: C1's ANCHOR is in `motion.test.tsx` and is present and
    correct; what went stale is the REPLACEMENT's assumption about another file entirely. A
    replacement is a claim about the tree exactly as an anchor is, and only one of the two was
    ever checked.
    """
    cfg = (ROOT / "apps/web/tailwind.config.ts").read_text()
    if "content: { files:" not in cfg:
        raise AssertionError(
            "C1's replacement reads the raw globs from `tailwindConfig.content.files`, and "
            "apps/web/tailwind.config.ts no longer declares `content: { files: … }`. The shape "
            "moved. Re-express the mutation against the new shape — do NOT leave it, because a "
            "replacement that throws reds the whole file and scores as NOT CAUGHT, which reads "
            "like the guard going blind.")


def main() -> int:
    check_c1_shape()
    originals = {p: (ROOT / p).read_text() for p in TOUCHED}
    hashes = {p: sha(ROOT / p) for p in TOUCHED}

    ok, base = run_suite()
    if not ok:
        print("BASELINE IS NOT GREEN — a control run means nothing from here.")
        print(base[-3000:])
        return 2
    print("baseline: GREEN\n")

    correct = 0
    for c in CONTROLS:
        planned: list[tuple[str, str]] = []
        try:
            for path, edits in c.edits:
                text = originals[path]
                for old, want, new in edits:
                    got = text.count(old)
                    if got != want:
                        raise AssertionError(
                            f"anchor count {got}, expected {want} in {path}: {old[:70]!r}")
                    text = text.replace(old, new, 1)
                planned.append((path, text))
        except AssertionError as e:
            print(f"{c.name}  ANCHOR FAILED — {e}")
            return 3

        for path, text in planned:
            (ROOT / path).write_text(text)
        try:
            ok, out = run_suite()
        finally:
            for path in TOUCHED:
                (ROOT / path).write_text(originals[path])
            for path in TOUCHED:
                if sha(ROOT / path) != hashes[path]:
                    print(f"{c.name}: RESTORE FAILED for {path}")
                    return 4

        marker = "Failed Tests"
        reds = out.split(marker, 1)[1] if marker in out else ""
        says = c.says in reds
        companion_red = c.companion in reds
        caught = (not ok) and says and not companion_red
        verdict = "CAUGHT" if caught else "NOT CAUGHT"
        as_expected = caught == c.expect_caught
        if as_expected:
            correct += 1
        c.observed = verdict
        flag = "ok" if as_expected else "⚠ UNEXPECTED"
        print(f"{c.name:34s} {verdict:10s} expected={'CAUGHT' if c.expect_caught else 'NOT CAUGHT':10s} "
              f"{flag}\n      red={not ok}  says({c.says!r})={says}  companion-green={not companion_red}")
        print(f"      {c.what}")

    print(f"\n{correct}/{len(CONTROLS)} behaved as expected")
    return 0 if correct == len(CONTROLS) else 1


if __name__ == "__main__":
    sys.exit(main())
