#!/usr/bin/env python3
"""Positive controls for TestEveryEnvVarTheBinaryReadsIsDocumented (suite W1.1).

The guard asserts that every environment variable apps/bff reads is NAMED in deploy/README.md and
deploy/bff.env.example. A documentation guard is the easiest kind to write vacuously — it passes
whether it read the right file, the right symbols, or nothing at all — so every part of it is
controlled separately:

  · the DOC side  (C1, C2, C3, C8)  — does it really read those two files, per file and per name?
  · the SOURCE side (C4, C5)        — does it really derive the read-set from the AST, including
                                      the constant-resolved read that a grep cannot see?
  · the EXTRACTOR itself (C6, C7, C9) — does an argument it cannot resolve FAIL rather than skip;
                                      is the envOr exemption by-name and non-swallowing; does the
                                      floor fire when the extractor reads nothing?

Verdict is a PAIR, predicted before the run: the set of (VARIABLE, document) pairs reported, and
the set of extractor-level messages raised. C0 is the must-stay-green. C1 is not a mutation — it
restores both documents to origin/main, the state as it shipped.

Usage: python3 scripts/w11-env-documented-controls.py [--only C5]
"""

import hashlib
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README = "deploy/README.md"
EXAMPLE = "deploy/bff.env.example"
OPERATOR = "apps/bff/operator.go"
MAIN = "apps/bff/main.go"
GUARD = "apps/bff/env_documented_test.go"
TOUCHED = [README, EXAMPLE, OPERATOR, MAIN, GUARD]

TEST_CMD = ["go", "test", "-count=1", "-run", "TestEveryEnvVarTheBinaryReadsIsDocumented", "."]
# ⚠ RUN FROM apps/bff, WHERE go.mod IS. The first version of this harness ran `go test ./apps/bff/`
# from the repo root; there is no module there, so every invocation printed "cannot find main
# module", matched none of the regexes below, and scored as "no failures reported". NINE controls
# read as silent and C0 — the must-stay-green — PASSED, because a must-stay-green cannot tell
# "nothing is wrong" from "nothing ran". assert_ran() below is the fix: the harness now proves the
# test executed before it is allowed to interpret the absence of output.
TEST_CWD = os.path.join(REPO, "apps", "bff")

# Every variable the binary reads — the guard's own subject, spelled out here so C8's prediction is
# a list rather than a number nobody checked.
ALL_VARS = [
    "BFF_ADDR", "BFF_AUTH_MODE", "BFF_PUBLIC_BASE_URL", "BFF_SESSION_TTL", "DOCS_BASE_URL",
    "DOCS_GATEWAY_SECRET", "LENS_API_KEY", "LENS_BASE_URL", "LENS_PROVISION_SECRET",
    "LENS_PUBLIC_BASE_URL", "OIDC_ALLOWED_EMAILS", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET",
    "OIDC_ISSUER", "OPERATOR_SUBS", "TRACK_BASE_URL", "TRACK_GATEWAY_SECRET", "TRACK_WORKSPACE_ID",
    "WEB_DIST",
]

README_LPU_ROW = open(os.path.join(REPO, README), encoding="utf-8").read().split("\n")
README_LPU_ROW = [l for l in README_LPU_ROW if l.startswith("| `LENS_PUBLIC_BASE_URL`")][0] + "\n"

OP_IMPORT = """import (
	"log"
	"net/http"
	"strings"
)"""
OP_IMPORT_OS = """import (
	"log"
	"net/http"
	"os"
	"strings"
)"""
OP_CONST = 'const operatorSubsEnv = "OPERATOR_SUBS"'

ENVOR_READ = "\tif v := os.Getenv(key); v != \"\" {"
ENVOR_READ_LITERAL = "\tif v := os.Getenv(\"BFF_ENVOR_LITERAL\"); v != \"\" {"

GUARD_FILTER = """	pkgs, err := parser.ParseDir(fset, ".", func(fi os.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)"""
# ⚠ THE BLIND FILTER STILL USES `strings`. The first version returned a bare `false`, which left
# the guard file's `strings` import unused — a COMPILE ERROR, so the control compiled nothing and
# the harness scored it build_failed rather than caught. A control that breaks the build is not a
# control, and the only reason that was visible is that build failures are detected explicitly.
GUARD_FILTER_BLIND = """	pkgs, err := parser.ParseDir(fset, ".", func(fi os.FileInfo) bool {
		return strings.HasSuffix(fi.Name(), ".no-such-suffix")
	}, 0)"""


def pair(v, doc):
    return (v, doc)


