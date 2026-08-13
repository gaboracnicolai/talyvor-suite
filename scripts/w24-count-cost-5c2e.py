#!/usr/bin/env python3
"""w24-5c2e — "Track has no COUNT, so the list still cannot page honestly. Say what that
costs each screen." The last line of W2.4, and the one line of it that needs no decision.

W2.4's five ordered deliverables are all waiting on a question only Nicolai can answer —
which of the two Track front-ends is the product. This line is not. It asks what an
existing, shipped absence COSTS, and that is answerable today, on both front-ends, without
choosing between them.

⚠ THE ANSWER IS NOT "NO PAGE 2". IT IS A WRONG NUMBER ON SCREEN AND A WRONG NUMBER IN THE
DATABASE, AND THE SECOND ONE IS MEASURED HERE BY RUNNING THE SHIPPED CODE.

    Track's issue store pages with `LIMIT $n OFFSET $m` and NO COUNT query
    (internal/issue/store.go#Store.List), and the handler returns a BARE JSON ARRAY — no
    envelope, no total, no next-cursor (internal/issue/handler.go#Handler.List). A client
    therefore cannot distinguish "this column has 0 issues" from "this column's issues are
    all past the end of the one page I fetched". The track-repo kanban does not try to: it
    renders `{issues.length}` as the column's count badge and it computes a PERSISTED
    `sort_order` from the same array.

⚠ WHAT IS MEASURED VS WHAT IS READ, STATED UP FRONT.
  · MEASURED — sections M1/M2/M3 below EXECUTE talyvor-track's own `KanbanColumn` and
    `computeBulkUpdate`, extracted at a pinned SHA and rendered with react-dom/server. The
    badge string and the sort_order printed there are what the shipped code returns, not
    what this script believes it returns.
  · READ — sections D1/D2/D3 are source censuses. Every one carries a POSITIVE CONTROL, so a
    zero is a measurement rather than a blind. They are still reading, and say so.

⚠ talyvor-track IS ANOTHER TAB'S REPO. It is read through `git show` of the COMMITTED tree at
a pinned SHA only — never the working tree, which may hold that tab's in-progress edits, and
never with a fetch. Nothing here writes inside it.

⚠ WHAT THE HARNESS STUBS, AND WHY THAT DOES NOT SOFTEN THE RESULT. Three packages the suite
does not depend on are replaced: `lucide-react` and two `@radix-ui/*` primitives. Their
export names are HARVESTED from the extracted tree rather than guessed, so a name this
script misses becomes a build error rather than a silently-undefined component. `document`
is stubbed to `querySelector: () => null`, which is not a convenience — it is exactly the
DOM state a column with no rendered cards is in, which is the case under measurement.
`localStorage` is stubbed because a zustand store reads it at import time. None of the five
is on the path from an issue array to a count badge or to a sort_order.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

SUITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACK_REPO = os.path.expanduser("~/talyvor-track")
# Pinned. A census that follows a moving ref cannot be re-read later against what it saw.
TRACK_SHA = "47596f288ebeb68b5b5595b5952378ee306e94a5"
ESBUILD = os.path.join(SUITE, "node_modules", ".pnpm", "node_modules", ".bin", "esbuild")
WEB = os.path.join(SUITE, "apps", "web")

FAIL = []


def die(msg):
    print(f"\n✘ CANNOT RUN: {msg}", file=sys.stderr)
    sys.exit(2)


def track_show(path):
    """Read one file out of the COMMITTED talyvor-track tree. Never the working tree."""
    r = subprocess.run(["git", "show", f"{TRACK_SHA}:{path}"], cwd=TRACK_REPO,
                       capture_output=True, text=True)
    if r.returncode != 0:
        die(f"git show {TRACK_SHA}:{path} — {r.stderr.strip()}")
    return r.stdout


def track_ls(prefix):
    r = subprocess.run(["git", "ls-tree", "-r", "--name-only", TRACK_SHA, prefix],
                       cwd=TRACK_REPO, capture_output=True, text=True)
    if r.returncode != 0:
        die(f"git ls-tree — {r.stderr.strip()}")
    return [p for p in r.stdout.splitlines() if p.strip()]


def check(label, got, want, note=""):
    ok = got == want
    print(f"  {'✔' if ok else '✘'} {label:<52} {got!r}" + (f"   ({note})" if note else ""))
    if not ok:
        FAIL.append(f"{label}: got {got!r}, expected {want!r}")
    return ok


# ══════════════════════════════════════════════════════════════════════════════════════════
# D1 — the server bound. What does one unqualified page of issues contain?
# ══════════════════════════════════════════════════════════════════════════════════════════
DEFAULT_RE = re.compile(r"case\s+limit\s*<=\s*0\s*:\s*\n\s*limit\s*=\s*(\d+)")
CAP_RE = re.compile(r"case\s+limit\s*>\s*(\d+)\s*:\s*\n\s*limit\s*=\s*(\d+)")
COUNT_RE = re.compile(r"SELECT\s+COUNT\s*\(\s*\*\s*\)\s+FROM\s+issues\b", re.I)


def d1_server_bound():
    print("\nD1 · THE SERVER BOUND — talyvor-track internal/issue/store.go, handler.go")
    src = track_show("internal/issue/store.go")
    hnd = track_show("internal/issue/handler.go")

    m = DEFAULT_RE.search(src)
    cap = CAP_RE.search(src)
    check("List default page size when no limit is sent", m.group(1) if m else None, "50")
    check("List hard cap", cap.group(2) if cap else None, "250")

    # POSITIVE CONTROL, both directions: the same two patterns over a synthetic file built to
    # contain exactly what they look for, and over one built to contain neither. A pattern
    # that finds nothing in the corpus AND nothing in a fixture written for it is broken,
    # not conclusive, and the two are byte-identical in a report that prints only the corpus.
    pos = "switch {\ncase limit <= 0:\n\t\tlimit = 7\ncase limit > 9:\n\t\tlimit = 9\n}\n"
    neg = "limit := filter.Limit // no clamp at all\n"
    check("  [control] default pattern fires on a built fixture",
          DEFAULT_RE.search(pos).group(1) if DEFAULT_RE.search(pos) else None, "7")
    check("  [control] cap pattern fires on a built fixture",
          CAP_RE.search(pos).group(2) if CAP_RE.search(pos) else None, "9")
    check("  [control] neither fires on a fixture without them",
          bool(DEFAULT_RE.search(neg) or CAP_RE.search(neg)), False)

    # There is no COUNT over `issues` anywhere in the store — which is the item's premise, so
    # it is verified rather than assumed. The control is a term KNOWN to be present.
    check("SELECT COUNT(*) FROM issues anywhere in the store", len(COUNT_RE.findall(src)), 0)
    check("  [control] the same matcher over a built fixture",
          len(COUNT_RE.findall("SELECT COUNT(*) FROM issues WHERE x")), 1)

    # The response shape: a bare array, so there is nowhere for a total to travel even if one
    # were computed. Positive control: the same matcher must find the enveloped form.
    bare = re.search(r"if\s+out\s*==\s*nil\s*\{\s*\n\s*out\s*=\s*\[\]model\.Issue\{\}\s*\n\s*\}\s*\n\s*writeJSON\(w,\s*http\.StatusOK,\s*out\)", hnd)
    check("List responds with the bare slice (no envelope)", bool(bare), True)
    enveloped = re.search(r"writeJSON\(w,\s*http\.StatusOK,\s*map\[string\]any\{", hnd)
    check("  [control] no enveloped List response is present either", bool(enveloped), False)
    return m.group(1) if m else None


# ══════════════════════════════════════════════════════════════════════════════════════════
# D2 — every call site of the issues list, and whether it narrows the page.
# ══════════════════════════════════════════════════════════════════════════════════════════
CALLSITE_RE = re.compile(r"(useIssues|issuesApi\.list)\s*\(([^;]{0,200}?)\)\s*[;,)\n]")


def d2_call_sites(tsx_by_path):
    print("\nD2 · CALL SITES — who asks for the issue list, and with what limit")
    sites = []
    for path, text in tsx_by_path.items():
        if path.endswith("api/issues.ts") or path.endswith("hooks/useIssues.ts"):
            continue  # the definitions, not call sites
        for m in CALLSITE_RE.finditer(text):
            arg = m.group(2)
            line = text[: m.start()].count("\n") + 1
            sites.append((path, line, m.group(1), arg.strip(), "limit" in arg))
    for path, line, fn, arg, has in sites:
        print(f"  · {path}:{line}  {fn}({arg})")
        print(f"      sends a limit: {'YES' if has else 'NO — server default applies'}")
    check("issue-list call sites found", len(sites), 2)
    check("call sites that send a limit", sum(1 for s in sites if s[4]), 0)

    # POSITIVE CONTROL: the detector must be able to SEE a limit. A censor that reports
    # "nobody sends a limit" because it cannot recognise one is the failure mode here.
    ctl = "const x = useIssues({ team_id: t, limit: 200 });"
    cm = CALLSITE_RE.search(ctl)
    check("  [control] detector finds a call site in a built fixture", bool(cm), True)
    check("  [control] and reports its limit as sent", "limit" in (cm.group(2) if cm else ""), True)
    return sites


# ══════════════════════════════════════════════════════════════════════════════════════════
# D3 — does any screen TELL the reader the list may be incomplete?
# ══════════════════════════════════════════════════════════════════════════════════════════
# A truncation signal is a sentence, in rendered prose, that says the set may be larger than
# what is shown. `[^"'`\n]` — the newline exclusion is deliberate: W2.4's own record shows a
# character class that crossed line boundaries inventing three "export routes" out of a regex
# literal. A class that spans newlines answers "present" for prose pages apart.
SIGNAL_RE = re.compile(r"(There may be more|Showing the first|of\s+\{?total|more than [^\n]{0,20}shown)", re.I)


def d3_truncation_signal(tsx_by_path):
    print("\nD3 · TRUNCATION SIGNAL — is the reader told the list may be short?")
    # POSITIVE CONTROL FIRST, and it is not synthetic: talyvor-suite's own IssueList is KNOWN
    # to carry this sentence. If the detector cannot find it there, every zero below is void.
    suite_list = open(os.path.join(WEB, "src", "areas", "track", "IssueList.tsx"),
                      encoding="utf-8").read()
    hits = SIGNAL_RE.findall(suite_list)
    check("  [control] fires on talyvor-suite areas/track/IssueList.tsx", len(hits) > 0, True,
          f"matched {hits[:2]}")

    for path in ("components/issue/IssueList.tsx", "pages/KanbanBoard.tsx",
                 "components/kanban/KanbanColumn.tsx"):
        n = len(SIGNAL_RE.findall(tsx_by_path.get(path, "")))
        check(f"track frontend {path}", n, 0)

    # And the mirror question: does either track screen offer a way to REACH the next page?
    for path in ("components/issue/IssueList.tsx", "pages/KanbanBoard.tsx"):
        n = len(re.findall(r"\boffset\b", tsx_by_path.get(path, "")))
        check(f"'offset' anywhere in {path}", n, 0)
    check("  [control] 'offset' matcher over a built fixture",
          len(re.findall(r"\boffset\b", "setParams({ offset: page * 50 })")), 1)


# ══════════════════════════════════════════════════════════════════════════════════════════
# M — THE MEASUREMENT. Run the shipped components.
# ══════════════════════════════════════════════════════════════════════════════════════════
ENTRY = r"""
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { KanbanColumn } from '~/components/kanban/KanbanColumn'
import { computeBulkUpdate } from '~/pages/KanbanBoard'
import type { Issue, IssueStatus } from '~/api/types'

