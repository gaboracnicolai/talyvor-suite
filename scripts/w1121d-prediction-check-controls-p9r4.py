#!/usr/bin/env python3
"""Controls for scripts/w1121d-prediction-check-p9r4.py (W1.1.21d, tab-p9r4).

⚠ THIS FILE'S NAME CARRIES `prediction-check` ON PURPOSE — that is the substring the checker's
census excludes. The anchor check paid for this once and wrote it down: its glob counted its own
control script as one of the harnesses it checks, pushing the census up in the direction that
looks like progress. S10 below is the control that says the exclusion is real.

Each control predicts its verdict BEFORE it runs, is applied alone unless it says otherwise,
restores from ORIGINAL BYTES in a `finally`, and is sha256-verified back.
"""
import hashlib, os, pathlib, re, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECK = ROOT / "scripts/w1121d-prediction-check-p9r4.py"
REACH = ROOT / "apps/web/scripts/check-audit-reach.mjs"
CENSUS = ROOT / "apps/web/src/CardHeaderHeading.test.tsx"
CLONE = ROOT / "scripts/w11-selfcensus-controls-p9r4-tmp.py"

TOUCHED = [CHECK, REACH, CENSUS]
ORIG = {p: p.read_bytes() for p in TOUCHED}
SHA = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in TOUCHED}


def sub(p: pathlib.Path, old: str, new: str) -> None:
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"ANCHOR DEAD in {p.name}: {old[:70]!r}")
    p.write_text(s.replace(old, new, 1))


# ── mutations ────────────────────────────────────────────────────────────────
def defect4():
    """W1.1.21d defect 4: 'check-audit-reach added the project name to two sentences'.

    ⚠ THE FIRST CUT OF THIS CONTROL APPENDED THE PROJECT NAME AND SCORED NOT CAUGHT — AND THE
    CHECKER WAS RIGHT. `never recorded as committed by apps/web` still CONTAINS the substring the
    harness asserts, so the harness would still score CAUGHT and there is no defect to see. The
    edit has to break the asserted substring, which is what "made more specific" means when the
    specificity lands INSIDE the phrase. ⚠ AND THE MISS IS WORTH KEEPING RATHER THAN HIDING: this
    check's sensitivity is exactly the harness's. A message edit a harness survives is one this
    file is silent about, by construction, and that is the correct silence.
    """
    sub(REACH, "but never recorded as committed. ", "but never recorded by apps/web as committed. ")


def corpus_includes_harnesses():
    sub(CHECK, "        if not rel or rel in exclude:", "        if not rel:")


def blind_census():
    sub(CHECK, 'ROOT.rglob("w1*controls*.py")', 'ROOT.rglob("zz*controls*.py")')


def blind_extractor():
    sub(CHECK, 'OUTISH = ("out", "stdout", "stderr", "output", "result", "res", "log", "text", "combined")',
        'OUTISH = ("zzzzzz",)')


def external_becomes_decidable():
    """A tracked file starts containing a string declared as produced outside this repo."""
    sub(CENSUS, "import { render, screen, waitFor } from '@testing-library/react'",
        "// cannot find package\nimport { render, screen, waitFor } from '@testing-library/react'")


def break_interpolated_fragment():
    """The guard stops containing a fragment an INTERPOLATED declaration names."""
    sub(REACH, " is exported and NO apps/web test renders it", " is exported and NO web test renders it")


def drop_interpolated_entry():
    """The escape hatch removed: the claim must fall through to the red path."""
    sub(CHECK, """    "CARD_HEADER_CENSUS says 3": (
        "apps/web/src/CardHeaderHeading.test.tsx",
        ["CARD_HEADER_CENSUS says "],
    ),
""", "")


def drop_external_entry():
    sub(CHECK, '    "[build failed]": "the Go toolchain — `go test` prints it for a package that will not compile",\n', "")


def raise_claim_floor():
    sub(CHECK, "MIN_CLAIM = 9", "MIN_CLAIM = 40")


def clone_self():
    """A control FOR this checker, named so the census cannot tell — the instrument measuring
    itself. Reads the checker's own claim count as a harness's."""
    shutil.copy(pathlib.Path(__file__), CLONE)


def unblind_self():
    """The checker's own source back in the corpus — every declaration then excuses itself."""
    sub(CHECK, '    blind |= {p.relative_to(ROOT).as_posix() for p in ROOT.rglob(f"*{SELF}*") if p.is_file()}\n', "")


def reword():
    sub(CHECK, "── WHY THIS EXISTS ──", "── WHAT THIS FILE IS FOR ──")


def run_check() -> tuple[int, str]:
    r = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True, cwd=ROOT)
    return r.returncode, r.stdout + r.stderr