CONTROLS = [
    dict(id="C0", kind="must-stay-green", edits=[], restore=[],
         why="No mutation. The documented tree must come back with no reported pair and no "
             "extractor message, or every verdict below is read off a broken instrument.",
         pairs=set(), flags=set()),
    dict(id="C1", kind="restore-to-origin/main", edits=[], restore=[README, EXAMPLE],
         why="THE STATE AS IT SHIPPED — both documents checked out from origin/main, nothing "
             "mutated. Two variables, two documents, four pairs: LENS_PUBLIC_BASE_URL (the Setup "
             "page's whole precondition) and OPERATOR_SUBS (the operator boundary, read through a "
             "named constant and therefore invisible to the grep that found the first one).",
         pairs={pair("LENS_PUBLIC_BASE_URL", "README.md"), pair("LENS_PUBLIC_BASE_URL", "bff.env.example"),
                pair("OPERATOR_SUBS", "README.md"), pair("OPERATOR_SUBS", "bff.env.example")},
         flags=set()),
    dict(id="C2", kind="mutation", restore=[],
         edits=[(README, README_LPU_ROW, "")],
         why="The whole README row DELETED — one name gone from ONE document. Proves the guard is "
             "per-(variable, document) and not satisfied by the name appearing in the other one. "
             "⚠ THIS CONTROL WAS INERT ON ITS FIRST RUN: it renamed only the table key "
             "(`| `LENS_PUBLIC_BASE_URL` |` -> `..._XX`), and the row's prose says the name three "
             "more times, so the file still contained it. A mutation that leaves the subject in "
             "place is not a control.",
         pairs={pair("LENS_PUBLIC_BASE_URL", "README.md")}, flags=set()),
    dict(id="C3", kind="mutation", restore=[],
         edits=[(EXAMPLE, "#OPERATOR_SUBS=110248495000000000000", "#OPERATOR_SUBS_XX=110248495000000000000")],
         why="The mirror in the other document, on the other variable — and a SUFFIX RENAME rather "
             "than a deletion, which is the mutation that made the guard's predicate stricter. "
             "Under the original `strings.Contains` this was inert (OPERATOR_SUBS_XX contains "
             "OPERATOR_SUBS); the guard now matches on word boundaries, so a variable renamed with "
             "a suffix no longer counts as documented by its own old name.",
         pairs={pair("OPERATOR_SUBS", "bff.env.example")}, flags=set()),
    dict(id="C4", kind="mutation", restore=[],
         edits=[(OPERATOR, OP_IMPORT, OP_IMPORT_OS),
                (OPERATOR, OP_CONST, OP_CONST + '\n\nvar _ = os.Getenv("BFF_NEW_LITERAL_KNOB")')],
         why="A NEW env read added to the binary as a string literal. Proves the source side is "
             "live — the guard derives its subject from the code rather than re-reading a pinned "
             "list that would stay green as the config surface grows.",
         pairs={pair("BFF_NEW_LITERAL_KNOB", "README.md"), pair("BFF_NEW_LITERAL_KNOB", "bff.env.example")},
         flags=set()),
    dict(id="C5", kind="mutation", restore=[],
         edits=[(OPERATOR, OP_IMPORT, OP_IMPORT_OS),
                (OPERATOR, OP_CONST, OP_CONST + '\n\nconst newKnobEnv = "BFF_NEW_CONST_KNOB"\n\nvar _ = os.Getenv(newKnobEnv)')],
         why="THE MUTATION ONLY THIS GUARD CAN SEE. The same new read, but through a named "
             "constant — exactly the shape that hid OPERATOR_SUBS from the grep that produced the "
             "first (wrong) census. A text-matching guard is green here.",
         pairs={pair("BFF_NEW_CONST_KNOB", "README.md"), pair("BFF_NEW_CONST_KNOB", "bff.env.example")},
         flags=set()),
    dict(id="C6", kind="mutation", restore=[],
         edits=[(OPERATOR, OP_IMPORT, OP_IMPORT_OS),
                (OPERATOR, OP_CONST, OP_CONST + '\n\nvar newKnobKey = "BFF_UNRESOLVABLE"\n\nvar _ = os.Getenv(newKnobKey)')],
         why="A read whose argument the extractor CANNOT resolve (a var, not a const). It must "
             "FAIL rather than skip: an unreadable read is precisely the one that goes "
             "undocumented, and silently ignoring it is how a source-derived guard goes hollow.",
         pairs=set(), flags={"cannot resolve"}),
    dict(id="C7", kind="mutation", restore=[],
         edits=[(MAIN, ENVOR_READ, ENVOR_READ_LITERAL)],
         why="envOr's own body stops reading its parameter. The by-name exemption for that one "
             "read must notice it is gone — otherwise the exemption is a hole any future helper "
             "could fall into. The planted literal is also reported, which is the second half of "
             "the same claim.",
         pairs={pair("BFF_ENVOR_LITERAL", "README.md"), pair("BFF_ENVOR_LITERAL", "bff.env.example")},
         flags={"expected exactly 1 skipped read"}),
    dict(id="C8", kind="mutation", restore=[], truncate=[README],
         edits=[],
         why="deploy/README.md emptied. EVERY variable must be reported against it and NONE "
             "against bff.env.example — the control that proves the guard reads that path, that "
             "file, and all 19 names, rather than one lucky substring.",
         pairs={pair(v, "README.md") for v in ALL_VARS}, flags=set()),
    dict(id="C9", kind="mutation", restore=[],
         edits=[(GUARD, GUARD_FILTER, GUARD_FILTER_BLIND)],
         why="THE VACUITY FLOOR. The extractor is blinded so it parses no files at all. Without "
             "the floor this reports zero pairs and PASSES — a documentation guard that read "
             "nothing is green for every possible repository.",
         pairs=set(), flags={"env vars extracted", "expected exactly 1 skipped read"}),
    # ⚠ BOTH flags, and the second one was not predicted the first time: with no files parsed there
    # is no envOr body to skip either, so helperSkips is 0. The floor and the exemption check are
    # two assertions and a blinded extractor moves both — printing the set rather than a verdict is
    # what made that visible.
]