function issue(over: Partial<Issue>): Issue {
  return {
    id: 'i', workspace_id: 'ws', team_id: 't', identifier: 'T-1', title: 'x',
    description: '', status: 'backlog' as IssueStatus, priority: 0, sort_order: 0,
    created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z', ...over,
  } as Issue
}
// `in_review` really holds 5 rows, filed in 2023. `backlog` holds 50 filed since. One page
// is the 50 newest by created_at, so every in_review row falls off the end of it.
const IN_REVIEW = Array.from({ length: 5 }, (_, n) => issue({
  id: `old-${n}`, status: 'in_review' as IssueStatus, sort_order: 100 + n,
  created_at: `2023-01-0${n + 1}T00:00:00Z`,
}))
const BACKLOG = Array.from({ length: 50 }, (_, n) => issue({
  id: `new-${n}`, status: 'backlog' as IssueStatus, sort_order: n + 1,
  created_at: `2026-08-1${n % 10}T00:00:00Z`,
}))
// `done` really holds 8. sort_order is a MANUAL ranking, independent of when a row was
// filed — so the three that survive the cut are the three at the TOP of the column, not
// the bottom. That is the ordinary case, not a contrived one.
const DONE = Array.from({ length: 8 }, (_, n) => issue({
  id: `done-${n}`, status: 'done' as IssueStatus,
  sort_order: n >= 5 ? 200 + (n - 5) : 210 + n,
  created_at: n >= 5 ? `2026-08-2${n}T00:00:00Z` : `2022-0${n + 1}-01T00:00:00Z`,
}))

