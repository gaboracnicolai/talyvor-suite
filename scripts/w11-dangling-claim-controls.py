#!/usr/bin/env python3
"""Positive controls for danglingClaimAudit.test.ts.

    python3 scripts/w11-dangling-claim-controls.py

The two rules went RED on the source they were written against, which is the
right start and is NOT sufficient: each red proved one instance, and a rule that
sees one instance can still be blind to the shape. So every control below drives
a defect at the guard, and the run must end `caught 8  survived 0  falsered 0`.

WHY EACH CONTROL NAMES THE TEST IT EXPECTS TO RED. A control scored on "the file
went red" records a hole as covered whenever some other assertion happens to
notice — and this file has five tests, three of which are census floors that red
for reasons having nothing to do with the rule under test. A control that reds
the wrong test is MISATTRIBUTED here, and that is a failure, not a pass.

⚠ AND HALF OF THESE CONTROLS ASSERT THE GUARD STAYS GREEN. RULE A exists because
scoping to interface members turns the 26 legitimate `/** */` pairs in these two
packages into zero false positives; a rule that reds on a file header would be
useless, and nothing about "it went red on the real defect" proves it does not.
N1-N3 inject the legitimate shapes and FAIL if the guard reports them. A guard is
two claims — it fires on the defect and it does not fire on the innocent — and
only measuring one of them is how a rule ships that nobody can keep green.
"""
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
WEB = REPO / "apps" / "web"
SRC = WEB / "src"

API = SRC / "lib" / "api.ts"
CONSENT = SRC / "components" / "PoolingConsent.tsx"
GUARD = SRC / "danglingClaimAudit.test.ts"
ENTRY = SRC / "areas" / "auth" / "Entry.tsx"

RULE_A = "RULE A — no interface member carries two doc blocks > every documented member is documented once"
RULE_B = "RULE B — every `see <path>` names a file that exists > a comment sending the reader somewhere sends them somewhere real"
CENSUS_MEMBERS = "the census finds a population > parses both packages and finds interface members to check"
CENSUS_UI = "the census finds a population > walks packages/ui, not only apps/web"
CENSUS_SEE = "the census finds a population > reads comments, and most see-pointers resolve"

# The live member doc in api.ts that a second block is injected in front of.
LIVE_MEMBER = "  /** The consent Lens RECORDED for this workspace — not what was requested. */\n  cache_poolable?: boolean"

# (id, mode, expected-test, description, [(file, old, new), …])
#   mode "red"   — the named test MUST fail
#   mode "green" — the whole file MUST stay green (a false positive is the failure)
CONTROLS = [
    # ── the guard fires on the defect ────────────────────────────────────────
    ("K1", "red", RULE_A, "the exact defect this file was written for: a removed member's doc block orphaned in front of the next member's own", [
        (API, LIVE_MEMBER,
         "  /** Whether THIS deployment's Docs is a single workspace shared by everyone signed in.\n"
         "   *  Absent (older BFF) is treated as false. */\n" + LIVE_MEMBER)]),

    ("K2", "red", RULE_A, "the same shape in packages/ui, so the rule is not scoped to where the defect was found", [
        (REPO / "packages" / "ui" / "src" / "index.ts", None, None)]),  # filled in below

    ("K3", "red", RULE_B, "a `see <path>` naming a module that is not on disk", [
        (CONSENT, "// #59 and the description outlived them — see the block above <SharingChoice> for the account",
         "// #59 and the description outlived them — see areas/docs/goneForever.ts for the account")]),

    ("K4", "red", RULE_B, "a `see <path>` that resolved until the file it names was renamed away", [
        (ENTRY, "lib/signupOpen.ts", "lib/signupOpenRenamed.ts")]),

    # ── the census cannot pass by reading nothing ────────────────────────────
    ("K5", "red", CENSUS_MEMBERS, "the file walk returns nothing — every rule below it is vacuously satisfied", [
        (GUARD, "      else if (/\\.tsx?$/.test(name)) out.push(p)",
         "      else if (/\\.NOTHINGMATCHESTHIS$/.test(name)) out.push(p)")]),

    ("K6", "red", CENSUS_MEMBERS, "the leading-comment reader always returns nothing — RULE A can never fire again", [
        (GUARD, "          const ranges = ts.getLeadingCommentRanges(text, member.pos) ?? []",
         "          const ranges: ts.CommentRange[] = []")]),

    ("K7", "red", CENSUS_UI, "the walk drops packages/ui and keeps apps/web — the exact half-scope this repo has shipped three times", [
        (GUARD, "  return [...sourceFiles(WEB_SRC), ...sourceFiles(UI_SRC)]",
         "  return [...sourceFiles(WEB_SRC)]")]),

    ("K8", "red", CENSUS_SEE, "the comment scanner reads no comments — RULE B's population goes to zero and it passes forever", [
        (GUARD, "      out.push({ line, text: src.slice(i, end) })",
         "      out.push({ line, text: '' })")]),

    # ── the guard does NOT fire on the innocent ──────────────────────────────
    ("N1", "green", None, "a file header followed by the first declaration's own doc — the 26-instance shape a regex rule would have failed on", [
        (SRC / "lib" / "signupOpen.ts", None, None)]),  # filled in below

    # ⚠ THIS CONTROL'S FIRST DRAFT USED `./SharingFacts.tsx` AND THE GUARD RED IT — correctly.
    # SharingFacts is DECLARED in areas/lens/Sharing.tsx and only imported here, so a sibling file
    # of that name has never existed. The control was wrong, not the rule; re-anchored on a file
    # that really does sit beside the citing one. Kept as a note because a false-red control that
    # is "fixed" by loosening the rule is how a guard quietly stops guarding.
    ("N2", "green", None, "a `see <path>` that resolves relative to the citing file's own directory", [
        (CONSENT, "// #59 and the description outlived them — see the block above <SharingChoice> for the account",
         "// #59 and the description outlived them — see ./AuthGate.tsx for the account")]),

    ("N3", "green", None, "a path named in a STRING, not a comment — the module graph is the compiler's job, not this guard's", [
        (CONSENT, "const CONSENT_HEADER = 'Your answers are being shared'",
         "const CONSENT_HEADER = 'Your answers are being shared'\nconst NOT_A_COMMENT = 'see areas/docs/goneForever.ts'\nvoid NOT_A_COMMENT")]),
]