# ⚠ THE FIRST VERSION OF THIS REGEX WAS NON-GREEDY (`(\S+?)\.`) and captured "README" and
# "bff" instead of "README.md" and "bff.env.example" — so every prediction naming a document
# mismatched while the guard was behaving perfectly. Greedy, anchored to the line end.
PAIR_RE = re.compile(r"(\S+) is read by the BFF \(env\) but is named nowhere in (\S+)\.\n")
BUILD_RE = re.compile(r"\[build failed\]|^# \S+", re.M)
FLAG_MARKERS = ["cannot resolve", "expected exactly 1 skipped read", "env vars extracted"]


def read(p):
    with open(os.path.join(REPO, p), encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(os.path.join(REPO, p), "w", encoding="utf-8") as f:
        f.write(s)


def sha(p):
    with open(os.path.join(REPO, p), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


RAN_RE = re.compile(r"^(ok|FAIL|---)\s", re.M)


def run():
    p = subprocess.run(TEST_CMD, cwd=TEST_CWD, capture_output=True, text=True)
    out = p.stdout + p.stderr
    # THE HARNESS'S OWN FLOOR. An empty pair set means "the guard reported nothing" ONLY if the
    # guard ran; without this, a toolchain error reads as a clean run and every control scores
    # silent. Raised, not printed: a control sweep that cannot prove it executed has no verdict.
    if not RAN_RE.search(out):
        raise SystemExit("harness: `go test` produced no ok/FAIL line — it did not run:\n" + out[:600])
    pairs = set(PAIR_RE.findall(out))
    flags = {m for m in FLAG_MARKERS if m in out}
    return pairs, flags, bool(BUILD_RE.search(out)), out


def apply(c, originals):
    for path in c.get("restore", []):
        r = subprocess.run(["git", "checkout", "origin/main", "--", path], cwd=REPO,
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit(f"{c['id']}: checkout {path}: {r.stderr}")
    for path in c.get("truncate", []):
        write(path, "")
    if not c["edits"]:
        return
    bufs = {}
    for path, old, new in c["edits"]:
        buf = bufs.get(path, originals[path])
        n = buf.count(old)
        if n != 1:
            raise SystemExit(f"{c['id']}: anchor count {n} (want 1) in {path}: {old[:90]!r}")
        bufs[path] = buf.replace(old, new, 1)
    for path, buf in bufs.items():
        write(path, buf)
        if read(path) != buf:
            raise SystemExit(f"{c['id']}: {path} did not land on disk")


def main():
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    originals = {p: read(p) for p in TOUCHED}
    before = {p: sha(p) for p in TOUCHED}
    results = []
    try:
        for c in CONTROLS:
            if only and c["id"] != only:
                continue
            for p in TOUCHED:
                write(p, originals[p])
            apply(c, originals)
            pairs, flags, build, out = run()
            ok = pairs == c["pairs"] and flags == c["flags"] and not build
            results.append((c, pairs, flags, build, ok))
            print(f"\n=== {c['id']} [{c['kind']}] {'AS PREDICTED' if ok else '*** NOT AS PREDICTED ***'}")
            print(f"    why:   {c['why']}")
            print(f"    pairs: want {sorted(c['pairs'])}")
            print(f"           got  {sorted(pairs)}")
            print(f"    flags: want {sorted(c['flags'])}  got {sorted(flags)}")
            if build:
                print("    !! BUILD FAILURE — this control compiled nothing; its red is meaningless")
                print("\n".join(l for l in out.splitlines() if BUILD_RE.search(l))[:600])
    finally:
        for p in TOUCHED:
            write(p, originals[p])
        after = {p: sha(p) for p in TOUCHED}
        bad = [p for p in TOUCHED if before[p] != after[p]]
        print("\n" + "=" * 96)
        print(f"!! RESTORE FAILED for {bad}" if bad
              else "restore verified: sha256 of every touched file matches the pre-run bytes")

    good = sum(1 for r in results if r[4])
    print(f"\n{good}/{len(results)} AS PREDICTED")
    for c, pairs, flags, build, ok in results:
        if not ok:
            print(f"  {c['id']}: pairs {sorted(pairs)} vs {sorted(c['pairs'])} | "
                  f"flags {sorted(flags)} vs {sorted(c['flags'])} | build_failed={build}")
    return 0 if good == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