// `todo` really holds 4, filed MORE recently than anything else — so the page contains it
// whole. It is the negative control, and it has to be its own column: `backlog` cannot serve,
// because adding `done` to the workspace displaced three backlog rows out of the same 50-row
// page. That is not a hypothetical — the first draft of this harness used backlog as the
// control, and the control FAILED, correctly, for exactly that reason.
const TODO = Array.from({ length: 4 }, (_, n) => issue({
  id: `todo-${n}`, status: 'todo' as IssueStatus, sort_order: 300 + n,
  created_at: `2026-09-0${n + 1}T00:00:00Z`,
}))

const newest = (rows: Issue[], k: number) =>
  [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, k)
const groupOf = (rows: Issue[]) => {
  const out = { backlog: [], todo: [], in_progress: [], in_review: [], done: [], cancelled: [] } as Record<IssueStatus, Issue[]>
  for (const i of rows) out[i.status]?.push(i)
  for (const k of Object.keys(out) as IssueStatus[]) out[k].sort((a, b) => a.sort_order - b.sort_order)
  return out
}
const ALL = [...IN_REVIEW, ...BACKLOG, ...DONE, ...TODO]
const PAGED = groupOf(newest(ALL, 50))
const TRUTH = groupOf(ALL)

// The REAL KanbanColumn, rendered. The badge is the header's trailing <span>.
function badge(status: IssueStatus, rows: Issue[]): string {
  const html = renderToStaticMarkup(createElement(KanbanColumn as never, {
    status, title: status, issues: rows, focusedId: null, draggingId: null,
    isDropTarget: false, onCardClick: () => {}, onCardPointerDown: () => {}, onCreate: () => {},
  }))
  const m = html.match(/<span class="text-\[10px\] text-muted">([^<]*)<\/span>/)
  return m ? m[1] : '<NO BADGE>'
}
// The REAL computeBulkUpdate. dropY far below every card = "bottom of this column", which
// is its documented default and what the loop yields when no card element is found.
const dragged = issue({ id: 'dragged', status: 'todo' as IssueStatus })
const bottom = (g: Record<IssueStatus, Issue[]>, s: IssueStatus) =>
  computeBulkUpdate({ dragged, newStatus: s, dropY: 99999, grouped: g })[0]?.sort_order ?? null

