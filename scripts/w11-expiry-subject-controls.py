#!/usr/bin/env python3
"""POSITIVE CONTROLS for apps/web/src/expirySubjects.test.ts.

The behavioural half of that file was red-first — 11 failures at 9d3d6c8, one per (check, file)
pair the census found vacuous. The STATIC half (`gates every one of them`, `the gated set is
exactly the one this file declares`) and every FLOOR were green on their first correct run, and
a guard nobody has watched fail is not known to guard. So each rule below has a mutation written
to make exactly it speak, and the CATCHER IS NAMED BEFORE THE RUN.

Every mutation is restored in a `finally` and the restore is sha256-verified. C9 is the
must-stay-green companion: an edit that changes the register's text without changing any
premise must leave all 34 assertions green, or the file is reading formatting rather than
meaning.

⚠ AND A `finally` IS NOT ENOUGH, WHICH IS MEASURED RATHER THAN ANTICIPATED — THIS SCRIPT LEFT A
MUTATION IN THE WORKING TREE ON 2026-08-28. A 2-minute command timeout SIGTERM'd it mid-control
and the `finally` never ran, so `deploy/decision-expiry.sh` was left with D8's line reading
`if true; then` — ITS SUBJECT GATE REMOVED — and `apps/web/src/expirySubjects.test.ts` was left
with `D8: 'zzz never printed'`. Nothing about the tree looked wrong: `pnpm test` had passed
minutes earlier and `git status` showed only files the session had edited on purpose. It was
found because the NEXT harness refused to score against a red baseline.

The signal handlers below restore and then re-raise, so the exit status is still honest. They
are installed AFTER the snapshot is taken and cover SIGTERM, SIGINT and SIGHUP — a SIGKILL still
strands, and nothing in Python can change that; the defence against SIGKILL is the baseline
refusal already at the top of main().

⚠ COUNTED, NOT GUESSED, AT 82cffd5: of the 46 scripts in this directory that mutate a tracked
file and restore it in a `finally`, ZERO installed a restoring signal handler. This is the
first, and the shape is deliberately self-contained so the next one is a copy-paste rather than
an import.

Usage:  python3 scripts/w11-expiry-subject-controls.py
"""
import hashlib
import pathlib
import re
import signal
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
WEB = REPO / "apps" / "web"
TEST = "src/expirySubjects.test.ts"
REGISTER = REPO / "deploy" / "decision-expiry.sh"
GUARD = WEB / TEST


def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def restore_on_signal(snapshot: dict) -> None:
    """Put every snapshotted file back, then die of the signal we were sent.

    Re-raising with SIG_DFL is what keeps the exit status honest: a caller that killed this
    process still sees it die of that signal, not exit 0 with a tidy tree.
    """
    def handler(signum, _frame):
        for path, blob in snapshot.items():
            try:
                path.write_bytes(blob)
            except OSError:
                pass
        sys.stderr.write(
            "\n!! signal %d — restored %d mutated file(s) before exiting\n"
            % (signum, len(snapshot))
        )
        signal.signal(signum, signal.SIG_DFL)
        import os
        os.kill(os.getpid(), signum)

    for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(s, handler)


def run_guard() -> tuple[int, set[str]]:
    r = subprocess.run(
        ["npx", "vitest", "run", TEST, "--reporter=basic"],
        cwd=WEB, capture_output=True, text=True,
    )
    failed = set()
    for line in (r.stdout + r.stderr).splitlines():
        m = re.match(r"\s*(?:×|FAIL)\s+(?:src/\S+\s*>\s*)?(.*?)(?:\s+\d+ms)?$", line.strip())
        if m and m.group(1):
            failed.add(m.group(1).split(" > ")[-1].strip())
    return r.returncode, failed


def sub(path: pathlib.Path, old: str, new: str) -> None:
    text = path.read_text()
    assert text.count(old) == 1, f"anchor not unique in {path.name}: {old[:60]!r}"
    path.write_text(text.replace(old, new))


