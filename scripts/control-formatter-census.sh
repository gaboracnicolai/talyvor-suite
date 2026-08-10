#!/usr/bin/env bash
# Positive-control harness for the formatter census (figureFace.test.ts rule B).
#
# Rule B claims: "Every `format*` exported by the three format modules is classified below as
# A FIGURE or NOT ONE, WITH ITS REASON, and the classification is checked against the modules
# in both directions. A formatter nobody classifies fails this file rather than defaulting into
# 'not a figure'."
#
# Each control adds or removes an exported `format*` and asks whether that claim holds. The
# verdict is read from the NAMES of the failing tests, never from an exit code: a mutation that
# crashes a component fails 22 tests and none of them is this guard.
#
# ⚠ A DISCARDED CONTROL, RECORDED. The first draft also RENDERED the new formatter in the sans.
# It cannot be made inert: an extra span changes the page text, so TopUp's own assertions and
# `checkoutRefusalSurface`'s character count move, and `pointerAudit` reds on the shifted line
# numbers. Five tests failed and not one was the census — a CAUGHT that says nothing about the
# claim under test. Rule A's blindness to a non-money NAME is stated in the guard's own header;
# what needs controlling is the CENSUS, and an export with no render site is that mutation
# exactly, with zero rendered characters to disturb anything else.
#
# Restore happens in a trap, not after the run.
# ⚠ THIS SCRIPT WRITES TO TRACKED SOURCE FILES and restores them. It is NOT wired into CI.
set -uo pipefail
cd "$(dirname "$0")/.."
WEB=apps/web
BK=$(mktemp -d)

# The last line of defence behind the traps: on a clean tree ANY surviving mutation is
# recoverable with `git checkout -- .`, and `git status` will show it. On a dirty tree it
# would be indistinguishable from work in progress.
if [ -n "$(git status --porcelain -- apps packages)" ]; then
  echo "REFUSING TO RUN: apps/ or packages/ is dirty. This script mutates tracked source;"
  echo "run it on a clean tree so any surviving mutation is visible and recoverable."
  git status --short -- apps packages
  exit 2
fi

TOPUP_API=$WEB/src/areas/lens/topupApi.ts
UI_FMT=packages/ui/src/lib/format.ts
TRACK_FMT=$WEB/src/areas/track/format.ts
TRACK_FMT_TEST=$WEB/src/areas/track/format.test.ts
GUARD=$WEB/src/figureFace.test.ts
FILES=("$TOPUP_API" "$UI_FMT" "$TRACK_FMT" "$TRACK_FMT_TEST" "$GUARD")

for f in "${FILES[@]}"; do cp -p "$f" "$BK/$(echo "$f" | tr / _)"; done
restore() { for f in "${FILES[@]}"; do cp -p "$BK/$(echo "$f" | tr / _)" "$f"; done; }
# ⚠ EXIT ALONE IS NOT ENOUGH, AND THIS COST A MUTATION LEFT ON DISK. Piping this script into
# `head` closes the pipe; the next write raises SIGPIPE, which terminates the shell WITHOUT
# running an EXIT trap. The run died inside C4 and `for (const f of [])` — the blinded walker —
# stayed in the guard. Every signal that can end this script has to restore.
trap 'restore; exit 130' INT TERM HUP PIPE
trap 'restore' EXIT

run() { # $1 = label, $2 = prediction, $3 = the test name predicted to speak (or "-")
  local out n failed
  out=$(cd $WEB && npx vitest run --reporter=default 2>&1)
  n=$(printf '%s' "$out" | grep -oE 'Tests +[0-9]+ failed' | grep -oE '[0-9]+' | head -1); n=${n:-0}
  failed=$(printf '%s' "$out" | grep -E '^\s+(×|✗)' | sed 's/^[[:space:]]*//' | sort -u)
  echo "──────────────────────────────────────────────────────────────"
  echo "CONTROL:   $1"
  echo "PREDICTED: $2   catcher: $3"
  if [ "$n" -gt 0 ]; then
    echo "VERDICT:   CAUGHT ($n failing)"
    # ⚠ WHICH test failed, not how many. C3 against main scored CAUGHT on a count while the only
    # failing test was the mutated module's OWN unit test — the census said nothing.
    if printf '%s' "$failed" | grep -q 'the formatter classification is total'; then
      echo "           CENSUS FIRED: yes"
    else
      echo "           CENSUS FIRED: NO — the catch came from somewhere else"
    fi
    printf '%s\n' "$failed" | head -10
  else
    echo "VERDICT:   NOT CAUGHT (0 failing)  $(printf '%s' "$out" | grep -oE 'Tests +[0-9]+ passed' | head -1)"
  fi
}

