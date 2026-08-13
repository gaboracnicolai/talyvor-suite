#!/usr/bin/env python3
"""w24-7a3e — the census W0.1's audit explicitly DECLINED to make.

That audit says, in the queue, of its own probe:

    "one probe in this audit was contaminated and is reported as saying NOTHING: grepping the
     suite area for `export` matched 10 of 13 files because `export` is a JavaScript keyword,
     so this audit makes NO CLAIM AT ALL about export or keyboard-first ops."

Two of W2.4's five ordered deliverables are therefore unmeasured. This script measures them over
BOTH Track front-ends — the suite area and the track repo's own frontend — with detectors that
cannot be satisfied by the ES-module keyword, and with a POSITIVE CONTROL on every detector so a
zero is a measurement rather than a blind.

⚠ THE CONTAMINATION IS THE WHOLE REASON FOR THE DETECTOR SHAPES. `export` opens almost every line
of a TypeScript module, so any probe keyed on the bare word answers "present" for a codebase with
no export feature whatsoever. What a USER-FACING export actually needs is a byte sink and a
filename: Blob / createObjectURL / a `download` attribute / a Content-Disposition, or a link to a
server route that emits one. Those are the things counted here. The keyword is counted too — but
only to SHOW the contamination, never as evidence of a feature.

⚠ EVERY DETECTOR IS POSITIVE-CONTROLLED against a synthetic fixture written at run time and
deleted after. A detector that matches nothing in the corpus AND nothing in a file built to
contain exactly what it looks for is broken, not conclusive — and the two are byte-indistinguishable
in a report that only prints the corpus count.
"""
import os
import re
import subprocess
import sys
import tempfile

SUITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUITE_AREA = os.path.join(SUITE, "apps", "web", "src", "areas", "track")
SUITE_WEB = os.path.join(SUITE, "apps", "web", "src")
# talyvor-track is ANOTHER TAB'S REPO. It is read through `git show` of the COMMITTED tree only —
# never the working tree, which may hold that tab's in-progress edits, and never with a fetch.
TRACK_REPO = os.path.expanduser("~/talyvor-track")
TRACK_FRONTEND_PREFIX = "frontend/src/"

# ── detectors ────────────────────────────────────────────────────────────────────────────────
# Each is (name, regex, what a hit would MEAN). None of them can be satisfied by `export const`.
EXPORT_DETECTORS = [
    ("blob", r"new\s+Blob\s*\(", "builds bytes in the browser to hand to the user"),
    ("objecturl", r"URL\.createObjectURL\s*\(", "turns those bytes into a downloadable href"),
    ("download-attr", r"\.download\s*=|download=[\"{]", "names the file the browser saves"),
    ("csv-mime", r"text/csv|application/csv", "declares a spreadsheet payload"),
    ("content-disposition", r"[Cc]ontent-[Dd]isposition", "a server-side attachment header"),
    # ⚠ `[^"'`\n]`, NOT `[^"'`]`. THE FIRST DRAFT OF THIS LINE REPEATED THE EXACT MISTAKE THIS
    # SCRIPT EXISTS TO CORRECT. Without the newline exclusion the character class runs across
    # line boundaries, so a quote far above and a quote far below bracket anything between them —
    # and it reported 3 "export route" hits in the suite web app that were, on inspection, the
    # REGEX LITERAL `/export\s+const\s+.../` inside figureFace.test.ts, focusAudit.test.tsx and
    # formatterReach.test.ts. Three source files' worth of a feature that does not exist. It was
    # caught only because the report PRINTS THE MATCHED TEXT; a probe that prints counts alone
    # would have shipped the same false claim in the other direction.
    ("export-route", r"[\"'`][^\"'`\n]*/export[^\"'`\n]*[\"'`]", "calls a route whose path is an export"),
    ("saveas", r"saveAs\s*\(|file-saver", "the usual third-party download helper"),
]

KEYBOARD_DETECTORS = [
    ("onkeydown", r"onKeyDown|onKeyUp|onKeyPress", "a React keyboard handler"),
    ("keydown-listener", r"addEventListener\s*\(\s*[\"'`]key(down|up|press)", "a document-level key listener"),
    ("key-compare", r"\.key\s*===|\.code\s*===|e\.key\b|event\.key\b", "branches on which key"),
    ("modifier", r"metaKey|ctrlKey|altKey|shiftKey", "a chorded shortcut"),
    ("hotkey-lib", r"useHotkeys|react-hotkeys|hotkeys-js|kbar|cmdk", "a shortcut/command-palette library"),
    ("kbd-ui", r"<kbd|⌘|Cmd\+|Ctrl\+", "tells the user a shortcut exists"),
]

# The contaminated probe, kept ONLY to show what it answers.
KEYWORD_PROBE = ("es-module-keyword", r"\bexport\b", "the ES-module keyword — NOT a feature")

# ── positive-control fixture: one file containing a hit for every detector above ──────────────
CONTROL_FIXTURE = """
// synthetic positive control — every detector above must fire on this file.
export const notAFeature = 1;                      // the contaminated keyword
const blob = new Blob(["a,b\\n1,2"], { type: "text/csv" });
const href = URL.createObjectURL(blob);
const a = document.createElement("a");
a.download = "issues.csv";
fetch("/api/track/issues/export").then(r => r.headers.get("Content-Disposition"));
saveAs(blob, "issues.csv");
export function Row() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "j" && (e.metaKey || e.ctrlKey)) next();
  });
  useHotkeys("g i", go);
  return <div onKeyDown={(event) => event.key === "Escape" && close()}><kbd>Cmd+K</kbd></div>;
}
"""