console.log(JSON.stringify({
  page_rows: newest(ALL, 50).length,
  empty: { in_page: PAGED.in_review.length, in_truth: TRUTH.in_review.length,
           badge_paged: badge('in_review' as IssueStatus, PAGED.in_review),
           badge_truth: badge('in_review' as IssueStatus, TRUTH.in_review),
           write_paged: bottom(PAGED, 'in_review' as IssueStatus),
           write_truth: bottom(TRUTH, 'in_review' as IssueStatus) },
  short: { in_page: PAGED.done.length, in_truth: TRUTH.done.length,
           badge_paged: badge('done' as IssueStatus, PAGED.done),
           badge_truth: badge('done' as IssueStatus, TRUTH.done),
           write_paged: bottom(PAGED, 'done' as IssueStatus),
           write_truth: bottom(TRUTH, 'done' as IssueStatus) },
  // NEGATIVE CONTROL: a column the page contains IN FULL must answer identically both ways.
  // If it does not, this harness is manufacturing a difference and every number above is void.
  control: { in_page: PAGED.todo.length, in_truth: TRUTH.todo.length,
             badge_paged: badge('todo' as IssueStatus, PAGED.todo),
             badge_truth: badge('todo' as IssueStatus, TRUTH.todo),
             write_paged: bottom(PAGED, 'todo' as IssueStatus),
             write_truth: bottom(TRUTH, 'todo' as IssueStatus) },
}, null, 2))
"""

PRELOAD = """// The browser globals Track's module graph touches at import time. `document.querySelector`
// returning null is not a convenience: it is the DOM state a column with no rendered cards is
// in, which is precisely the case under measurement.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
globalThis.document = { querySelector: () => null }
globalThis.window = globalThis
"""


def _build_and_run(workdir, src):
    """Bundle the entry against the extracted tree and run it. Re-callable, so the harness
    can be pointed at a deliberately mutated copy of that tree and made to disagree."""
    entry = os.path.join(workdir, "entry.tsx")
    out = os.path.join(workdir, "out.cjs")
    radix = os.path.join(workdir, "stub-radix.mjs")
    build = subprocess.run(
        [ESBUILD, entry, "--bundle", "--platform=node", "--format=cjs", "--jsx=automatic",
         f"--outfile={out}", '--define:import.meta.env={"VITE_API_URL":""}',
         f"--alias:~={src}", f"--alias:lucide-react={workdir}/stub-lucide.mjs",
         f"--alias:@radix-ui/react-avatar={radix}", f"--alias:@radix-ui/react-tooltip={radix}",
         f"--alias:@radix-ui/react-dialog={radix}", f"--alias:@radix-ui/react-dropdown-menu={radix}",
         "--log-level=warning"], cwd=WEB, capture_output=True, text=True)
    if build.returncode != 0:
        die("esbuild failed:\n" + build.stderr)
    run = subprocess.run(["node", "--require", os.path.join(workdir, "preload.cjs"), out],
                         cwd=WEB, capture_output=True, text=True)
    if run.returncode != 0:
        die("harness failed:\n" + run.stderr)
    return json.loads(run.stdout)


def measure(tsx_by_path, workdir):
    print("\nM · THE MEASUREMENT — talyvor-track's own KanbanColumn and computeBulkUpdate, RUN")
    src = os.path.join(workdir, "src")
    for path in track_ls("frontend/src"):
        rel = path[len("frontend/src/"):]
        dst = os.path.join(src, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "w", encoding="utf-8") as fh:
            fh.write(track_show(path))

    # Stub export names are HARVESTED from the tree, never guessed: a name this misses is a
    # BUILD error, not a component that silently renders as undefined.
    icons, members = set(), set()
    for text in tsx_by_path.values():
        for m in re.finditer(r'import\s*\{([^}]*)\}\s*from\s*"lucide-react"', text):
            icons.update(x.strip() for x in m.group(1).split(",") if x.strip())
        members.update(re.findall(r"\b(?:RA|RT|RD|RDM)\.([A-Za-z]+)", text))
    if not icons or not members:
        die("stub harvest found nothing — the extraction is wrong, not the tree")
    with open(os.path.join(workdir, "stub-lucide.mjs"), "w") as fh:
        fh.write("import { createElement } from 'react'\n"
                 "const Icon = () => createElement('svg', {})\n"
                 + "".join(f"export const {i} = Icon\n" for i in sorted(icons)))
    with open(os.path.join(workdir, "stub-radix.mjs"), "w") as fh:
        fh.write("import { createElement } from 'react'\n"
                 "const Pass = ({ children }) => createElement('div', null, children)\n"
                 + "".join(f"export const {m} = Pass\n" for m in sorted(members)))
    print(f"  harvested {len(icons)} icon names, {len(members)} radix members "
          f"from {len(tsx_by_path)} extracted files")

    open(os.path.join(workdir, "entry.tsx"), "w", encoding="utf-8").write(ENTRY)
    open(os.path.join(workdir, "preload.cjs"), "w", encoding="utf-8").write(PRELOAD)
    r = _build_and_run(workdir, src)

    print(f"\n  one page returned {r['page_rows']} rows (the server's default, unqualified)\n")
    for key, label in (("empty", "A COLUMN EMPTIED BY THE PAGE"),
                       ("short", "A COLUMN SHORTENED BY THE PAGE"),
                       ("control", "NEGATIVE CONTROL — a column the page holds IN FULL")):
        d = r[key]
        print(f"  {label}")
        print(f"    rows really in the column      {d['in_truth']}")
        print(f"    rows inside the fetched page   {d['in_page']}")
        print(f"    count badge the screen renders {d['badge_paged']!r}"
              f"   (truth: {d['badge_truth']!r})")
        print(f"    sort_order a bottom-drop WRITES {d['write_paged']}"
              f"   (truth: {d['write_truth']})")
        print()

    check("empty column: badge differs from the truth",
          r["empty"]["badge_paged"] != r["empty"]["badge_truth"], True)
    check("empty column: the WRITE differs from the truth",
          r["empty"]["write_paged"] != r["empty"]["write_truth"], True)
    check("short column: badge differs from the truth",
          r["short"]["badge_paged"] != r["short"]["badge_truth"], True)
    check("short column: the WRITE differs from the truth",
          r["short"]["write_paged"] != r["short"]["write_truth"], True)
    check("[control] full column: badge IDENTICAL both ways",
          r["control"]["badge_paged"] == r["control"]["badge_truth"], True)
    check("[control] full column: write IDENTICAL both ways",
          r["control"]["write_paged"] == r["control"]["write_truth"], True)

    # ── POSITIVE CONTROL ON THE HARNESS ITSELF ────────────────────────────────────────────
    # Everything above is worthless if this pipeline renders something other than the file it
    # claims to. So: mutate the EXTRACTED copy of KanbanColumn's badge expression by a known
    # constant, rebuild, re-run, and require the badge to move by exactly that constant. If it
    # does not move, the harness is not reading that file and every number above is void —
    # which a run that only ever prints agreeable numbers could never tell you.
    col = os.path.join(src, "components", "kanban", "KanbanColumn.tsx")
    original = open(col, encoding="utf-8").read()
    mutated = original.replace("{issues.length}</span>", "{issues.length + 1000}</span>", 1)
    if mutated == original:
        die("harness control could not mutate KanbanColumn's badge — its shape moved")
    try:
        open(col, "w", encoding="utf-8").write(mutated)
        m = _build_and_run(workdir, src)
        check("[control] mutating the extracted badge moves the badge",
              int(m["short"]["badge_paged"]) - int(r["short"]["badge_paged"]), 1000)
        check("[control] and the mutation leaves the WRITE untouched",
              m["short"]["write_paged"], r["short"]["write_paged"])
    finally:
        open(col, "w", encoding="utf-8").write(original)
    return r


def main():
    if not os.path.isdir(os.path.join(TRACK_REPO, ".git")):
        die(f"{TRACK_REPO} is not a git repo — this census reads it read-only at {TRACK_SHA}")
    if not os.path.isfile(ESBUILD):
        die(f"{ESBUILD} not found — run `pnpm install` at the suite root first")
    print(f"talyvor-track pinned at {TRACK_SHA} (committed tree only, no fetch, no working tree)")

    tsx = {}
    for path in track_ls("frontend/src"):
        if path.endswith((".ts", ".tsx")):
            tsx[path[len("frontend/src/"):]] = track_show(path)
    print(f"talyvor-suite at {SUITE}")

    d1_server_bound()
    d2_call_sites(tsx)
    d3_truncation_signal(tsx)
    workdir = tempfile.mkdtemp(prefix="w24-5c2e-")
    try:
        measure(tsx, workdir)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print("\n" + "═" * 90)
    if FAIL:
        print("✘ THIS RUN DID NOT REPRODUCE THE RECORDED MEASUREMENT:")
        for f in FAIL:
            print(f"    · {f}")
        print("  Something moved. Re-read before trusting the queue entry.")
        return 1
    print("✔ every check reproduced, including both controls.")
    print("""