compiles() { (cd $WEB && npx tsc --noEmit >/dev/null 2>&1) && echo "  (mutation compiles)" || echo "  ⚠ MUTATION DOES NOT COMPILE — control invalid"; }

echo "=============================================================="
echo "GUARD UNDER TEST: $(shasum -a 256 $GUARD | cut -c1-16)  ($(git rev-parse --abbrev-ref HEAD))"
echo "=============================================================="

# ── C1: a new exported formatter in a module the census does not name. No render site,
#        so it is behaviourally inert and the only claim it can move is rule B's.
cat >> "$TOPUP_API" <<'EOF'

/** CONTROL C1 — an exported formatter in a module outside the hardcoded three. */
export function formatBalance(uusd: number): string {
  return (uusd / 1_000_000).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
EOF
grep -q 'export function formatBalance' "$TOPUP_API" || { echo "C1 ANCHOR FAILED"; exit 1; }
compiles
run "C1 — formatBalance() exported from areas/lens/topupApi.ts (module NOT in the list)" "CAUGHT" "every exported format* is classified"
restore

# ── C2: a SECOND formatUSD in a module the census DOES name. The NAME is already
#        classified, so a name-keyed census is satisfied the moment it appears once.
cat >> "$UI_FMT" <<'EOF'

/** CONTROL C2 — a second formatUSD, a different unit contract, the same name. */
export function formatUSD(x: number): string {
  return `$${x}`
}
EOF
grep -q 'export function formatUSD' "$UI_FMT" || { echo "C2 ANCHOR FAILED"; exit 1; }
compiles
run "C2 — a second formatUSD exported from packages/ui/src/lib/format.ts (module IN the list)" "CAUGHT" "every exported format* is classified"
restore

# ── C3: a DELETION. A source-derived census that only ever adds cannot see a formatter
#        leave; the stale direction is what has to speak.
python3 - "$TRACK_FMT" <<'EOF'
import sys, re
p = sys.argv[1]; s = open(p).read()
old = "export function formatUSD(usd: number): string {"
assert s.count(old) == 1, "anchor not unique"
open(p, 'w').write(s.replace(old, "function formatUSD(usd: number): string {"))
EOF
grep -q '^function formatUSD' "$TRACK_FMT" || { echo "C3 ANCHOR FAILED"; exit 1; }
run "C3 — track's formatUSD stops being exported (a deletion, not an addition)" "CAUGHT" "classified but no longer exported"
restore

# ── C3b: the SAME deletion with the mutated module's own unit test excluded. On main C3
#        scored CAUGHT and the only failing test was `format.test.ts` — the module's own —
#        so the census's verdict was never visible. This is the reading that counts.
python3 - "$TRACK_FMT" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
old = "export function formatUSD(usd: number): string {"
assert s.count(old) == 1, "anchor not unique"
open(p, 'w').write(s.replace(old, "function formatUSD(usd: number): string {"))
EOF
python3 - "$TRACK_FMT_TEST" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
old = "import { formatUSD, formatWhen, priorityLabel, statusLabel } from './format'"
assert s.count(old) == 1, "anchor not unique"
open(p, 'w').write(s.replace(old, "import { formatWhen, priorityLabel, statusLabel } from './format'").replace("formatUSD(", "String("))
EOF
run "C3b — the same deletion, with the mutated module's OWN unit test taken out of the way" "CAUGHT" "classified but no longer exported"
restore

# ── C4: the control on MY OWN INSTRUMENT. The walker is blinded so it discovers nothing.
#        If the census can pass on an empty read, every verdict above is worthless.
python3 - "$GUARD" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
old = "  for (const f of formatModules()) {"
alt = "  for (const f of formatModules) {"
if s.count(old) == 1:   s = s.replace(old, "  for (const f of []) {")
elif s.count(alt) == 1: s = s.replace(alt, "  for (const f of []) {")
else: raise SystemExit("C4 ANCHOR FAILED — neither walker shape found")
open(p, 'w').write(s)
EOF
run "C4 — the census walker reads NOTHING (vacuity control on my own instrument)" "CAUGHT" "the floor + classified but no longer exported"
restore

# ── C5: MUST STAY GREEN — a new formatter that IS classified. A guard that reds on every
#        new export is a guard that gets deleted; this is the other direction.
cat >> "$UI_FMT" <<'EOF'

/** CONTROL C5 — a new formatter that the table below does classify. */
export function formatControlOnly(x: number): string {
  return String(x)
}
EOF
python3 - "$GUARD" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
for anchor, entry in (
  ("  formatDay:", "  'packages/ui/src/lib/format.ts#formatControlOnly': 'control-only, not a figure',\n"),
  ("  'packages/ui/src/lib/format.ts#formatDay'", "  'packages/ui/src/lib/format.ts#formatControlOnly': 'control-only, not a figure',\n"),
):
  if s.count(anchor) == 1:
    i = s.index(anchor); s = s[:i] + entry + s[i:]; break
else:
  raise SystemExit("C5 ANCHOR FAILED")
open(p, 'w').write(s)
EOF
compiles
run "C5 — MUST STAY GREEN: a new formatter WITH a classification entry" "NOT CAUGHT" "-"
restore

# ── C7: THE REALISTIC REGRESSION — someone silences a red by letting a bare NAME satisfy
#        the totality check again. This is the mutation the shared-name test exists for, and
#        the only one that can tell the two census tests apart.
python3 - "$GUARD" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
# THE FULL REVERT — the census emits bare NAMES and the table goes back to bare-name entries.
# Anything less than this the totality check catches first (measured: C7 was rewritten twice).
# Under a name key three names match three entries and the totality check is GREEN, which is
# exactly the state that shipped at 31095b7.
a = "pairs.add(`${f.path}#${m[1]}`)"
if s.count(a) != 2: raise SystemExit("C7 CENSUS ANCHOR FAILED")
s = s.replace(a, "pairs.add(m[1])")
i = s.index("const FORMATTERS: Record<string, true | string> = {")
j = s.index("\n}\n", i) + 3
s = s[:i] + """const FORMATTERS: Record<string, true | string> = {
  formatUSD: true,
  formatWhen: 'a timestamp',
  formatDay: 'a date label',
  formatCents: true,
}
""" + s[j:]
open(p, 'w').write(s)
PY
run "C7 — the FULL REVERT: census emits bare names and the table goes back to name keys" "CAUGHT by the shared-name check ALONE" "a name two modules both export is two entries, not one"
restore

# ── C7b: THE SAME REVERT WITH THE FLOOR LOWERED TOO — the edit someone actually makes when
#        they revert and then "fix" the floor that reds. C7 was caught by the shared-name check
#        AND by the floor; the floor fires on the COUNT falling 6→3, which is incidental. This
#        asks whether the shared-name check stands on its own.
python3 - "$GUARD" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = "pairs.add(`${f.path}#${m[1]}`)"
if s.count(a) != 2: raise SystemExit("C7b CENSUS ANCHOR FAILED")
s = s.replace(a, "pairs.add(m[1])")
i = s.index("const FORMATTERS: Record<string, true | string> = {")
j = s.index("\n}\n", i) + 3
s = s[:i] + """const FORMATTERS: Record<string, true | string> = {
  formatUSD: true,
  formatWhen: 'a timestamp',
  formatDay: 'a date label',
  formatCents: true,
}
""" + s[j:]
f = "expect(exportedFormatters().length, 'no exported format* was discovered at all').toBeGreaterThanOrEqual(5)"
if s.count(f) != 1: raise SystemExit("C7b FLOOR ANCHOR FAILED")
s = s.replace(f, "expect(exportedFormatters().length, 'no exported format* was discovered at all').toBeGreaterThanOrEqual(3)")
open(p, 'w').write(s)
PY
run "C7b — the full revert WITH the floor lowered to match" "CAUGHT by the shared-name check ALONE" "a name two modules both export is two entries, not one"
restore

# ── C8: SCOPE. Something unrelated in a file the census reads must red its own tests and
#        NOT this guard — otherwise "CAUGHT" above means only that the suite is sensitive.
python3 - "$TRACK_FMT" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
old = "  done: 'Done',"
if s.count(old) != 1: raise SystemExit("C8 ANCHOR FAILED")
open(p, 'w').write(s.replace(old, "  done: 'Finished',"))
EOF
run "C8 — SCOPE: a status label changed in a module the census reads" "CAUGHT elsewhere, census silent" "status label tests, NOT the census"
restore

# ── C6: MUST STAY GREEN — the tree untouched. Without this a compile error anywhere
#        would read as every control above being caught.
run "C6 — MUST STAY GREEN: unmutated tree" "NOT CAUGHT" "-"

echo "──────────────────────────────────────────────────────────────"
echo "RESTORE CHECK (must match the pre-run hashes)"
restore
for f in "${FILES[@]}"; do shasum -a 256 "$f"; done