def build_dynamic() -> bool:
    """K2 and N1 need anchors read from disk rather than guessed."""
    ok = True

    ui_index = REPO / "packages" / "ui" / "src" / "index.ts"
    # Append an interface carrying the defect, so the UI half of the walk has one to find.
    for c in CONTROLS:
        if c[0] == "K2":
            c[4][0] = (ui_index, None,
                       "\n\nexport interface ControlProbe {\n"
                       "  /** documents a member that was removed */\n"
                       "  /** documents the member that is here */\n"
                       "  kept: string\n}\n")
        if c[0] == "N1":
            target = REPO / "packages" / "ui" / "src" / "index.ts"
            c[4][0] = (target, None,
                       "\n\n/** A file-header-shaped block: prose about the module, not about a member. */\n"
                       "/** And the first declaration's OWN doc, immediately after it. */\n"
                       "export interface ControlInnocent {\n  kept: string\n}\n")
    if not ui_index.exists():
        print(f"ANCHOR-MISS: {ui_index} does not exist")
        ok = False
    return ok


def failed_tests(stdout: str) -> set:
    return set(re.findall(r"[×✕]\s+(.+?)(?:\s+\d+ms)?$", stdout, re.M))


def main() -> int:
    if not build_dynamic():
        return 1

    files = {f for _, _, _, _, edits in CONTROLS for f, _, _ in edits}
    originals = {f: f.read_text(encoding="utf-8") for f in files}
    caught = misattributed = survived = falsered = invalid = 0

    try:
        for cid, mode, expect, desc, edits in CONTROLS:
            ok = True
            for f, old, new in edits:
                if old is not None and originals[f].count(old) != 1:
                    print(f"{cid}: ANCHOR-MISS in {f.name} ({originals[f].count(old)}x) — {desc}")
                    ok = False
            if not ok:
                invalid += 1
                continue

            for f, old, new in edits:
                src = originals[f]
                f.write_text(src + new if old is None else src.replace(old, new, 1), encoding="utf-8")

            run = subprocess.run(
                ["npx", "vitest", "run", "src/danglingClaimAudit.test.ts", "--reporter=default"],
                cwd=str(WEB), capture_output=True, text=True)
            out = run.stdout + run.stderr
            fails = failed_tests(out)

            if "Error" in out and "Test Files" not in out:
                invalid += 1
                print(f"{cid}: RUN BROKE — the control measured nothing — {desc}")
            elif mode == "green":
                if run.returncode == 0:
                    caught += 1
                    print(f"{cid}: GREEN as required — {desc}")
                else:
                    falsered += 1
                    print(f"{cid}: *** FALSE RED — the guard fires on an innocent shape *** {sorted(fails)} — {desc}")
            elif run.returncode == 0:
                survived += 1
                print(f"{cid}: *** SURVIVED — the guard cannot see this *** — {desc}")
            elif any(expect in f for f in fails):
                caught += 1
                extra = sorted(x for x in fails if expect not in x)
                print(f"{cid}: CAUGHT by {expect[:60]}… — {desc}" + (f"  (+ also red: {len(extra)})" if extra else ""))
            else:
                misattributed += 1
                print(f"{cid}: MISATTRIBUTED — expected {expect[:50]}…, got {sorted(fails)} — {desc}")

            for f, _, _ in edits:
                f.write_text(originals[f], encoding="utf-8")
    finally:
        for f, src in originals.items():
            f.write_text(src, encoding="utf-8")

    print(f"\ncaught {caught}  misattributed {misattributed}  survived {survived}  "
          f"falsered {falsered}  invalid {invalid}  of {len(CONTROLS)}")
    return 0 if caught == len(CONTROLS) else 1


if __name__ == "__main__":
    sys.exit(main())