WHAT THE MISSING COUNT COSTS, PER SCREEN
────────────────────────────────────────
talyvor-track/frontend  pages/KanbanBoard.tsx + components/kanban/KanbanColumn.tsx
    A count badge that is not the column's count, and a PERSISTED sort_order computed
    against rows the board cannot know are missing. A card dropped at the BOTTOM of a
    column that is empty only because its rows fell off the page is written to the TOP
    of that column. This is the one place the absence stops being cosmetic.

talyvor-track/frontend  components/issue/IssueList.tsx
    The 50 newest issues, no offset control, and no sentence saying so. Cosmetic by
    comparison — it shows a true subset and claims nothing false about it — but a reader
    cannot tell a 40-issue workspace from a 4,000-issue one.

talyvor-suite  apps/web/src/areas/track/IssueList.tsx
    Nothing. It sends limit=50 explicitly, renders "Showing the first 50 · there may be
    more · no page number is shown" exactly when the page comes back full, and derives no
    cardinal from the page. The BFF refuses to invent a total for the same reason. This
    screen is what the absence costs when it is handled: one honest sentence.

⚠ WHAT WOULD MAKE THE KANBAN HONEST WITHOUT A COUNT QUERY — a handover, not a fix. The
board needs to know whether the page it holds is complete, which needs one bit, not a
total: ask for limit+1 and report "there is more" when it comes back long. Whether to
spend a COUNT, a window function, or that one extra row is talyvor-track's call and is
NOT made here.""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
