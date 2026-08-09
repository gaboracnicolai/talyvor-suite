#!/usr/bin/env python3
"""
POSITIVE CONTROLS FOR THE CONSOLE TITLE GUARD (ConsoleTitle.test.tsx), W1.1 / `w11-console-title`.

WHY THIS FILE EXISTS. The guard it controls was RED FIRST (8 of 20 on `c9e1e8a`), which is more
than most guards in this repo start with — and it is still not evidence that it can catch the
NEXT defect. Three sessions have shipped guards that could not fail; every one was caught only
by a control.

WHAT IS BEING CONTROLLED. `App.tsx` held two tables of paths that had to agree — the `<Routes>`
list and `titleFor()`'s own copy — and disagreed on every address with no page. The fix makes
them ONE table, which means the render loop in the guard is driven by the same table it is
checking. That is exactly the shape that passes for every value of the table, so half these
controls exist to prove `PINNED` (hardcoded literals) does the work the loop cannot.

THE FOUR FAMILIES, deliberately separated:
  · PRODUCT mutations (C1, C2, C3, C4, C5, C9, C10) — put a defect back and demand a red.
  · INSTRUMENT mutations (C6, C7, C8) — blind the guard's own eyes. A guard whose detector is
    dead is indistinguishable from a product that is correct, in both directions, so BOTH
    directions of the catch-all detector are controlled.
  · A NO-OP (C11) — real bytes, no behaviour. If it reads CAUGHT the harness is scoring noise
    and every verdict above it is worthless.
  · THE SEAM THIS MERGE MOVED (C12, C13, C14) — displayScale.test.ts read the routes as JSX and
    this merge turned them into a table. Its closure went to 0 files and only its own floor
    said so. C13 is not invented: it re-applies the exact wrong anchor the new reader shipped
    with for one run (`indexOf('[')` finding the empty pair in `readonly ConsoleRoute[]`).

EACH CONTROL:
  · every anchor count asserted BEFORE any file is written (a half-applied control is a no-op
    reported as evidence);
  · the red must SAY the thing it is supposed to say, searched only in the block after vitest's
    "Failed Tests" banner — the default reporter prints every title in a failing file;
  · a COMPANION test named per control that must STAY GREEN, so "the guard caught it" is
    distinguishable from "the file stopped compiling";
  · every file restored from the in-memory original and its sha256 compared.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path("/Users/ng/talyvor-suite")
WEB = ROOT / "apps/web"

GUARD = "apps/web/src/ConsoleTitle.test.tsx"
APP = "apps/web/src/App.tsx"
# ⚠ A SECOND GUARD IS IN SCOPE BECAUSE THIS MERGE MOVED ITS SEAM. displayScale.test.ts derives
# the behind-the-gate file closure by reading route JSX out of App.tsx; the CONSOLE_ROUTES table
# emptied it to 0 files and its own floor is what said so. It grew a reader for the new shape,
# so that reader is controlled here rather than trusted — C12-C14 run against ITS suite.
SCALE = "apps/web/src/displayScale.test.ts"

TOUCHED = {GUARD, APP, SCALE}

CONSOLE_SUITE = "src/ConsoleTitle.test.tsx"
SCALE_SUITE = "src/displayScale.test.ts"


@dataclass
class Control:
    name: str
    what: str
    says: str
    companion: str
    # path -> [(anchor, expected_count, replacement)]
    edits: list[tuple[str, list[tuple[str, int, str]]]]
    expect_caught: bool = True
    suite: str = CONSOLE_SUITE
    observed: str = field(default="")


CONTROLS: list[Control] = [
    Control(
        name="C1 the-overview-fallback-returns",
        what="restore `?? 'Overview'` — the exact line that titled /admin, /specimen and every "
             "mistyped address as a page the reader is not on",
        says="/admin is titled as no page",
        companion="/ledger is titled Ledger",
        edits=[(APP, [(
            "  return CONSOLE_ROUTES.find((r) => r.path === matched)?.title ?? NOT_FOUND_TITLE",
            1,
            "  return CONSOLE_ROUTES.find((r) => r.path === matched)?.title ?? 'Overview'",
        )])],
    ),
    Control(
        name="C2 prefix-matching-returns",
        what="put ONE of the three `startsWith` prefix rules back. /billingx routes to the "
             "catch-all and must not be titled Billing — a prefix test is not the router's "
             "matcher, which is the half of the defect a fallback fix alone would leave",
        says="/billingx is titled as no page",
        companion="/billing is titled Billing",
        edits=[(APP, [(
            "function titleFor(pathname: string): string {\n"
            "  const matches = matchRoutes(TITLE_MATCHERS, pathname)",
            1,
            "function titleFor(pathname: string): string {\n"
            "  if (pathname.startsWith('/billing')) return 'Billing'\n"
            "  const matches = matchRoutes(TITLE_MATCHERS, pathname)",
        )])],
    ),
    Control(
        name="C3 rename-a-page-silently",
        what="⚠ THE CONTROL THE WHOLE DESIGN RESTS ON. Change Ledger's title in the table. The "
             "render loop reads `r.title`, so it renames its own expectation and stays green; "
             "only PINNED's hardcoded literal can see this",
        says="CONSOLE_ROUTES and the pinned names agree",
        companion="/setup is titled Setup",
        edits=[(APP, [(
            "  { path: '/ledger', title: 'Ledger', element: <Ledger /> },", 1,
            "  { path: '/ledger', title: 'Ledgers', element: <Ledger /> },",
        )])],
    ),
    Control(
        name="C4 drop-a-page-from-the-table",
        what="delete /settings. The render loop is built FROM the table, so it simply stops "
             "checking the page — a guard that enumerates its subject can be silenced by "
             "shrinking the subject. PINNED is the pinned list that cannot be",
        says="CONSOLE_ROUTES and the pinned names agree",
        companion="/members is titled Members",
        edits=[(APP, [(
            "  { path: '/settings', title: 'Settings', element: <Settings /> },\n", 1, "",
        )])],
    ),
    Control(
        name="C5 add-a-page-nobody-named",
        what="add a route with a title but no pinned entry — a new console page must be named "
             "in the guard before it ships, which is the direction that keeps PINNED honest",
        says="CONSOLE_ROUTES and the pinned names agree",
        companion="/keys is titled API keys",
        edits=[(APP, [(
            "  { path: '/docs/*', title: 'Docs', element: <DocsArea /> },\n", 1,
            "  { path: '/docs/*', title: 'Docs', element: <DocsArea /> },\n"
            "  { path: '/reports', title: 'Reports', element: <Overview /> },\n",
        )])],
    ),
    Control(
        name="C6 blind-the-catch-all-detector (always false)",
        what="make isCatchAll always false. The no-page cases assert it TRUE first, precisely so "
             "a dead detector cannot let them pass by never proving the address has no page",
        says="/admin is titled as no page",
        companion="/ledger is titled Ledger",
        edits=[(GUARD, [(
            "  (document.body.textContent ?? '').includes('pick a section from the sidebar')", 1,
            "  false && (document.body.textContent ?? '').includes('pick a section from the sidebar')",
        )])],
    ),
    Control(
        name="C7 blind-the-catch-all-detector (always true)",
        what="the OTHER direction, because a one-sided control is blind to its own inverse: with "
             "isCatchAll always true, every real page must fail its 'did not render the "
             "catch-all' half",
        says="/ledger is titled Ledger",
        companion="/admin is titled as no page",
        edits=[(GUARD, [(
            "  (document.body.textContent ?? '').includes('pick a section from the sidebar')", 1,
            "  true || (document.body.textContent ?? '').includes('pick a section from the sidebar')",
        )])],
    ),
    Control(
        name="C8 read-the-wrong-element",
        what="point headerTitle at the banner's LAST child (the session chip + theme toggle "
             "cluster) instead of its first. A title reader aimed at the wrong node reports "
             "every page as mis-titled, so this must red loudly rather than quietly agree",
        says="/ledger is titled Ledger",
        companion="is \"Not found\"",
        edits=[(GUARD, [(
            "  const title = banner.firstElementChild", 1,
            "  const title = banner.lastElementChild",
        )])],
    ),
    Control(
        name="C9 delete-the-app-catch-all-route",
        what="remove `<Route path=\"*\">` — the regression the /admin bookmark comment describes, "
             "a shell with an EMPTY content area and no explanation. The title is then correct "
             "('Not found') and the PAGE is blank, so only the isCatchAll half can see it",
        says="/nonesuch is titled as no page",
        companion="/ledger is titled Ledger",
        edits=[(APP, [(
            "        <Route\n"
            "          path=\"*\"\n"
            "          element={\n"
            "            <div className=\"mx-auto max-w-3xl px-gutter py-4 text-body text-muted\">\n"
            "              Nothing at this address — pick a section from the sidebar.\n"
            "            </div>\n"
            "          }\n"
            "        />\n", 1, "",
        )])],
    ),
    Control(
        name="C10 not-found-becomes-a-page-name",
        what="set NOT_FOUND_TITLE to 'Overview'. The rendered no-page assertions hardcode the "
             "string 'Not found', so they cannot follow the constant — which is the reason they "
             "hardcode it",
        says="is \"Not found\"",
        companion="/ledger is titled Ledger",
        edits=[(APP, [(
            "export const NOT_FOUND_TITLE = 'Not found'", 1,
            "export const NOT_FOUND_TITLE = 'Overview'",
        )])],
    ),
    Control(
        name="C11 no-op (MUST NOT be caught)",
        what="reword a comment in App.tsx: real bytes change, no behaviour does. If this reads "
             "CAUGHT the harness is scoring noise and every verdict above it is worthless",
        says="/ledger is titled Ledger",
        companion="/admin is titled as no page",
        expect_caught=False,
        edits=[(APP, [(
            "// Built once: matchRoutes only needs the paths, and rebuilding this per render would allocate",
            1,
            "// Built once: matchRoutes needs only the paths, and rebuilding per render would allocate",
        )])],
    ),
    Control(
        name="C12 blind-the-console-route-reader",
        what="make consoleRouteComponents return []. This is the state the merge PUT displayScale "
             "in before it grew the reader — 65 gated files to 0 — and the point of controlling it "
             "is that an empty reader must red at the reader, not silently 25 assertions later",
        says="CONSOLE_ROUTES yielded no components",
        companion="the detector tells a class from a sentence about one",
        suite=SCALE_SUITE,
        edits=[(SCALE, [(
            "  const block = appSource.slice(open + 1, close)\n"
            "  return [...new Set([...block.matchAll(/element:\\s*<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))]",
            1,
            "  const block = appSource.slice(open + 1, close)\n"
            "  return block ? [] : []",
        )])],
    ),
    Control(
        name="C13 the-wrong-anchor-returns",
        what="⚠ THE BUG THIS READER ACTUALLY HAD, put back: anchor on the NAME and take the first "
             "`[`, which is the empty pair in `readonly ConsoleRoute[]`. It produced an empty "
             "block and a zero closure, and it is the reason the anchor is a regex on the "
             "assignment. A control that reproduces a real mistake is worth more than one invented",
        says="CONSOLE_ROUTES yielded no components",
        companion="every step preset.ts declares is classified",
        suite=SCALE_SUITE,
        edits=[(SCALE, [(
            "  const decl = /CONSOLE_ROUTES[^=]*=\\s*\\[/.exec(appSource)", 1,
            "  const decl = /CONSOLE_ROUTES/.exec(appSource)",
        ), (
            "  const open = decl.index + decl[0].length - 1", 1,
            "  const open = appSource.indexOf('[', decl.index)",
        )])],
    ),
    Control(
        name="C14 a-gated-page-leaves-the-table",
        what="delete Track from CONSOLE_ROUTES. The closure floor (>25) survives losing one area, "
             "so the named literals are what notice — a floor cannot check the specific case",
        says="TrackArea is a console page but the table reader missed it",
        companion="the detector tells a class from a sentence about one",
        suite=SCALE_SUITE,
        edits=[(APP, [(
            "  { path: '/track/*', title: 'Track', element: <TrackArea /> },\n", 1, "",
        )])],
    ),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_suite(suite: str = CONSOLE_SUITE) -> tuple[bool, str]:
    p = subprocess.run(
        ["npx", "vitest", "run", suite, "--reporter=default"],
        cwd=WEB, capture_output=True, text=True,
    )
    return p.returncode == 0, p.stdout + p.stderr


def main() -> int:
    originals = {p: (ROOT / p).read_text() for p in TOUCHED}
    hashes = {p: sha(ROOT / p) for p in TOUCHED}

    for suite in (CONSOLE_SUITE, SCALE_SUITE):
        ok, base = run_suite(suite)
        if not ok:
            print(f"BASELINE IS NOT GREEN for {suite} — a control run means nothing from here.")
            print(base[-3000:])
            return 2
        print(f"baseline {suite}: GREEN")
    print()

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
            ok, out = run_suite(c.suite)
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
        print(f"{c.name:44s} {verdict:10s} expected="
              f"{'CAUGHT' if c.expect_caught else 'NOT CAUGHT':10s} {flag}\n"
              f"      red={not ok}  says({c.says!r})={says}  companion-green={not companion_red}")
        print(f"      {c.what}")

    print(f"\n{correct}/{len(CONTROLS)} behaved as expected")
    return 0 if correct == len(CONTROLS) else 1


if __name__ == "__main__":
    sys.exit(main())