# (id, description, mutations, expected exit, must-contain, must-NOT-contain)
CONTROLS = [
    ("S0", "PRISTINE", [], 0, None, None),
    ("S1", "DEFECT 4 — check-audit-reach's message made more specific INSIDE the asserted phrase",
     [defect4], 1, "never recorded as committed", None),
    # ⚠ S2 CANNOT BE SCORED ON THE EXIT CODE. With the harnesses back in the corpus the run reds
    # anyway — the self-policing EXTERNAL rule fires, because `[build failed]` is then "in the
    # tracked tree" via the harness that asserts it. That is a real second catcher and it is NOT
    # the rule under test. What isolates the exclusion is whether S1's literal is still NAMED.
    ("S2", "S1 + the harness exclusion removed — does S1 still get named?",
     [defect4, corpus_includes_harnesses], 1, None, "never recorded as committed"),
    ("S3", "the harness census glob blinded", [blind_census], 1, "HARNESS CENSUS COLLAPSED", None),
    ("S4", "the claim extractor blinded", [blind_extractor], 1, "CLAIM EXTRACTOR COLLAPSED", None),
    ("S5", "a tracked file gains a string declared as produced OUTSIDE this repo",
     [external_becomes_decidable], 1, "DECLARED-EXTERNAL STRING", None),
    ("S6", "a guard stops containing a fragment its INTERPOLATED declaration names",
     [break_interpolated_fragment], 1, "INTERPOLATED DECLARATION(S) NO LONGER HOLD", None),
    ("S6b", "an INTERPOLATED declaration deleted — the claim must fall through to the red path",
     [drop_interpolated_entry], 1, "CARD_HEADER_CENSUS says 3", None),
    ("S7", "one EXTERNAL declaration deleted", [drop_external_entry], 1, "[build failed]", None),
    ("S8", "the claim floor raised above the real population", [raise_claim_floor], 1, "CLAIM EXTRACTOR COLLAPSED", None),
    # ⚠ S11 IS THE ONE THAT ONLY APPEARS ONCE THESE SCRIPTS ARE COMMITTED. Untracked, git
    # ls-files hides them and the hole is invisible; tracked, every declared literal occurs in
    # the declaration that excuses it.
    ("S11", "the checker's own source back in the corpus — declarations excusing themselves",
     [unblind_self], 1, "this declaration is excusing it", None),
    ("S9", "a reworded comment", [reword], 0, None, None),
    # ⚠ S10 IS A DELTA, NOT A NUMBER, AND IT WAS A NUMBER FIRST. It pinned `harnesses: 78` and
    # broke the moment `w1121e-path-invariance-controls-p9r4.py` legitimately landed — defect 1
    # on W1.1.21d's own list ("A HARDCODED EXPECTED ASSERTION COUNT"), written by the same tab
    # that had just rewritten W6 out of exactly that shape one merge earlier. The property is
    # that cloning a control under a non-excluded name makes the census GROW BY ONE; the
    # population it grows from is nobody's business here.
    ("S10", "a control FOR this checker, renamed so the census cannot exclude it",
     [clone_self], 0, "__CENSUS_GROWS_BY_ONE__", None),
]


def restore():
    for p in TOUCHED:
        p.write_bytes(ORIG[p])
    if CLONE.exists():
        CLONE.unlink()
    bad = [p.name for p in TOUCHED if hashlib.sha256(p.read_bytes()).hexdigest() != SHA[p]]
    if bad:
        raise SystemExit("TREE NOT RESTORED: " + ", ".join(bad))


results = []
try:
    for cid, desc, muts, want_rc, want_text, want_absent in CONTROLS:
        for m in muts:
            m()
        rc, out = run_check()
        restore()
        if want_text == "__CENSUS_GROWS_BY_ONE__":
            base = int(re.search(r"harnesses: (\d+)", run_check()[1]).group(1))
            grown = int(re.search(r"harnesses: (\d+)", out).group(1))
            # ⚠ AND A VACUITY FLOOR ON THE BASE, because 0 -> 1 is also a growth of one.
            ok = rc == want_rc and grown == base + 1 and base >= 70
            out = out + f"\n(census {base} -> {grown})"
        else:
            ok = (rc == want_rc
                  and (want_text is None or want_text in out)
                  and (want_absent is None or want_absent not in out))
        results.append((cid, ok))
        print(f"\n=== {cid} — {desc}")
        print(f"    PREDICTED exit={want_rc}"
              + (f" naming {want_text!r}" if want_text else "")
              + (f" and NOT naming {want_absent!r}" if want_absent else ""))
        print(f"    OBSERVED  exit={rc}")
        head = [l for l in out.splitlines() if l.strip()][:4]
        for l in head:
            print(f"      | {l}")
        if not ok:
            print(f"    ✗ MISMATCH")
        print(f"    {'PASS' if ok else 'FAIL'}")
        sys.stdout.flush()
finally:
    restore()
    print("\nTREE RESTORED, sha256-verified:",
          all(hashlib.sha256(p.read_bytes()).hexdigest() == SHA[p] for p in TOUCHED))
    if results:
        good = sum(1 for _, ok in results if ok)
        print(f"CONTROLS: {good}/{len(results)} as predicted")
        print("  " + "  ".join(f"{c}:{'ok' if ok else 'FAIL'}" for c, ok in results))
    sys.exit(0 if results and all(ok for _, ok in results) else 1)