def suite_files():
    """(label, path, text) for every .ts/.tsx under the suite web app."""
    out = []
    for root, _dirs, files in os.walk(SUITE_WEB):
        if "node_modules" in root:
            continue
        for f in sorted(files):
            if f.endswith((".ts", ".tsx")):
                p = os.path.join(root, f)
                with open(p, encoding="utf-8") as fh:
                    out.append((os.path.relpath(p, SUITE), p, fh.read()))
    return out


def track_files():
    """(label, path, text) for the track repo's frontend, from the COMMITTED tree only."""
    if not os.path.isdir(TRACK_REPO):
        raise SystemExit(f"REFUSED: {TRACK_REPO} is not present — an absent corpus is not an empty one")
    listing = subprocess.run(["git", "ls-tree", "-r", "--name-only", "main", TRACK_FRONTEND_PREFIX],
                             cwd=TRACK_REPO, capture_output=True, text=True, check=True).stdout.split()
    paths = [p for p in listing if p.endswith((".ts", ".tsx", ".js", ".jsx", ".vue"))]
    if not paths:
        raise SystemExit("REFUSED: the track frontend census found ZERO source files — that is a "
                         "broken path, not an empty front-end")
    out = []
    for p in paths:
        text = subprocess.run(["git", "show", f"main:{p}"], cwd=TRACK_REPO,
                              capture_output=True, text=True, check=True).stdout
        out.append((p, p, text))
    return out


def scan(corpus, detectors):
    """{detector: [labels that matched]} plus the total file count."""
    hits = {name: [] for name, _rx, _why in detectors}
    for label, _path, text in corpus:
        for name, rx, _why in detectors:
            if re.search(rx, text):
                hits[name].append(label)
    return hits


def control(detectors):
    """Every detector MUST fire on the synthetic fixture. Returns the list that did not."""
    with tempfile.NamedTemporaryFile("w", suffix=".tsx", delete=False, encoding="utf-8") as fh:
        fh.write(CONTROL_FIXTURE)
        path = fh.name
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        return [name for name, rx, _why in detectors if not re.search(rx, text)]
    finally:
        os.unlink(path)


def report(title, corpus, detectors):
    print(f"\n── {title} — {len(corpus)} source file(s) ─────────────────────────")
    hits = scan(corpus, detectors)
    any_hit = False
    for name, _rx, why in detectors:
        files = hits[name]
        mark = "HIT " if files else "  0 "
        print(f"  {mark}{name:22s} {len(files):3d} file(s)   — {why}")
        for f in files[:6]:
            print(f"         · {f}")
        if len(files) > 6:
            print(f"         · … and {len(files) - 6} more")
        any_hit = any_hit or bool(files)
    return any_hit


def main():
    print("POSITIVE CONTROLS (synthetic fixture — every detector must fire):")
    for label, dets in (("export", EXPORT_DETECTORS), ("keyboard", KEYBOARD_DETECTORS),
                        ("keyword probe", [KEYWORD_PROBE])):
        dead = control(dets)
        print(f"  {label:14s} {len(dets) - len(dead)}/{len(dets)} fired"
              f"{'' if not dead else '   ✗ DEAD: ' + ', '.join(dead)}")
        if dead:
            raise SystemExit("REFUSED: a detector that cannot fire on a file built to contain "
                             "exactly what it looks for measures nothing. Fix it before reading "
                             "any zero below as an answer.")

    suite = suite_files()
    area = [(l, p, t) for l, p, t in suite if "areas/track" in l]
    track = track_files()

    print("\n╔══ THE CONTAMINATION, SHOWN RATHER THAN ASSERTED ═══════════════════════════╗")
    for label, corpus in (("suite track area", area), ("suite web (all)", suite),
                          ("track frontend", track)):
        n = len([1 for _l, _p, t in corpus if re.search(KEYWORD_PROBE[1], t)])
        print(f"  bare `export` matches {n:3d} of {len(corpus):3d} files in {label}")
    print("  ⇒ the bare word answers 'present' for every one of these. It is not evidence.")

    e1 = report("EXPORT · suite track area (apps/web/src/areas/track)", area, EXPORT_DETECTORS)
    e2 = report("EXPORT · suite web, WHOLE APP (apps/web/src)", suite, EXPORT_DETECTORS)
    e3 = report("EXPORT · track repo frontend (committed main:frontend/src)", track, EXPORT_DETECTORS)

    k1 = report("KEYBOARD · suite track area", area, KEYBOARD_DETECTORS)
    k2 = report("KEYBOARD · suite web, WHOLE APP", suite, KEYBOARD_DETECTORS)
    k3 = report("KEYBOARD · track repo frontend", track, KEYBOARD_DETECTORS)

    print("\n╔══ VERDICT ════════════════════════════════════════════════════════════════╗")
    for label, found in (("export  · suite track area", e1), ("export  · suite web (all)", e2),
                         ("export  · track frontend", e3), ("keyboard· suite track area", k1),
                         ("keyboard· suite web (all)", k2), ("keyboard· track frontend", k3)):
        print(f"  {label:28s} {'PRESENT' if found else 'ABSENT (measured, controlled)'}")


if __name__ == "__main__":
    sys.exit(main())
