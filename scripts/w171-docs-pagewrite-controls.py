#!/usr/bin/env python3
"""w171-docs-pagewrite-controls.py — positive controls for the two settle commands added to
deploy/decision-expiry.sh for the talyvor-docs PAGE-WRITE seam (W1.7.1).

The two premises live in talyvor-docs, so the commands cannot run in this repo's CI. What CAN be
proved here is that each command SAYS NO when its premise moves — including the two vacuity cases
(subject renamed, file emptied), which is where a command that reads an exit status lies.

Every mutation is applied to a DISPOSABLE `git archive` export of talyvor-docs. The real repo is
never touched; it is read through the object store, not the working tree, so another tab holding
that repo cannot make this measurement lie either.

Each control names its PREDICTION before it runs. A control that cannot fail proves nothing, so
the matrix carries must-stay-GREEN companions (a reworded comment) alongside the reds — otherwise
"RED" would just mean "the command is brittle".

Usage:  scripts/w171-docs-pagewrite-controls.py [<docs-sha>]
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DOCS_REPO = Path.home() / "talyvor-docs"

# ── The two commands, EXTRACTED FROM decision-expiry.sh AS IT PRINTS THEM ──────
#
# ⚠ THIS IS NOT A CONVENIENCE. The first version of this harness hardcoded the two commands as
# Python string constants and ran THOSE — so it proved a string that no deployer will ever run.
# The shipped command survives two levels of quoting (a bash double-quoted argument, printed, then
# re-parsed by the deployer's shell) and the escaping is exactly where a settle command dies
# quietly: over-escape it and `grep -o '\"[a-z_]*\"'` searches for a literal backslash. Both
# spellings can still exit 0 on a healthy upstream. The only honest instrument is the printed one.
SUITE_ROOT = Path(__file__).resolve().parent.parent
REGISTER = SUITE_ROOT / "deploy" / "decision-expiry.sh"


def printed_commands() -> tuple[str, str]:
    out = subprocess.run(
        ["bash", str(REGISTER)], capture_output=True, text=True, cwd=SUITE_ROOT
    ).stdout
    found = {}
    for line in out.split("\n"):
        line = line.strip()
        if not line.startswith("settle it with:"):
            continue
        cmd = line[len("settle it with:") :].strip()
        if "updatableFields" in cmd and "internal/page/store.go" in cmd:
            found["A"] = cmd
        elif "internal/page/handler.go" in cmd and "Decode(&in)" in cmd:
            found["B"] = cmd
    missing = {"A", "B"} - found.keys()
    if missing:
        raise SystemExit(f"HARNESS FAILED: {sorted(missing)} not printed by {REGISTER}")
    return found["A"], found["B"]


CMD_A, CMD_B = printed_commands()

STORE = "internal/page/store.go"
HANDLER = "internal/page/handler.go"


def run(cmd: str, cwd: Path) -> int:
    return subprocess.run(["bash", "-c", cmd], cwd=cwd).returncode


def sub(root: Path, rel: str, old: str, new: str) -> None:
    p = root / rel
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"CONTROL SETUP FAILED: {old!r} not found in {rel}")
    p.write_text(text.replace(old, new, 1))


# (name, command, mutation fn, predicted "RED"|"GREEN", why)
CONTROLS = [
    (
        "A0  no mutation",
        CMD_A,
        lambda r: None,
        "GREEN",
        "the honest baseline — if this is not green the command is measuring nothing",
    ),
    (
        "A1  the content_text exception REMOVED",
        CMD_A,
        lambda r: sub(r, STORE, '!allowed && k != "content_text"', "!allowed"),
        "RED",
        "THE DEFECT. The suite editor's only write is content_text; with the exception gone the "
        "key is dropped in silence and Update still answers 200 with the page body",
    ),
    (
        "A2  an allowlist key RENAMED (title -> page_title)",
        CMD_A,
        lambda r: sub(r, STORE, '\t"title": {}, "content"', '\t"page_title": {}, "content"'),
        "RED",
        "the other key this app PATCHes; a rename upstream is a silently dropped title write",
    ),
    (
        "A3  a key ADDED to the allowlist (ai_cost_usd)",
        CMD_A,
        lambda r: sub(r, STORE, '"updated_by": {}, "page_type": {},', '"updated_by": {}, "page_type": {}, "ai_cost_usd": {},'),
        "RED",
        "widening is drift too — ai_cost_usd was in this list once and a PATCH drove a real "
        "page to a reported -$958",
    ),
    (
        "A4  updatableFields RENAMED (the subject is gone)",
        CMD_A,
        lambda r: sub(r, STORE, "var updatableFields = map[string]struct{}{", "var updatableCols = map[string]struct{}{"),
        "RED",
        "VACUITY CASE ONE: sed captures nothing, every stage still exits 0, and a command that "
        "read an exit status would report the premise confirmed",
    ),
    (
        "A5  store.go EMPTIED",
        CMD_A,
        lambda r: (r / STORE).write_text(""),
        "RED",
        "VACUITY CASE TWO: a command that finds nothing must not pass",
    ),
    (
        "A6  the COMMENT that quotes the exception reworded",
        CMD_A,
        lambda r: sub(r, STORE, 'explicit `k != "content_text"` below', "explicit exception below"),
        "GREEN",
        "MUST-STAY-GREEN: the command must read the code predicate, not the prose about it. "
        "The naive `grep -o 'k != \"content_text\"'` matched this comment line TOO and would "
        "red here — which is why the command is anchored on `!allowed &&`",
    ),
    (
        "B0  no mutation",
        CMD_B,
        lambda r: None,
        "GREEN",
        "the honest baseline",
    ),
    (
        "B1  Create binds its OWN request struct",
        CMD_B,
        lambda r: sub(r, HANDLER, "var in model.Page", "var in createPageBody"),
        "RED",
        "the exact fragility case: the DocsPage mirror stays green while the create request "
        "shape moves out from under it",
    ),
    (
        "B2  Create RENAMED (the subject is gone)",
        CMD_B,
        lambda r: sub(r, HANDLER, "func (h *Handler) Create(", "func (h *Handler) CreatePage("),
        "RED",
        "VACUITY CASE ONE for B — empty capture must not compare equal",
    ),
    (
        "B3  handler.go EMPTIED",
        CMD_B,
        lambda r: (r / HANDLER).write_text(""),
        "RED",
        "VACUITY CASE TWO for B",
    ),
    (
        "B4  the SEC-4 comment reworded",
        CMD_B,
        lambda r: sub(r, HANDLER, "// SEC-4: model.Page carries workspace_id", "// SEC-4: the page model carries workspace_id"),
        "GREEN",
        "MUST-STAY-GREEN: prose is not the premise",
    ),
]


# ── THE IN-REPO HALF ───────────────────────────────────────────────────────────
# The two commands above ask talyvor-docs the question. Their expected key sets are LITERALS,
# and a literal is maintained by whoever remembers it. apps/web/src/docsPageWriteRegister.test.ts
# holds them to the body this app actually sends. It PASSED ON ITS FIRST RUN, so it is suspect
# until each of these has been seen to red.
IN_REPO_TEST = "src/docsPageWriteRegister.test.ts"
API_TS = SUITE_ROOT / "apps" / "web" / "src" / "areas" / "docs" / "api.ts"


def edit(path: Path, old: str, new: str):
    def go():
        text = path.read_text()
        if old not in text:
            raise SystemExit(f"CONTROL SETUP FAILED: {old!r} not in {path}")
        path.write_text(text.replace(old, new, 1))

    return go


IN_REPO_CONTROLS = [
    (
        "R0  no mutation",
        lambda: None,
        "GREEN",
        "the honest baseline",
    ),
    (
        "R1  a THIRD key added to updatePage's patch type",
        edit(
            API_TS,
            "patch: { title?: string; content_text?: string }",
            "patch: { title?: string; content_text?: string; icon?: string }",
        ),
        "RED",
        "THE POINT OF THE FILE: a key added to the wire without asking Docs whether it is "
        "applicable. `icon` happens to BE applicable upstream, which is exactly why the test "
        "must red anyway — the register is the record that somebody checked",
    ),
    (
        "R2  a key REMOVED from the register's expected set",
        edit(SUITE_ROOT / "deploy" / "decision-expiry.sh", "content_text content cover_url", "content cover_url"),
        "RED",
        "the register stops claiming content_text is applicable while the editor still sends it",
    ),
    (
        "R3  the page-UPDATE register entry DELETED",
        edit(
            SUITE_ROOT / "deploy" / "decision-expiry.sh",
            "cannot \"talyvor-docs page UPDATE applies updatableFields",
            "cannot_DELETED \"talyvor-docs page UPDATE applies updatableFields",
        ),
        "RED",
        "VACUITY: the only thing asking Docs about this seam is gone. A subset check against an "
        "absent register would otherwise pass by finding nothing to contradict it",
    ),
    (
        "R4  the PROSE BLOCK above the entry reworded",
        edit(SUITE_ROOT / "deploy" / "decision-expiry.sh", "# ⚠ THE DocsPage MIRROR ABOVE DOES NOT COVER THE PATCH", "# ⚠ The page mirror does not cover the PATCH"),
        "GREEN",
        "MUST-STAY-GREEN, and the one that caught a real bug in this file: the first selector "
        "matched the file name and the symbol, which the PROSE also names, so it parsed the "
        "comment instead of the command. Prose is not the premise, one layer out",
    ),
]


def run_in_repo() -> int:
    web = SUITE_ROOT / "apps" / "web"
    originals = {
        p: p.read_text()
        for p in [API_TS, SUITE_ROOT / "deploy" / "decision-expiry.sh"]
    }
    failures = 0
    print("\n── in-repo controls on docsPageWriteRegister.test.ts ──\n")
    for name, mutate, predicted, why in IN_REPO_CONTROLS:
        try:
            mutate()
            rc = subprocess.run(
                ["npx", "vitest", "run", IN_REPO_TEST],
                cwd=web,
                capture_output=True,
                text=True,
            ).returncode
            actual = "GREEN" if rc == 0 else "RED"
            ok = actual == predicted
            failures += 0 if ok else 1
            print(f"  [{'ok  ' if ok else 'FAIL'}] {name}")
            print(f"          predicted {predicted}, got {actual}")
            print(f"          {why}")
        finally:
            for p, text in originals.items():
                p.write_text(text)
    return failures


def main() -> int:
    sha = sys.argv[1] if len(sys.argv) > 1 else "HEAD"
    resolved = subprocess.run(
        ["git", "rev-parse", sha], cwd=DOCS_REPO, capture_output=True, text=True, check=True
    ).stdout.strip()
    print(f"upstream: talyvor-docs {resolved}  (read from the object store, not the working tree)")
    print(f"controls: {len(CONTROLS)}\n")

    failures = 0
    for name, cmd, mutate, predicted, why in CONTROLS:
        tmp = Path(tempfile.mkdtemp(prefix="w171-"))
        try:
            export = tmp / "docs"
            export.mkdir()
            tar = subprocess.Popen(
                ["git", "archive", resolved], cwd=DOCS_REPO, stdout=subprocess.PIPE
            )
            subprocess.run(["tar", "-x", "-C", str(export)], stdin=tar.stdout, check=True)
            tar.wait()

            mutate(export)
            rc = run(cmd, export)
            actual = "GREEN" if rc == 0 else "RED"
            ok = actual == predicted
            failures += 0 if ok else 1
            print(f"  [{'ok  ' if ok else 'FAIL'}] {name}")
            print(f"          predicted {predicted}, got {actual}  (exit {rc})")
            print(f"          {why}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    failures += run_in_repo()

    total = len(CONTROLS) + len(IN_REPO_CONTROLS)
    print()
    if failures:
        print(f"{failures} CONTROL(S) FAILED — the guards do not do what this file claims")
        return 1
    print(f"all {total} controls matched their prediction")
    return 0


if __name__ == "__main__":
    sys.exit(main())
