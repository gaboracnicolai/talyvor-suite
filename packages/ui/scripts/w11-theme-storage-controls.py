#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR theme-storage.test.tsx AND ITS INSTRUMENT.

The guard passed on its first run against the fixed module, which is the state this repo has
learned to distrust. Each control below mutates exactly ONE thing, names the test that MUST catch
it BEFORE the run, names a companion that MUST STAY GREEN, then restores the tree and verifies
every touched file is byte-identical to where it started.

Run from anywhere:  python3 packages/ui/scripts/w11-theme-storage-controls.py
"""
import hashlib
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
UI = ROOT / "packages/ui"
THEME = UI / "src/lib/theme.ts"
ENVFILE = UI / "src/__tests__/storage-env.ts"
CONFIG = UI / "vitest.config.ts"
TARGET = "src/__tests__/theme-storage.test.tsx"


def digest(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_target() -> tuple[bool, set[str]]:
    """Run the guard. Returns (passed, set of failing test names)."""
    r = subprocess.run(
        ["npx", "vitest", "run", TARGET, "--reporter=json", "--outputFile=/tmp/ctl.json"],
        cwd=UI, capture_output=True, text=True,
    )
    failing: set[str] = set()
    try:
        import json
        rep = json.load(open("/tmp/ctl.json"))
        for res in rep.get("testResults", []):
            for a in res.get("assertionResults", []):
                if a.get("status") == "failed":
                    failing.add(a.get("title", "?"))
    except Exception:
        # A crash before any test ran is not a caught mutation — surface it rather than score it.
        if r.returncode != 0 and "Test Files" not in (r.stdout + r.stderr):
            failing.add("<<RUN DID NOT PRODUCE A REPORT>>")
    return (r.returncode == 0, failing)


def sub_once(p: pathlib.Path, old: str, new: str) -> None:
    s = p.read_text()
    if s.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({s.count(old)}x) in {p}:\n{old[:120]}")
    p.write_text(s.replace(old, new))


CONTROLS = []


def control(name, files, mutate, catcher, green):
    CONTROLS.append((name, files, mutate, catcher, green))


# ── C1 · THE FINDING ─────────────────────────────────────────────────────────────────────────
# Put back the unguarded write exactly as it stood before this merge.
def c1():
    sub_once(THEME, """  try {
    storage()?.setItem(STORAGE_KEY, theme)
  } catch {
    // Refused. The theme is already painted and the store is about to agree with it; forgetting
    // the choice for next time must not abandon this state change half-done.
  }""", """  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, theme)""")


control("C1 the unguarded WRITE, exactly as it shipped", [THEME], c1,
        "still records the change — the store agrees with the paint",
        "paints, persists and re-labels on each press")


# ── C2 · THE READ HALF ───────────────────────────────────────────────────────────────────────
def c2():
    sub_once(THEME, """  try {
    const stored = storage()?.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Refused. Fall through to the OS preference — the same answer a first-ever visit gets.
  }""", """  const stored = storage()?.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored""")


control("C2 the unguarded READ at module init", [THEME], c2,
        "falls back instead of throwing out of module initialisation",
        "honours a stored choice when the read DOES work")


# ── C3 · BLIND THE INSTRUMENT ────────────────────────────────────────────────────────────────
# Without the shim the global is Node 26's getter yielding undefined — the state this repo was
# in before this merge, in which NONE of the refusal cases can fail.
def c3():
    sub_once(ENVFILE, "if (REAL === undefined) {", "if (false) {")


control("C3 the shim installs nothing (the pre-merge environment)", [ENVFILE], c3,
        "the AMBIENT storage works — without this the whole repo tests a dead branch",
        None)


# ── C4 · A PRESENT BUT FORGETFUL STORAGE ─────────────────────────────────────────────────────
# Distinguishes "there is a storage object" from "the write survives". A shim that swallowed
# writes would make the must-stay-green half vacuous while every other case still passed.
def c4():
    sub_once(ENVFILE, """    setItem: (k: string, v: string) => {
      m.set(String(k), String(v))
    },""", """    setItem: () => {},""")


control("C4 the shim accepts writes and forgets them", [ENVFILE], c4,
        "paints, persists and re-labels on each press",
        "is not stuck — a second press returns to light")


# ── C5 · THE ORDERING CLAIM ──────────────────────────────────────────────────────────────────
# storage-env.ts documents itself as setupFiles[0] "because lib/theme.ts reads storage during
# MODULE INITIALISATION". This control falsifies that claim rather than trusting the sentence.
def c5():
    sub_once(CONFIG, "setupFiles: ['./src/__tests__/storage-env.ts', './src/__tests__/setup.ts']",
             "setupFiles: ['./src/__tests__/setup.ts', './src/__tests__/storage-env.ts']")


control("C5 the shim runs AFTER the project setup", [CONFIG], c5, None, None)


def main() -> int:
    print("baseline: ", end="", flush=True)
    ok, fails = run_target()
    if not ok:
        print(f"NOT GREEN — {sorted(fails)}")
        return 2
    print("green\n")

    results = []
    for name, files, mutate, catcher, green in CONTROLS:
        # ⚠ RESTORE FROM THE BYTES, NEVER FROM git checkout. Every file these controls mutate
        # carries UNCOMMITTED work — the fix under test is uncommitted by construction — so
        # `git checkout --` would silently revert the merge instead of the mutation.
        saved = {f: f.read_bytes() for f in files}
        before = {f: digest(f) for f in files}
        mutate()
        for f in files:
            assert digest(f) != before[f], f"{name}: mutation changed no bytes in {f}"
        ok, fails = run_target()
        for f in files:
            f.write_bytes(saved[f])
            assert digest(f) == before[f], f"{name}: {f} NOT restored byte-identically"

        if catcher is None:
            verdict = "NOT CAUGHT (expected — see notes)" if ok else f"CAUGHT by {sorted(fails)}"
        elif catcher in fails:
            verdict = "CAUGHT by the predicted test"
            if green and green in fails:
                verdict = f"CAUGHT — ⚠ BUT THE COMPANION ALSO RED ({green})"
        elif fails:
            verdict = f"CAUGHT BY THE WRONG TEST — predicted {catcher!r}, red: {sorted(fails)}"
        else:
            verdict = "NOT CAUGHT"
        results.append((name, verdict, sorted(fails)))
        print(f"{name}\n    {verdict}\n    red: {sorted(fails)}\n")

    print("=" * 70)
    for n, v, _ in results:
        print(f"{v:52s} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