# (label, file, mutate(text-op), predicted catcher substring or None for must-stay-green)
CONTROLS = [
    (
        "C1 D8 loses its subject gate — the identity-header check greps a path again",
        REGISTER,
        lambda: sub(
            REGISTER,
            'if subject apps/bff/docs_membersync.go "the Docs nudge is a SERVICE call carrying only the transit proof"; then\n    if grep',
            "if true; then\n    if grep",
        ),
        "apps/bff/docs_membersync.go missing ⇒ D8 does not print ok",
    ),
    (
        # ⚠ THE PREDICTION WAS WRONG THE FIRST TIME AND THE RUN IS WHAT CORRECTED IT. This was
        # written expecting the D3 BEHAVIOURAL case to fail. It does not: D3 now has TWO
        # independent closures on the missing-file door — the subject gate and the numeric
        # range-check — and either one alone still voids. So removing the gate is caught by the
        # STATIC rules and by nothing else, which is what this control now claims. C2b is the
        # one that proves the behavioural D3 case is live at all.
        "C2 D3 loses its subject gate — caught by the static rule, NOT by D3's own case",
        REGISTER,
        lambda: sub(
            REGISTER,
            'if subject deploy/track-docs.compose.yaml "the member sync is ON, and log silence is a fault"; then',
            "if true; then",
        ),
        "gates every one of them",
    ),
    (
        "C2b BOTH of D3's closures removed — the behavioural case is the only thing left",
        REGISTER,
        lambda: (
            sub(
                REGISTER,
                'if subject deploy/track-docs.compose.yaml "the member sync is ON, and log silence is a fault"; then',
                "if true; then",
            ),
            sub(REGISTER, "case \"${n}\" in '' | *[!0-9]*) n=-1 ;; esac", ":"),
        ),
        "deploy/track-docs.compose.yaml missing ⇒ D3 does not print ok",
    ),
    (
        "C3 D3's numeric guard removed — an unreadable count is scored as a pass again",
        REGISTER,
        lambda: sub(REGISTER, "case \"${n}\" in '' | *[!0-9]*) n=-1 ;; esac", ":"),
        None,  # subject() now closes the missing-file door first — see the note printed below
    ),
    (
        "C4 a NEW check greps a path with no subject gate (the forward case)",
        REGISTER,
        lambda: sub(
            REGISTER,
            "# ── verdict ──",
            "grep -q 'zzz-no-such-token' deploy/Caddyfile 2>/dev/null && stale=$((stale + 0))\n\n# ── verdict ──",
        ),
        "gates every one of them",
    ),
    (
        "C5 a NEW gated path with no removal case (the other direction)",
        REGISTER,
        lambda: sub(
            REGISTER,
            "# ── verdict ──",
            'if subject deploy/Caddyfile "a decision nobody declared"; then :; fi\n\n# ── verdict ──',
        ),
        "the gated set is exactly the one this file declares, in both directions",
    ),
    (
        "C6 the register goes red on this tree (a hand-rolled build back in the runbook)",
        REPO / "deploy" / "README.md",
        lambda: (REPO / "deploy" / "README.md").write_text(
            (REPO / "deploy" / "README.md").read_text() + "\npnpm --filter @talyvor/web build\n"
        ),
        "exits 0 in this repo with every check green",
    ),
    (
        "C7 an ok mark that matches nothing — the anti-vacuity floor",
        GUARD,
        lambda: sub(GUARD, "D8: 'the Docs nudge sends no identity headers'", "D8: 'zzz never printed'"),
        "prints D8's ok line, so its absence below means something",
    ),
    (
        "C8 the sandbox stops carrying a directory the register reads",
        GUARD,
        lambda: sub(
            GUARD,
            "const SANDBOX_SOURCES = ['deploy/', 'apps/bff/', 'apps/web/vite.config.ts']",
            "const SANDBOX_SOURCES = ['deploy/', 'apps/web/vite.config.ts']",
        ),
        "produces the same ok set in a sandbox built from SANDBOX_SOURCES",
    ),
    (
        "C9 the grep-target extraction stops matching — the loop empties",
        GUARD,
        lambda: sub(
            GUARD,
            "if (line.startsWith('#') || line.startsWith('cannot ') || !/\\bgrep\\b/.test(line)) continue",
            "if (line.startsWith('#') || line.startsWith('cannot ') || !/\\bzzzgrep\\b/.test(line)) continue",
        ),
        "finds the grep targets at all",
    ),
    (
        "C10 the subject-call extraction stops matching — the other loop empties",
        GUARD,
        lambda: sub(GUARD, "\\s)subject\\s+(", "\\s)zzzsubject\\s+("),
        "finds the subject gates at all",
    ),
    (
        "C11 MUST STAY GREEN — a comment added to the register changes no premise",
        REGISTER,
        lambda: sub(REGISTER, "# ── verdict ──", "# an added comment, no premise moved\n# ── verdict ──"),
        None,
    ),
]


def main() -> int:
    # SNAPSHOT BEFORE ANYTHING RUNS. Every file any control mutates is captured here, so the
    # handler can put the tree back from whatever state a signal interrupts.
    restore_on_signal({p: p.read_bytes() for p in {c[1] for c in CONTROLS}})

    rc, failed = run_guard()
    print(f"BASELINE rc={rc} failures={sorted(failed) or 'none'}")
    if rc != 0 or failed:
        print("!! baseline is not green — every verdict below would be unreadable")
        return 2
    print()

    anomalies = 0
    for label, path, mutate, predicted in CONTROLS:
        before = sha(path)
        original = path.read_bytes()
        print(f"== {label}")
        print(f"   CATCHER PREDICTED: {predicted if predicted else 'NONE — must stay green'}")
        try:
            mutate()
            rc2, failed2 = run_guard()
            if predicted is None:
                verdict = "GREEN as predicted" if rc2 == 0 and not failed2 else f"⚠ SPOKE: {sorted(failed2)}"
                if rc2 != 0 or failed2:
                    anomalies += 1
            elif any(predicted in f for f in failed2):
                extra = sorted(f for f in failed2 if predicted not in f)
                verdict = f"CAUGHT by the named assertion ({len(failed2)} failing)"
                if extra:
                    verdict += f"; also: {extra[:3]}"
            else:
                verdict = f"⚠ NOT CAUGHT by the named assertion — failures were {sorted(failed2)}"
                anomalies += 1
            print(f"   {verdict}")
        finally:
            path.write_bytes(original)
            assert sha(path) == before, f"RESTORE FAILED for {path}"
        print()

    rc3, failed3 = run_guard()
    assert rc3 == 0 and not failed3, "tree did not return to green after the controls"
    print("=" * 78)
    print(f"anomalies: {anomalies}   tree restored to green")
    print()
    print("⚠ C3 IS DELIBERATELY 'NONE'. Removing D3's numeric guard alone changes no verdict now,")
    print("   because `subject` refuses the missing file BEFORE grep -c is ever reached. It is")
    print("   kept as a control that says so: the numeric case is a SECOND door (a grep that")
    print("   fails for any other reason on a file that IS present), and this file measures that")
    print("   it is currently unreachable through the first one rather than claiming coverage.")
    return 1 if anomalies else 0


if __name__ == "__main__":
    sys.exit(main())
