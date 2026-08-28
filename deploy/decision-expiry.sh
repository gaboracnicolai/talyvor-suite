#!/usr/bin/env bash
#
# decision-expiry.sh — every deploy decision that rests on a premise, and a command that says
# whether that premise still holds.
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
#
# Three decisions in one night were correct when made and wrong an hour later, because someone
# removed the constraint each was reasoned from. Nothing was careless: the premise was verified
# from source every time. The failure is structural — **the conclusion is written in timeless
# present tense and the premise is buried in the justification**, so a reader (including the
# author, later) meets the verdict and never re-derives what it rests on.
#
# A reopening condition written as prose is a description someone must remember to evaluate.
# This file makes each one a COMMAND. If a premise has moved, this exits non-zero and names the
# document section that is now void.
#
# ⚠ THIS IS THE WEAKEST OF THE THREE FORMS, AND IT IS USED ONLY WHERE THE STRONGER TWO CANNOT
# REACH. In order of strength:
#   1. A derived value that FAILS TO COMPILE when its premise goes. Gold standard — suite #59
#      made the shared-Docs disclosure a compile error rather than a silently-false string.
#   2. A TEST that fails. Second best, with one caveat learned the hard way (talyvor-docs):
#      the test must exercise the PRODUCTION path. An expiry driving a fake was neutralised
#      when the fake was adjusted for unrelated, locally sensible reasons.
#   3. A documented command — this file. It runs in CI, so it is not "someone remembers", but
#      it can only see what is greppable from this repo.
#
# ⚠ AND IT CANNOT SEE OTHER REPOSITORIES. Several of our decisions rest on premises in
# talyvor-track / talyvor-docs / talyvor-lens. Those are reported as UNCHECKABLE HERE — never as
# passes — with the repo and the check that would settle them. An expiry register that silently
# scores a cross-repo premise as "fine" would be the exact failure it exists to prevent.
#
# ⚠ AND IT WAS DOING EXACTLY THAT TO ITS OWN LOCAL HALF, through a door nobody was watching: a
# premise read out of a path THAT IS NOT THERE. Seven of these nine checks reported their
# premise as holding with their subject file moved aside — see `subject` below, which is the
# floor that closed it, and apps/web/src/expirySubjects.test.ts, which is what keeps it closed.
#
# Usage:  deploy/decision-expiry.sh          # CI runs this
#         deploy/decision-expiry.sh -v       # also print each premise as it is checked

set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}" || exit 2

verbose=false
[ "${1:-}" = "-v" ] && verbose=true

stale=0
checked=0
uncheckable=0

# ok DECISION WHERE PREMISE  — the premise held
ok() {
    checked=$((checked + 1))
    ${verbose} && printf '  ok        %s\n' "$1"
    return 0
}

# void DECISION WHERE CONSEQUENCE — the premise has moved
void() {
    stale=$((stale + 1))
    printf '\n  ⚠ STALE DECISION: %s\n' "$1"
    printf '    documented in: %s\n' "$2"
    printf '    consequence:   %s\n' "$3"
}

# cannot DECISION REPO CHECK — the premise lives somewhere this script cannot read
#
# ⚠ THE CHECK MUST BE ABLE TO SAY NO. The footer tells a deployer to run these in the named
# repo, so the whole uncheckable half is worth exactly what the commands are worth. Two shapes
# were MEASURED to exit 0 while the premise is false or unmeasured, and both were in this file:
#
#   · `go test <pkg> -run <filter>` prints "ok … [no tests to run]" — and under -v the word
#     "PASS" — and EXITS 0 when the filter matches NO test. The entry below about Track's
#     200+[] said `-run Unknown`, and talyvor-track's internal/member/ has no test whose name
#     contains "Unknown" (fifteen that do not, at 9cfad34). It had been reporting a pass from a
#     run of nothing, while the test that DOES assert that premise sat there under another name.
#   · `grep -c` exits 0 for any count ≥ 1, so a trailing `# expect 2` is enforced by whoever is
#     reading, not by the command.
#
# So: pipe `go test -v` into a check on the `--- PASS: <TestName>` line, and compare a count
# rather than trusting grep's status. apps/web/src/settleCommands.test.ts holds both rules.
cannot() {
    uncheckable=$((uncheckable + 1))
    printf '  UNCHECKABLE  %s\n' "$1"
    printf '               premise lives in: %s\n' "$2"
    printf '               settle it with:   %s\n' "$3"
}

# subject FILE DECISION — the premise below is read out of FILE. Returns non-zero, and records
# a STALE, when that path is not a readable non-empty file.
#
# ⚠ MOST CHECKS HERE ARE ABSENCE TESTS: they grep a path and VOID when the pattern is FOUND.
# `grep` exits 1 with no output both for "the pattern is not in that file" AND for "there is no
# such file" — so a subject that has MOVED reads exactly like a premise in perfect health.
#
# MEASURED at 9d3d6c8, not reasoned about (~/talyvor-queue/w11-expiry-vacuity-census-3f7a.py
# moved each subject aside in turn, restored in a `finally`, sha256-verified back): SEVEN of the
# nine locally-checkable decisions printed `ok` with the file their premise lives in gone, and
# FOUR of those runs exited 0 under "All locally-checkable premises still hold."
#
# ⚠ D3 IS THE ONE THAT SETTLES IT, because it did not merely mis-answer — it ERRORED and was
# scored as a pass. With the compose fragment gone `grep -c` wrote nothing, so `[ "" -ne 3 ]`
# printed `integer expression expected` and exited 2; a non-zero `[` sends the `if` down its
# ELSE branch, which is `ok "member sync wired — all 3 variables present"`. The check announced
# three variables it had not counted. (Its count is now range-checked too — see D3.)
#
# ⚠ A MISSING LOCAL PATH IS A STALE DECISION, NOT AN UNCHECKABLE. `cannot` is for premises that
# live where this repo cannot read. A local anchor that stopped resolving is a different event:
# the decision is still documented, the runbook still tells an operator to rely on it, and
# nothing is watching it any more. That is what `void` is for, and it is what makes CI red.
#
# Guarded by apps/web/src/expirySubjects.test.ts, which runs THIS file against a sandbox with
# one subject removed at a time and fails on any `ok` that survives its own subject.
subject() {
    [ -s "$1" ] && return 0
    stale=$((stale + 1))
    printf '\n  ⚠ UNREADABLE PREMISE: %s\n' "$2"
    printf '    subject file:  %s — missing, empty, or not readable\n' "$1"
    printf '    consequence:   %s\n' \
        "this decision is checked by grepping that path, and no file means no match. For an absence test no match is the shape of a premise that HOLDS, so this check would otherwise have scored a pass from an instrument that read nothing. Re-anchor it on the file's new location, deliberately."
    return 1
}

echo "== deploy decision expiry =="
echo

# ── D1 ───────────────────────────────────────────────────────────────────────
# DECISION: FULL-STACK-DEPLOY.md STEP 3a deletes the manual Docs membership seed.
# PREMISE:  the BFF does not pin a Docs workspace — every route resolves it from the session.
# If the pin returns, the seed is the only grant for the pinned workspace again and its
# deletion is void. (Also guarded, more strongly, by TestDocs_IsPerSessionNotPinned.)
if subject apps/bff/main.go "STEP 3a's deletion of the Docs membership seed"; then
    if grep -qE '^\s*docsWorkspaceID\b' apps/bff/main.go 2>/dev/null; then
        void "STEP 3a's deletion of the Docs membership seed" \
            "deploy/FULL-STACK-DEPLOY.md § '3a. Docs is PER-IDENTITY'" \
            "docsWorkspaceID is back on the BFF config ⇒ Docs is pinned again ⇒ RESTORE the seed step from git history, or every tester 403s on Docs."
    else
        ok "STEP 3a seed deleted — BFF holds no docsWorkspaceID"
    fi
fi

# ── D2 ───────────────────────────────────────────────────────────────────────
# DECISION: the runbook tells the operator to DELETE DOCS_WORKSPACE_ID from bff.env, and warns
#           that leaving it set is silently ignored.
# PREMISE:  the BFF has no boot refusal for it (unlike TRACK_WORKSPACE_ID).
# If a refusal is added, "silently ignored" becomes wrong in the dangerous direction: the
# operator would be told a stale line is harmless when it now prevents boot.
if subject apps/bff/main.go "the 'leaving DOCS_WORKSPACE_ID set is silently ignored' warning"; then
    if grep -q 'DOCS_WORKSPACE_ID must not be set' apps/bff/main.go 2>/dev/null; then
        void "the 'leaving DOCS_WORKSPACE_ID set is silently ignored' warning" \
            "deploy/README.md §4 table, deploy/bff.env.example, FULL-STACK-DEPLOY.md § 'Docs now DEPENDS ON TRACK'" \
            "the BFF now REFUSES DOCS_WORKSPACE_ID. A stale line no longer sits harmless — it stops the boot. Reword all three to 'refuses to start'."
    else
        ok "DOCS_WORKSPACE_ID is ignored, not refused — the warning is accurate"
    fi
fi

# ── D3 ───────────────────────────────────────────────────────────────────────
# DECISION: the member sync is wired ON, and the runbook's expected-noise section says silence
#           in the docs logs is a FAULT.
# PREMISE:  the compose fragment actually sets all three variables. SyncMembers returns SILENTLY
#           when unconfigured, so nothing else would report it.
if subject deploy/track-docs.compose.yaml "the member sync is ON, and log silence is a fault"; then
    n=$(grep -cE '^\s+(TRACK_MEMBER_SYNC_SECRET|DOCS_TRACK_MEMBER_SYNC_SECRET|DOCS_TRACK_URL):' deploy/track-docs.compose.yaml 2>/dev/null || true)
    # ⚠ A COUNT THAT IS NOT A NUMBER IS NOT A COUNT. `n` empty (grep could not read the file at
    # all) made `[ "${n}" -ne 3 ]` exit 2 — non-zero, so the `if` took the ELSE branch and this
    # check reported all three variables present. `subject` above closes the missing-file door;
    # this closes the door for every other way grep can fail to produce a number.
    case "${n}" in '' | *[!0-9]*) n=-1 ;; esac
    if [ "${n}" -ne 3 ]; then
        void "the member sync is ON, and log silence is a fault" \
            "deploy/FULL-STACK-DEPLOY.md § '3a' and § 'the member-sync lines'" \
            "the fragment sets ${n} of 3 sync variables (-1 = the count could not be read at all). SyncMembers no-ops SILENTLY, so the runbook's 'silence is a fault' is now backwards."
    else
        ok "member sync wired — all 3 variables present in the fragment"
    fi
fi

# ── D4 ───────────────────────────────────────────────────────────────────────
# DECISION: STEP 4 is an ADD, not a swap, and rollback is a binary swap alone.
# PREMISE:  the current BFF tolerates LENS_WORKSPACE_KEY / LENS_WORKSPACE_ID (reads neither,
#           refuses neither), so one env file boots either binary.
if subject apps/bff/main.go "STEP 4 'ADD, DO NOT DELETE' and the binary-swap-only rollback"; then
    if grep -qE 'LENS_WORKSPACE_(KEY|ID)' apps/bff/main.go 2>/dev/null; then
        void "STEP 4 'ADD, DO NOT DELETE' and the binary-swap-only rollback" \
            "deploy/FULL-STACK-DEPLOY.md § 'STEP 4' and § 'Why the BFF env change is NOT one-way'" \
            "main.go now mentions LENS_WORKSPACE_KEY/_ID. If it READS them the variables are live again; if it REFUSES them, one file no longer boots both binaries and rollback needs an env restore."
    else
        ok "LENS_WORKSPACE_* inert on the BFF — one file boots either binary"
    fi
fi

# ── D5 ───────────────────────────────────────────────────────────────────────
# DECISION: the runbook's bundle checks read a version rather than grepping content, and the
#           tester-notice grep is kept only as a transitional fallback.
# PREMISE:  the build stamps a version into the bundle.
#
# ⚠ THIS READ `grep -q 'stampBuild' apps/web/vite.config.ts` AND WAS SATISFIED BY THE PARAGRAPH
# THAT DESCRIBES THE PLUGIN. Measured 2026-08-28 at 94b9899: with the plugin REMOVED FROM THE
# PIPELINE AND ITS DEFINITION DELETED, the doc comment at the top of that file — "stampBuild writes
# the commit this bundle was built from into the build output" — still matched, and this check
# printed `ok` under "All locally-checkable premises still hold." It is the same failure D7's
# header records ("the test file and these very comments satisfy" it) and the one D9's header
# records ("a guard that cannot tell a mention from a setting"), on the file D9 strips comments
# out of, and it was the only check of the four positive ones that had never had the lesson
# applied. apps/web/src/expiryLiveCode.test.ts is what keeps it applied.
#
# ⚠ AND THE DEFINITION ALONE IS NOT THE PREMISE — the plugin has to be IN THE PIPELINE. Deleting
# `stampBuild()` from `plugins: [...]` and leaving the function defined stops the stamp landing
# while a definition-only check still says yes, so both halves are asserted.
#
# ⚠ TWO MECHANISMS STAND HERE AND EITHER ALONE IS SUFFICIENT — MEASURED WHEN A CONTROL CAME BACK
# GREEN AND WAS DIAGNOSED RATHER THAN SCORED (~/talyvor-queue/w17-commentblind-controls-d7q2.py).
# Removing the comment-strip alone moves NO verdict, because every comment form puts a non-space
# character before the token and `^[[:space:]]*` already refuses it; removing the anchors alone
# moves no verdict either, because the strip has already dropped the line. So neither
# single-mechanism control can fail, and the only whole-fix control is C1a, which reverts this
# block to the one line it shipped with. The strip is kept rather than deleted as dead weight
# because D9 reads this same file the same way and the two should not diverge in method — but it
# is redundant TODAY, and that is written down so nobody mistakes it for the load-bearing half.
if subject apps/web/vite.config.ts "version comparison replaces the bundle content grep"; then
    _d5_src=$(grep -vE '^[[:space:]]*(//|/\*|\*)' apps/web/vite.config.ts 2>/dev/null)
    _d5_def=$(printf '%s\n' "${_d5_src}" | grep -cE '^[[:space:]]*function stampBuild\(')
    _d5_use=$(printf '%s\n' "${_d5_src}" | grep -cE '^[[:space:]]*plugins:.*stampBuild\(')
    case "${_d5_def}" in '' | *[!0-9]*) _d5_def=0 ;; esac
    case "${_d5_use}" in '' | *[!0-9]*) _d5_use=0 ;; esac
    if [ "${_d5_def}" = 0 ] || [ "${_d5_use}" = 0 ]; then
        void "version comparison replaces the bundle content grep" \
            "deploy/FULL-STACK-DEPLOY.md § 'STEP 6d'" \
            "$( [ "${_d5_def}" != 0 ] || echo 'vite.config.ts no longer DEFINES stampBuild in live code. ' )$( [ "${_d5_use}" != 0 ] || echo 'vite.config.ts no longer lists stampBuild() in its plugins array, so the plugin is defined and never runs. ' )dist/version.json is not emitted and every version-based check silently reads nothing."
    else
        ok "bundle stamping present — version checks are readable"
    fi
fi

# ── D6 ───────────────────────────────────────────────────────────────────────
# DECISION: the deploy builds through scripts/build-release.sh in BOTH places (STEP 2 and the
#           redeploy section), so CI's stamp guard covers the path humans actually run.
# PREMISE:  no hand-rolled build survives in the runbook.
if subject deploy/README.md "the runbook builds only through scripts/build-release.sh"; then
    if grep -qE '^\s*\(\s*cd apps/bff && .*go build|^\s*pnpm --filter @talyvor/web build' deploy/README.md 2>/dev/null; then
        void "the runbook builds only through scripts/build-release.sh" \
            "deploy/README.md § '2. Build' and § 'Redeploying after a merge'" \
            "a hand-rolled build is back in the runbook. It does not stamp, so CI's guard passes while the deployed artifacts are unidentifiable."
    else
        ok "no hand-rolled build in the runbook"
    fi
fi

# ── D7 ───────────────────────────────────────────────────────────────────────
# ⚠ THIS CHECK HAS BEEN INVERTED, and the inversion is the point rather than a tidy-up.
#
# D7 was written FORWARD-LOOKING: it fired the moment `member-sync` appeared in apps/bff, to
# catch the exact case where nothing is failing when a document becomes stale. It worked —
# it fired on the commit that landed the nudge, naming the section to rewrite. 3a-bis has now
# been rewritten and the decision it guarded ("a first-visit 403 lasting up to 15 minutes,
# fixed by restarting Docs") is VOID.
#
# But a fire-once trigger cannot be left in place after it fires: it can never go green again,
# so it would either be silenced — which this script's own footer forbids — or normalised into
# a permanently-red step everyone learns to scroll past. Deleting it is just as wrong: the
# claim in 3a-bis got STRONGER, not weaker. It used to warn about a wait; it now PROMISES
# there is none, and a promise is the more expensive thing to have go quietly false.
#
# So D7 now guards the new decision, in the opposite direction:
#
# DECISION: STEP 3a-bis tells the operator membership lands AT LOGIN — no wait, no restart —
#           and that a first-visit 403 is therefore a fault to investigate, not a known wait.
# PREMISE:  the BFF actually calls Docs' on-demand member-sync at login.
#
# If that call is ever removed, refactored out, or renamed, the runbook silently goes back to
# promising something nobody delivers — and the failure is invisible, because the 2-minute
# sweep still makes it eventually work. An operator would be told to chase a misconfiguration
# that is not there. Both halves are checked, so the document and the code cannot drift apart
# in either direction.
#
# ⚠ THE CODE-SIDE DETECTOR IS NARROW ON PURPOSE, and it was WRONG on the first attempt. It
# matched `member-sync` anywhere in apps/bff/*.go, which the test file and these very comments
# satisfy — so deleting the production call left the check GREEN. It was caught by deliberately
# breaking it rather than by reading it: a guard nobody has watched fail is not known to guard.
# It now matches the CALL, in non-test source only. Keep it that way: widening it back to a
# word that appears in prose restores the hole.
#
# ⚠⚠ AND THAT NARROWING CLOSED THE PROSE DOOR AND LEFT THE COMMENTED-OUT-CALL DOOR OPEN, WHICH
# IS THE SAME DOOR. Measured 2026-08-28 at 94b9899: comment out the whole `if trackWS != ""`
# block in apps/bff/auth.go — it still COMPILES and `go vet` is clean — and `grep -qF
# 'a.nudgeDocsMemberSync('` matches the disabled call exactly as well as the live one did.
# `_d7_code=1`, this check printed `ok`, and the register exited 0 saying every locally-checkable
# premise holds, while the login-time nudge 3a-bis PROMISES was gone. The product IS defended —
# the BFF test TestDocsNudge_FailureDoesNotAbortLogin fails on that same mutation — so what was
# blind is this register, whose whole job is to tell a deployer the premise still holds.
# Comment lines are dropped before the match now, the way D9 already does it, and
# apps/web/src/expiryLiveCode.test.ts is what keeps both halves honest.
#
# ⚠⚠⚠ AND THE FIRST FIX FOR IT WAS `grep -v … | grep -qF …`, WHICH IS GREEN ON macOS AND RED ON
# LINUX, SO A FULL LOCAL GAUNTLET PASSED AND CI CAUGHT IT. This script sets `-o pipefail`. GNU
# grep's `-q` exits the moment it matches; the upstream `grep -v` is then killed by SIGPIPE, the
# pipeline's status is 141, and `&& _d7_code=1` never runs — so D7 VOIDED on a healthy premise
# and took the whole register to exit 1. BSD grep reads to EOF, so the identical pipeline returns
# 0 on a workstation. Measured both ways in a debian:bookworm-slim container against this repo:
# 141 with pipefail, 0 without it, 0 on macOS. THE RULE: under `pipefail`, never read the STATUS
# of a pipeline that ends in `grep -q` — count with `grep -c`, which reads to EOF, and compare
# the number. That is what this file's own `cannot` header has always said about `grep -c`, for
# a different reason, and it is now true for two. The shape is guarded statically in
# apps/web/src/expiryLiveCode.test.ts so the next one is caught before CI rather than by it.
#
# ⚠ ONLY THE DOCUMENT HALF TAKES A `subject` GATE, and that is a statement about the two halves
# rather than an omission. The code half is a GLOB over apps/bff/*.go looking for the CALL: it
# already fails closed, because a glob that matches nothing leaves `_d7_code=0` and voids. The
# document half names ONE path, which is the shape that cannot tell a missing file from a
# rewritten section — and the void it would otherwise print blames the wording for the absence
# of the whole document, which is the wrong diagnosis by exactly the distance that costs a
# reader an hour.
if subject deploy/FULL-STACK-DEPLOY.md "STEP 3a-bis's promise that membership lands at login"; then
    _d7_code=0; _d7_doc=0
    for _f in apps/bff/*.go; do
        case "$_f" in *_test.go) continue ;; esac
        _d7_hits=$(grep -vE '^[[:space:]]*(//|/\*|\*)' "$_f" 2>/dev/null |
            grep -cF 'a.nudgeDocsMemberSync(')
        case "${_d7_hits}" in '' | *[!0-9]*) _d7_hits=0 ;; esac
        [ "${_d7_hits}" != 0 ] && _d7_code=1
    done
    grep -qF 'membership row exists' deploy/FULL-STACK-DEPLOY.md 2>/dev/null && _d7_doc=1
    if [ "$_d7_code" = 1 ] && [ "$_d7_doc" = 1 ]; then
        ok "3a-bis promises login-time membership, and the BFF delivers it"
    elif [ "$_d7_code" = 0 ] && [ "$_d7_doc" = 1 ]; then
        void "STEP 3a-bis's promise that membership lands at login" \
            "deploy/FULL-STACK-DEPLOY.md § '3a-bis. THE FIRST-VISIT WINDOW'" \
            "the BFF NO LONGER calls Docs' on-demand member-sync, so the first-visit window is open again — but 3a-bis still says a 403 there is a fault to investigate. It would send an operator hunting a misconfiguration that does not exist, and the 2-minute sweep hides it by making the write succeed on a retry. Restore the call (apps/bff/docs_membersync.go) or rewrite 3a-bis to describe a wait again."
    else
        void "STEP 3a-bis does not describe the login-time nudge" \
            "deploy/FULL-STACK-DEPLOY.md § '3a-bis. THE FIRST-VISIT WINDOW'" \
            "the section no longer states that the membership row exists before the redirect completes. Either it was rewritten back to describing a wait while the code still nudges, or the wording this check anchors on moved — re-anchor it deliberately rather than loosening the match."
    fi
fi

# ── UNCHECKABLE FROM THIS REPO ───────────────────────────────────────────────
echo
cannot "Docs' roster prune stays scoped to source='track' (what makes a seed row safe, and what makes the prune safe to arm)" \
    "talyvor-docs internal/membership/store.go" \
    "[ \"\$(grep -vE '^[[:space:]]*//' internal/membership/store.go | grep -c \"AND source = 'track' AND email\")\" = 1 ] && { [ -n \"\${DOCS_TEST_DATABASE_URL:-}\" ] || { echo 'NOT A MOVED PREMISE: the SOURCE half above RAN AND HELD; the behavioural half is settled by a real-Postgres test and DOCS_TEST_DATABASE_URL is unset, so the run never reached it. Set it and re-run; see the repo README. Exit 3 is this prerequisite, exit 1 is the premise having moved.' >&2; exit 3; }; [ \"\$(go test ./internal/membership/ -run '^TestReconcileWorkspace_NeverPrunesRowsItDidNotSync\$' -v 2>&1 | grep -c '^--- PASS: TestReconcileWorkspace_NeverPrunesRowsItDidNotSync')\" = 1 ]; }   # in a talyvor-docs checkout. ⚠ THE FIRST VERSION OF THIS ENTRY WAS A BARE \`grep -q\` ON THE PHRASE source = 'track' AND IT EXITED 0 WITH THE PREMISE DELETED. Measured 2026-08-28 in a read-only git archive export at f64e967: remove the predicate from the prune's WHERE clause and the check stays green, because the PROVENANCE comment 59 lines earlier repeats the literal. That is the D7 trap this file records twice. It was also the ONLY entry in NO rule of apps/web/src/settleCommands.test.ts — no go test, no grep -o, no grep -c — so nothing there had ever run for it; R10 is what closes that. The source clause now drops comment lines, matches the SQL fragment rather than the bare phrase, and COMPARES A COUNT. The behavioural clause drives the upstream test that seeds a Docs-native member beside two Track-synced ones and fails if the prune takes it — the strong form this file's own header ranks second and a documented grep last."

cannot "Track answers 200+[] for an unknown workspace and has no 404 branch on /v1/service/members (why an unknown id cannot error the sync)" \
    "talyvor-track internal/member/handler.go" \
    "[ -n \"\${TRACK_TEST_DATABASE_URL:-}\" ] || { echo 'NOT A MOVED PREMISE: this one is settled by a real-Postgres test and TRACK_TEST_DATABASE_URL is unset, so the run never reached the premise. Set it and re-run; see the repo README. Exit 3 is this prerequisite, exit 1 is the premise having moved.' >&2; exit 3; }; go test ./internal/member/ -run TestServiceMembers_NonExistentWorkspace_EmptyAndAudited -v 2>&1 | grep -q '^--- PASS: TestServiceMembers_NonExistentWorkspace_EmptyAndAudited'   # in a talyvor-track checkout, against its test Postgres; that test asserts the 200 AND the [] body"

cannot "Docs enumerates workspaces from Track, not from its own content (the whole basis for deleting the seed)" \
    "talyvor-docs internal/trackintegration/enumerate.go" \
    "[ -n \"\${DOCS_TEST_DATABASE_URL:-}\" ] || { echo 'NOT A MOVED PREMISE: this one is settled by a real-Postgres test and DOCS_TEST_DATABASE_URL is unset, so the run never reached the premise. Set it and re-run; see the repo README. Exit 3 is this prerequisite, exit 1 is the premise having moved.' >&2; exit 3; }; go test ./internal/trackintegration/ -run TestSyncMembers_ReachesAWorkspaceWithNoContent -v 2>&1 | grep -q '^--- PASS: TestSyncMembers_ReachesAWorkspaceWithNoContent'   # in a talyvor-docs checkout, against its test Postgres — measured cold at df4a90d: without the guard above this exits 1 with ZERO bytes on stdout and stderr, because \`2>&1 | grep -q\` swallows the upstream test's own 'DOCS_TEST_DATABASE_URL is not set' paragraph"

cannot "one secret gates BOTH Track service endpoints (why MEMBER_SYNC_SECRET is a single .env key)" \
    "talyvor-track cmd/track/main.go" \
    "[ \"\$(grep -c 'cfg.MemberSyncSecret' cmd/track/main.go)\" = 2 ]   # ONE secret read at BOTH mount points — a count of 1 is the failure, and grep -c's own exit status cannot see it"

# ── THE PREMISE UNDER A CLAIM THIS PAGE DOES NOT MAKE, AND WHY IT IS HERE ────
# DECISION: areas/marketing/Landing.tsx withholds "the cost of an issue, a document or a change
#           lands in one ledger", and Landing.test.tsx pins the page's silence.
# PREMISE:  what Docs can say about a page's own AI cost is a LOWER BOUND.
#
# ⚠ THIS ENTRY EXISTS BECAUSE THE PREVIOUS PREMISE EXPIRED WITH NOTHING WATCHING IT. The reason
# written beside that assertion was "Docs tags its own Lens calls by FEATURE and never by page, so
# no per-page attribution exists to report", with a restore condition naming an upstream shape.
# MEASURED read-only at talyvor-docs 63b7ea6, three independent ways: the attribution test PASSES,
# migration 0018 adds pages.own_ai_cost_usd plus the page_ai_spend_events ledger, and
# cmd/docs/main.go wires the binder into the production engine. Docs attributes AI spend to a page
# today, and 0018's header names THIS page's sentence as the thing it was built to make true.
#
# ⚠ WHY NO TEST HERE COULD HAVE CAUGHT IT, which is what puts it in the uncheckable half rather
# than in form 1 or 2. The guard is an ABSENCE test over the rendered page: it asserts the sentence
# is not there. That is green for every possible state of talyvor-docs — no upstream change can red
# it, in either direction. The claim guard is right to be shaped that way (its job is to hold the
# page); the consequence is that the premise underneath it had no instrument at all.
#
# ⚠ THE COMMAND WAS RUN IN EVERY STATE, on a pristine `git archive` export of talyvor-docs 63b7ea6
# rather than in a working tree another session holds (~/talyvor-queue/w11-pagecost-premise-controls-3c5f.py):
#   both tests present and passing                                              EXIT 0
#   EachSinglePageOperationBindsItsPage renamed away — count 1, not 2           EXIT 1
#   the production binder unwired, so the binding test FAILS                    EXIT 1
#   the exclusion test renamed away — the LOWER-BOUND half alone going dark     EXIT 1
#   the bare `go test … -run` form this register forbids, on the renamed tree   EXIT 0
# The second-to-last line is the control: on a tree where the named test is gone, the forbidden
# shape still answers yes. Both names are matched because the premise has two halves — attribution
# EXISTS, and it is INCOMPLETE — and a command that checked only the first still reported EXIT 0 on
# the tree where the second had gone dark (measured, S4b).
#
# ⚠ THE FIRST DRAFT OF THIS COMMAND WAS FAIL-OPEN AND THE CONTROLS ARE WHY THAT IS NOT SHIPPED. It
# matched `TestAttribution_` as a PREFIX and passed the -run regex unanchored, so a test renamed to
# `…BindsItsPageRenamed` still matched -run, still printed `--- PASS: TestAttribution_…`, and still
# counted — the rename control it exists for reported EXIT 0. Both ends are anchored now: `^…$` on
# the filter and the FULL names, with the trailing space `go test` prints before the duration, on
# the count. The generic-prefix shape is a third measured hazard on top of the register's two.
cannot "a page's own AI cost is a LOWER BOUND — Docs DOES attribute AI spend per page (own_ai_cost_usd), and docs-ai-ask / docs-search are excluded by design, so 'the cost of a document' would be a floor sold as a total" \
    "talyvor-docs internal/ai/engine.go, internal/page/ai_spend.go, migrations/0018_page_own_ai_spend.sql" \
    "[ \"\$(go test ./internal/ai/ -run '^TestAttribution_(EachSinglePageOperationBindsItsPage|AskSpansPagesAndBindsNothing)\$' -v 2>&1 | grep -c -E '^--- PASS: TestAttribution_(EachSinglePageOperationBindsItsPage|AskSpansPagesAndBindsNothing) ')\" = 2 ] && [ \"\$(sed 's/--.*//' migrations/0018_page_own_ai_spend.sql | grep -oE 'ADD COLUMN IF NOT EXISTS own_ai_cost_usd [^;]*')\" = \"ADD COLUMN IF NOT EXISTS own_ai_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0\" ]   # in a talyvor-docs checkout; BOTH halves — attribution exists AND ask/search bind nothing — anchored at both ends because the prefix form counted a RENAMED test and reported the premise confirmed, and a count of 0, which is also what a deleted test produces, is the failure neither go test's nor grep -c's exit status can see. NEEDS NO DATABASE — measured cold TWICE at docs 313eb86 and df4a90d with every *_TEST_DATABASE_URL stripped from the environment: green. TestAttribution_* drives a recordingBinder and a lensStub and opens no connection, which is why this is the one go test entry here with no prerequisite guard, and why that arm of the rule is a measurement rather than an escape hatch. THE THIRD SUBJECT IS READ BY THE SECOND HALF, AND UNTIL 2026-08-27 IT WAS READ BY NOTHING: the two attribution tests drive a recordingBinder fake and a lensStub and open no connection, so migrations/0018 — declared as a subject of this premise because own_ai_cost_usd is the column the premise names — could be emptied AND deleted, against a FRESH database, with this command still exiting 0 (measured per (entry, subject) at docs 313eb86, ~/talyvor-queue/w171-subject-arming-census-j8w4.py: 51 pairs, 50 armed, this one inert). The comment strip is not decoration: own_ai_cost_usd appears FIVE times in this migration's prose, so a bare grep for the name is satisfied by a paragraph, and without \`sed 's/--.*//'\` a DDL line COMMENTED OUT still answers yes — the prose-satisfies-the-assertion failure this register has paid for twice already"

# ── THE MONEY ALLOW-LIST, AND WHY IT IS HERE RATHER THAN IN A TEST ───────────
# DECISION: apps/bff/billing.go keeps its OWN copy of Lens's accepted top-up sizes
#           (allowedTopUpCents), refuses anything else in amountAllowed BEFORE dialing Lens, and
#           serves the list to the screen from /api/lxc/topup-options so the UI can never draw a
#           button this BFF would reject.
# PREMISE:  Lens still accepts exactly those three sizes.
#
# ⚠ THE MITIGATION THIS ENTRY REPLACES WAS A RESTATEMENT WEARING THE WORD "PIN". billing.go's
# header said "a test pins the values against the Lens source". MEASURED: the test declared the
# same three literals in the same package and compared copy to copy — it read nothing of
# talyvor-lens, and no test here can. CI checks out this repository alone, so a guard that reads a
# sibling repo only when it happens to be present is inert in CI, which is exactly where it would
# have to fire. That is this register's own "weakest of the three forms" argument arriving from
# below: form 2 was unavailable, and calling it form 2 anyway is worse than admitting form 3.
#
# ⚠ THE OPEN DIRECTION IS THE APPEND, WHICH IS ALSO THE ONLY DIRECTION THE LIST IS DOCUMENTED TO
# MOVE IN. Both repos state the list is ADDITIVE-ONLY (an async payment can settle days after the
# session is created and the webhook re-checks the list, so removing a size would mark a
# legitimately-paid purchase anomalous). Removal is already covered at runtime — Lens answers 400
# and handleLXCCheckout reports allow-list drift naming both lists. An APPEND is silent in both
# repos: Lens sells a fourth size, this BFF refuses it before any dial, the screen never offers it,
# nothing goes red, and the only symptom is revenue that never arrives.
#
# ⚠ THE COMMAND WAS RUN IN A REAL talyvor-lens CHECKOUT IN EVERY STATE BEFORE BEING WRITTEN DOWN,
# because a prescription nobody has watched fail is not known to fail:
#   today's three sizes                                                        EXIT 0
#   the same command against an APPENDED fourth size — the arrival case        EXIT 1
#   the file absent: grep writes nothing to stdout, so `[ "" = 1 ]` is false   EXIT 1
#   the bare `grep -c … FILE` form this register forbids, same absent file     EXIT 2
# It greps the WHOLE declaration line for that reason: a pattern matching only the name would go
# on saying yes across the one change this premise exists to catch.
#
# apps/web/src/topUpMirrorRegister.test.ts keeps the amounts in this command equal to the amounts
# apps/bff/billing.go enforces. Without it a deployer can get a confident yes about a list this
# BFF does not use — a pass for the wrong question, which is worse than no entry at all.
cannot "Lens still accepts exactly \$10 / \$50 / \$100 (the BFF copies this list into allowedTopUpCents and refuses anything else before it dials Lens)" \
    "talyvor-lens internal/billing/billing.go" \
    "[ \"\$(grep -c '^var allowedTopUps = \[\]int64{1000, 5000, 10000}\$' internal/billing/billing.go)\" = 1 ]   # in a talyvor-lens checkout; the WHOLE declaration line, so an APPENDED fourth size fails it — and a count of 0, which is also what an absent file produces, is the failure grep -c's own exit status cannot see"

# ── W1.1's premise, and it is not in ANY repository ──────────────────────────
# DECISION: the console's dark theme IS the public site's palette — canvas/surface/ink/muted/
#           accent taken byte for byte, with every divergence named and measured.
# PREMISE:  the site still serves those values.
#
# ⚠ THIS IS THE WEAKEST PREMISE IN THE FILE, because the artifact it rests on is not a repo we
# control, is not pinned to a commit, and can be redeployed by someone who has never heard of
# this console. site-parity.test.ts guards OUR side — that nobody quietly drifts a token away
# from what was measured — and it cannot guard the site's. Nothing in CI can: the runner has no
# business reaching out to a third-party origin mid-build, and a check that fails when a CDN
# hiccups is a check people learn to re-run rather than read.
#
# ⚠ AND THE FIRST VERSION OF THIS CHECK PINNED THE STYLESHEET'S HASHED FILENAME, reasoning that
# "if the filename still resolves, the bytes behind it are the bytes that were measured". That
# direction is sound. The one it was actually used in is not, and it went wrong on 2026-08-09:
# the site was redeployed, /assets/styles-CGSz1SmS.css began returning 404 — and ALL NINE VALUES
# WERE UNCHANGED at the new name (styles-AuqlUACj.css, re-measured byte for byte). Content
# hashing means the name moves when ANY byte of the site's CSS moves; it says nothing about
# these five variables. So the check read STALE while the premise held perfectly, which is the
# "people learn to re-run it rather than read it" failure this file warns about, arriving
# through the other door.
#
# The command below therefore pins the VALUES and resolves the filename from the served HTML.
# It survives a redeploy, and it goes quiet only when the palette genuinely moves.
cannot "the console's dark palette IS the public site's (canvas #060A12, surface #0B1220, ink #E6EEF7, muted #7E93AB, accent #3AD6C0)" \
    "talyvor.higgsfield.app — a third-party deployment, not a repository" \
    "curl -s https://talyvor.higgsfield.app/\$(curl -s https://talyvor.higgsfield.app/ | grep -o 'assets/styles-[A-Za-z0-9_-]*\.css' | head -1) | grep -o -- '--color-\(ink\|txt\|acc\|hairline\)[a-z-]*:[^;]*' | sort -u   # expect exactly the 9 values in packages/ui site-parity.test.ts (the old pattern missed hairline and returned 8); do NOT pin the hash — it moves on every unrelated redeploy"

# ── D8 ───────────────────────────────────────────────────────────────────────
# DECISION: the login nudge sends the transit proof and NO identity headers.
# PREMISE:  Docs' /v1/service/ lane is exempt from membership authz but NOT from the gateway
#           secret. Added after the nudge 403ed in production for its entire life: it was
#           mounted behind authz, which refuses a request with no verified email, and the BFF
#           correctly sends none.
#
# ⚠ THE LOCAL HALF IS CHECKABLE AND IS THE ONE THAT BITES. Docs' authz 403s only on a MISSING
#   email and passes one resolving to zero memberships, so adding X-User-Email here would make
#   a future 403 disappear while re-coupling a service call to the user lane. That is the fix
#   someone reaches for at 2am, and this is what stops it.
#
# ⚠ THIS IS THE ONE WHERE THE MISSING-SUBJECT HOLE HAD TEETH, and it is why `subject` was added
# rather than the four cheaper checks being left alone. D7's code half asks whether the nudge is
# CALLED and globs the whole package for it; D8 asks what the nudge SENDS and names one file. So
# a refactor that moves the request construction out of apps/bff/docs_membersync.go — into the
# caller, into a shared client — keeps D7 green (the call is still somewhere in apps/bff/*.go)
# and leaves D8 grepping a path that no longer exists, which is a pass. The register would have
# gone on certifying "no identity headers" about code it could not see, on the lane whose whole
# point is that it carries none.
if subject apps/bff/docs_membersync.go "the Docs nudge is a SERVICE call carrying only the transit proof"; then
    if grep -qE 'X-User-(Email|Id|Teams)|X-Auth-Iss' apps/bff/docs_membersync.go 2>/dev/null; then
        void "the Docs nudge is a SERVICE call carrying only the transit proof" \
            "apps/bff/docs_membersync.go and talyvor-docs internal/gatewayauth/exempt.go" \
            "the nudge now sends an identity header. Docs' service lane resolves no identity, so this either does nothing or makes the call depend on the USER lane — which 403s for exactly the workspace this route exists to serve."
    else
        ok "the Docs nudge sends no identity headers — service lane, transit proof only"
    fi
fi

cannot "Docs' /v1/service/ lane skips membership authz but still requires the gateway secret" \
    "talyvor-docs internal/gatewayauth/exempt.go" \
    "[ -n \"\${DOCS_TEST_DATABASE_URL:-}\" ] || { echo 'NOT A MOVED PREMISE: this one is settled by a real-Postgres test and DOCS_TEST_DATABASE_URL is unset, so the run never reached the premise. Set it and re-run; see the repo README. Exit 3 is this prerequisite, exit 1 is the premise having moved.' >&2; exit 3; }; [ \"\$(go test ./internal/trackintegration/ -run 'TestServiceRoute' -v 2>&1 | grep -c '^--- PASS: TestServiceRoute')\" = 2 ]   # BOTH halves: accepts the BFF's exact request, AND still refuses without the proof — one passing is not the premise"

# ── THE SEVEN CROSS-REPO STRUCT MIRRORS, AND THE SENTENCE THAT STOOD IN FOR THEM ────
# DECISION: apps/web/src/areas/track/types.ts and apps/web/src/areas/docs/api.ts declare
#           TypeScript shapes for structs that live in talyvor-track and talyvor-docs, and every
#           screen and fixture in those areas is typed off them.
# PREMISE:  each interface, PLUS the upstream fields it declares it does not mirror, is still the
#           whole upstream struct.
#
# ⚠ THESE ENTRIES EXIST BECAUSE THE PREMISE WAS CARRIED BY A SENTENCE INSTEAD, AND THE SENTENCE WAS
# FALSE IN BOTH FILES. types.ts said "JSON-verbatim from talyvor-track @ a3bc7b2 … so the day the
# BFF proxies these routes, the fixture types are already the live types" while TrackIssue held 21
# of model.Issue's 30 json fields; `labels` and `sort_order` carry no omitempty, so they are on
# EVERY issue response. api.ts said "Shapes mirror talyvor-docs internal/model/model.go VERBATIM
# (field-for-field, at e0cf605) — the types already speak the upstream shape" while DocsPage held
# 29 of model.Page's 31, missing own_ai_cost_usd and total_ai_cost_usd, both without omitempty.
# Neither is a live bug: the BFF streams these bodies through and the extra keys are invisible to
# TypeScript. The PROMISE is what was false, and no change in this repository could falsify it.
#
# ⚠ WHY THIS IS THE WEAK FORM AND NOT A TEST, AGAIN. A test here would have to read a sibling
# repository. CI checks out this one alone, so it would be inert exactly where it must fire — the
# argument topUpMirrorRegister.test.ts measured for the money allow-list, arriving unchanged for
# shapes. apps/web/src/mirrorSubsetRegister.test.ts holds the half that IS local: the field set
# each command below asks about equals the interface's own fields plus its declared UPSTREAM-ONLY
# names. Without it a deployer can get a confident yes about a struct this repo does not believe
# in, which is a pass for the wrong question.
#
# ⚠ THE COMMAND IS A THIRD SHAPE, SO IT WAS RUN IN EVERY STATE BEFORE BEING WRITTEN DOWN — the
# register's two known hazards (`go test -run` matching nothing, `grep -c` trusted for its exit
# status) are both about a pipeline that answers yes having looked at nothing:
#   the struct as it is today                                                    EXIT 0
#   one field APPENDED to the struct — the arrival case                          EXIT 1
#   one field DELETED from the struct                                            EXIT 1
#   `omitempty` added to a field that had none — optionality is half the claim    EXIT 1
#   the struct RENAMED: sed matches nothing, "" is not the expected list          EXIT 1
#   the FILE absent: sed writes nothing to stdout, same comparison                EXIT 1
#   the forbidden shape — the same pipeline ending `| grep -q .` instead of comparing:
#     file absent EXIT 1, struct renamed EXIT 1 — so it is NOT blind where I predicted, because
#     sed keys on the struct name and prints nothing either way. It is blind to the three cases
#     this premise is actually about: a field APPENDED  EXIT 0, a field DELETED  EXIT 0, and an
#     omitempty that came or went  EXIT 0. The struct still prints tags, so the shape that reads
#     "did anything come out" confirms a field set that has moved underneath it — and the APPEND
#     is the documented arrival case. Comparing the captured list is the only form that sees it.
# LC_ALL=C is not decoration: the expected list is sorted in this repo by codepoint, and a
# collation that ignores `_` would order `created_at` against `creator_id` differently.
# ── WIRE VERSUS DECLARATION ──────────────────────────────────────────────────
#
# ⚠ EVERY MIRROR ENTRY BELOW EXTRACTS json TAGS OUT OF A STRUCT DECLARATION. THAT IS A PROXY FOR
# THE WIRE, AND MEASURED 2026-08-28 AT e4ba7f4 IT IS A PROXY WITH THREE HOLES — each of which
# COMPILES and leaves the extracted tag set byte-identical:
#
#   1. a custom MarshalJSON / UnmarshalJSON on the type, in a NEW file of the same package.
#      Verified end to end on talyvor-track model.Workspace in a read-only git archive export:
#      go build ./... exit 0, go vet clean, and the response becomes a single unrelated key —
#      EVERY DECLARED TAG GONE FROM THE WIRE — while the settle command still reported the mirror
#      as holding. (go test -short ./... on that export is identical to baseline; the
#      real-Postgres half was not run and is not claimed.)
#   2. an EXPORTED FIELD WITH NO json TAG. encoding/json puts it on the wire under its Go name,
#      and an extraction that reads json:"…" cannot see it. This is the likeliest of the three:
#      a field added in a hurry.
#   3. an EMBEDDED field, which promotes another type's fields — and its MarshalJSON — onto this
#      one without a single tag changing here.
#
# So each entry below carries two more clauses: FIELD LINES = TAGGED LINES inside the declaration
# window, which refuses 2 and 3, and NO (Un)MarshalJSON for that type in its package, which
# refuses 1. All fifteen HOLD on read-only exports of origin/main, and all forty-five mutations —
# three per entry, run against the command THIS FILE PRINTS rather than a reconstruction — are
# caught. A properly TAGGED field added to the struct does NOT red these two, which is correct:
# the tag-set comparison is what sees that, and it already did.
#
# ⚠ THE BOUNDARY, SO IT IS NOT OVERQUOTED: this makes the DECLARATION honest about itself. It
# still cannot see a handler that wraps the struct before writing it. The six request-body
# entries that extract from an ANONYMOUS struct at a route mount are out of population BY
# CONSTRUCTION — no method can attach to an anonymous type, so hole 1 cannot exist there.
#
# ⚠ ALL FIFTEEN CURRENTLY DECLARE ZERO CUSTOM MARSHALLERS, ZERO EMBEDDED FIELDS AND ZERO UNTAGGED
# FIELDS — censused before the clauses were written, so this fixes no live divergence. What was
# missing is that nothing would have noticed one. R11 in apps/web/src/settleCommands.test.ts is
# what stops a sixteenth mirror arriving without them.

cannot "TrackWorkspace mirrors talyvor-track Workspace — the workspace row the console renders from the ONE Track route the BFF proxies today" \
    "talyvor-track internal/model/model.go" \
    "[ \"\$(sed -n '/^type Workspace struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"created_at id logo_url name plan slug updated_at \" ] && [ \"\$(sed -n '/^type Workspace struct/,/^}/p' internal/model/model.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type Workspace struct/,/^}/p' internal/model/model.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?Workspace\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/model | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "TrackIssue mirrors talyvor-track Issue — the issue shape the list and detail screens read, and the one this subset was measured short on (labels and sort_order are on every response)" \
    "talyvor-track internal/model/model.go" \
    "[ \"\$(sed -n '/^type Issue struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"ai_cost_usd ai_tokens assignee_id,omitempty completed_at,omitempty created_at creator_id cycle_id,omitempty description due_date,omitempty field_values,omitempty ice_score,omitempty id identifier is_blocked,omitempty labels lens_feature milestone_id,omitempty number parent_id,omitempty priority project_id,omitempty relations,omitempty rice_score,omitempty sort_order status team_id time_tracked_sec,omitempty title updated_at workspace_id \" ] && [ \"\$(sed -n '/^type Issue struct/,/^}/p' internal/model/model.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type Issue struct/,/^}/p' internal/model/model.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?Issue\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/model | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "TrackComment mirrors talyvor-track Comment — the comment thread shape" \
    "talyvor-track internal/model/model.go" \
    "[ \"\$(sed -n '/^type Comment struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"author_id body created_at edited_at,omitempty id issue_id updated_at \" ] && [ \"\$(sed -n '/^type Comment struct/,/^}/p' internal/model/model.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type Comment struct/,/^}/p' internal/model/model.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?Comment\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/model | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "TrackTeam mirrors talyvor-track Team — the team shape behind the identifier this UI renders" \
    "talyvor-track internal/model/model.go" \
    "[ \"\$(sed -n '/^type Team struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"color created_at icon id identifier name updated_at workspace_id \" ] && [ \"\$(sed -n '/^type Team struct/,/^}/p' internal/model/model.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type Team struct/,/^}/p' internal/model/model.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?Team\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/model | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "TrackMember mirrors talyvor-track memberView — the assignee-picker projection, mirrored twice in this repo (areas/track/types.ts and areas/lens/Members.tsx)" \
    "talyvor-track internal/member/mgmt_handler.go" \
    "[ \"\$(sed -n '/^type memberView struct/,/^}/p' internal/member/mgmt_handler.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"avatar_url email id name role \" ] && [ \"\$(sed -n '/^type memberView struct/,/^}/p' internal/member/mgmt_handler.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type memberView struct/,/^}/p' internal/member/mgmt_handler.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?memberView\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/member | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "DocsSpace mirrors talyvor-docs Space — the space row SpaceList renders from the one live Docs read" \
    "talyvor-docs internal/model/model.go" \
    "[ \"\$(sed -n '/^type Space struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"color created_at created_by description icon id name private slug updated_at workspace_id \" ] && [ \"\$(sed -n '/^type Space struct/,/^}/p' internal/model/model.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type Space struct/,/^}/p' internal/model/model.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?Space\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/model | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-docs checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

# ⚠ THE ENTRY ABOVE COVERS AN AUTHZ KEY IT WAS NOT WRITTEN FOR, AND ONLY BECAUSE OF THE PREMISE
# THIS ONE PINS. `apps/bff/lens.go#docsSpaceCreateBody` overwrites `workspace_id` in the create-space
# body with the SESSION's workspace, because Docs authorizes THAT FIELD against membership and "the
# field an attacker edits should not exist in the request at all". The key it pins is a talyvor-docs
# key — and the only thing asking talyvor-docs about it is the Space mirror above, which pins
# `model.Space`'s tag set. That covers the create request ONLY because Docs' Create decodes into
# model.Space. Nothing recorded that, so the coverage was an accident nobody could see.
# ⚠ WHY IT MATTERS, MEASURED at suite `491eb21c` by calling docsSpaceCreateBody directly rather than
# reasoning about it — the pin is exact and the pass-through is total:
#   {"name":"Eng","workspace_id":"ws-ATTACKER"}  ->  {"name":"Eng","workspace_id":"ws-SESSION"}
#   {"name":"Eng","ws_id":"ws-ATTACKER"}         ->  {"name":"Eng","workspace_id":"ws-SESSION",
#                                                     "ws_id":"ws-ATTACKER"}
# Every key that is not `workspace_id` is forwarded VERBATIM, by design (decoding into a fixed struct
# would silently drop fields Docs supports). So on the day Docs authorizes on a DIFFERENTLY NAMED
# field, the BFF's pin lands on a key Docs ignores and the browser's own value under the new name is
# ALREADY being forwarded — the server-pinned authz field becomes client-controlled with no error
# anywhere. Docs' membership check still bounds it to workspaces the caller belongs to, which is
# precisely the residual the BFF comment names: "a user in two workspaces could still create in the
# wrong one". A rename of `model.Space` is caught by the mirror; a create handler that stops binding
# model.Space is caught HERE and by nothing else.
# ⚠ 5/5 controls against a real docs export: Create binding its OWN request struct -> RED (the exact
# fragility case) · Create renamed -> RED (empty capture) · handler.go emptied -> RED · a reworded
# SEC-4 comment -> GREEN. It pins the TYPE and the decode together, so a struct renamed in the
# declaration while the decode still reads it is a mismatch either way.
cannot "talyvor-docs' space CREATE binds model.Space, which is the ONLY reason the DocsSpace mirror above also covers the \`workspace_id\` apps/bff pins from the session — a create handler that binds its own request struct moves that authz key with the mirror still green, and apps/bff forwards every other key verbatim" \
    "talyvor-docs internal/space/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Create(/,/^}/p' internal/space/handler.go | grep -o 'var in model\\.[A-Za-z]*\\|Decode(&in)' | tr '\n' '|')\" = \"var in model.Space|Decode(&in)|\" ]   # in a talyvor-docs checkout; the decoded TYPE and the decode itself, together. An empty capture — which is what a renamed Create and an absent file both produce — fails this comparison rather than passing it, and that is the vacuity case a command reading an exit status cannot see"

cannot "DocsPage mirrors talyvor-docs Page — the page shape the tree and reader read, and the one that grew own_ai_cost_usd / total_ai_cost_usd while this repo said it mirrored the struct whole" \
    "talyvor-docs internal/model/model.go" \
    "[ \"\$(sed -n '/^type Page struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"ai_cost_usd content content_text cover_url created_at created_by depth doc_status,omitempty icon id is_template last_verified_at,omitempty last_viewed_at,omitempty linked_issues,omitempty locked locked_at,omitempty locked_by,omitempty own_ai_cost_usd page_type,omitempty parent_id,omitempty position slug space_id stale_after_days title total_ai_cost_usd updated_at updated_by verified_by,omitempty view_count workspace_id \" ] && [ \"\$(sed -n '/^type Page struct/,/^}/p' internal/model/model.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type Page struct/,/^}/p' internal/model/model.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?Page\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/model | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-docs checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

# ── THE PAGE-WRITE SEAM, WHERE THE MIRROR ABOVE READS AS COVERAGE AND IS NOT ──
# DECISION: apps/bff forwards the two Docs PAGE writes VERBATIM — docsCreatePage (POST
#           /v1/spaces/{s}/pages) and docsUpdatePage (PATCH /v1/spaces/{s}/pages/{p}), the last
#           two of the six `forwardProduct` calls that hand upstream the caller's own r.Body.
#           "Docs owns its schema, and re-encoding here would invent a second schema to drift
#           from." The browser therefore authors the wire: areas/docs/api.ts#updatePage sends
#           `title` and `content_text`, #createPage sends `title`.
# PREMISE:  those keys are still keys talyvor-docs will APPLY.
#
# ⚠ THE DocsPage MIRROR ABOVE DOES NOT COVER THE PATCH, AND IT LOOKS LIKE IT DOES. It pins
# `model.Page`'s json tags — but page Update does NOT decode into model.Page. It decodes into
# `map[string]any` and the gate is `updatableFields` in internal/page/store.go, a set the mirror
# never reads. The two disagree in BOTH directions and upstream says so in its own comment:
# `content_text` IS applied and is NOT in the allowlist (it is admitted by an explicit
# `k != "content_text"` exception), while `ai_cost_usd` is a model.Page tag that is deliberately
# NOT applicable. So the mirror can stay green over a page-write seam that has stopped writing.
#
# ⚠ WHAT A DRIFT COSTS HERE IS THE EDIT, AND THE CALLER IS TOLD NOTHING. Measured by reading the
# upstream store at docs `fd96dec7`: an un-allowlisted key is `continue`d — "DROPPED IN SILENCE
# rather than refused — the rest of the request still lands" — and when nothing survives the gate
# the method returns `s.GetByID(ctx, id)`, so Update answers **200 with the page body**. The
# handler's own `updates["updated_by"]` keeps `set` non-empty, which means the row's updated_at
# still moves: a save that stored nothing is indistinguishable from a save that worked, and the
# page even looks freshly touched.
#
# ⚠ THE EXCEPTION IS THE FRAGILE ONE ON PURPOSE. `content_text` is the ONLY key the suite's page
# editor writes (PageView.tsx), and it reaches the column through a hardcoded string exception in
# an allowlist loop — which is exactly what a tidy-up deletes. The queue's standing finding about
# this editor is that it writes the SEARCH PROJECTION rather than the document; that is a product
# DECISION (W2.3) and is not touched here. This entry is the narrower, undecided thing: whichever
# way that decision goes, nobody in either repo is asking whether the write still lands at all.
#
# ⚠ 12/12 controls, each predicted before it ran, against a disposable `git archive` export of
# talyvor-docs (the object store, never the working tree — that repo is held by another tab):
# exception removed -> RED (the defect) · an allowlist key renamed -> RED · a key ADDED -> RED ·
# updatableFields renamed -> RED · store.go emptied -> RED · **the comment that QUOTES the
# exception reworded -> GREEN**, the must-stay-green that forced the `!allowed &&` anchor: the
# obvious `grep -o 'k != "content_text"'` matches that comment line TOO and would have reddened
# on prose. Same matrix for the create binding. Harness: scripts/w171-docs-pagewrite-controls.py.
cannot "talyvor-docs page UPDATE applies updatableFields PLUS an explicit content_text exception — NOT model.Page's tag set, so the DocsPage mirror above is not the guard it reads as, and both keys areas/docs/api.ts#updatePage sends are in here (title by the allowlist, content_text by the exception alone)" \
    "talyvor-docs internal/page/store.go" \
    "[ \"\$( { sed -n '/^var updatableFields = map\\[string\\]struct{}{/,/^}/p' internal/page/store.go | grep -o '\"[a-z_]*\"'; grep -o '!allowed && k != \"content_text\"' internal/page/store.go; } | tr -d '\"' | LC_ALL=C sort | tr '\n' ' ')\" = \"!allowed && k != content_text content cover_url icon is_template linked_issues page_type parent_id position stale_after_days title updated_by \" ]   # in a talyvor-docs checkout; the allowlist AND the exception in ONE capture, so removing the exception is a mismatch exactly like renaming a key. An empty capture — a renamed updatableFields, an absent file — fails this comparison rather than passing it, which is the vacuity case a command reading an exit status cannot see"

cannot "talyvor-docs' page CREATE binds model.Page, which is the ONLY reason the DocsPage mirror above also covers the create REQUEST — a create handler that binds its own request struct moves that shape with the mirror still green, and apps/bff#docsCreatePage forwards every key verbatim" \
    "talyvor-docs internal/page/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Create(/,/^}/p' internal/page/handler.go | grep -o 'var in model\\.[A-Za-z]*\\|Decode(&in)' | tr '\n' '|')\" = \"var in model.Page|Decode(&in)|\" ]   # in a talyvor-docs checkout; the decoded TYPE and the decode itself, together — the same shape as the space-create entry above, for the sibling route nobody added when that one was added"

# ⚠ THE THIRD PAGE ROUTE, AND ITS CLAIM IS A DELETE RATHER THAN A SEND — WHICH IS WHY IT WAS THE
# ONE LEFT. apps/bff/lens.go#docsSpacePages relays the page LIST through `stripPageContentList`,
# which does `delete(row, "content")` and `delete(row, "content_text")` on every row. Those two
# literals are a claim about talyvor-docs' RESPONSE shape, and they are the only thing keeping
# every page's full ProseMirror document off the space tree.
#
# ⚠ NEITHER EXISTING GUARD COVERS IT, AND BOTH LOOK AS THOUGH THEY DO. apps/bff/products_test.go
# asserts the stripped body carries neither key — the right assertion over a FAKE Docs whose row
# this repository hardcodes, so both halves of the comparison live here and it is green whatever
# upstream serves. The DocsPage mirror above pins model.Page's tags, so a RENAME of `content` is
# caught — but NOT the list route ceasing to serve model.Page at all. `page.Handler.List` returns
# whatever `Store.List` returns, and a projection type added for the tree view (the ordinary
# reason to add one) leaves model.Page untouched, the mirror green, and both deletes matching
# nothing.
#
# ⚠ MEASURED, NOT REASONED, at docs fd96dec790454b133847a399be28704c0ce369ec — docs' own mounted
# route over a real pgvector Postgres, in a disposable `git archive` export (that repo was held by
# another tab and was never written to): GET /v1/spaces/{id}/pages -> 200, 10 rows, 6406 bytes, a
# 24-key row set carrying BOTH `content` and `content_text`, the seeded document text present
# VERBATIM in the unstripped body, and 5885 bytes after the BFF's two deletes. The premise holds
# today; nothing in this repo can see the day it stops, and the failure ships a document body
# rather than blanking a field.
#
# ⚠ THE COMMAND CAPTURES THE RETURN TYPE, NOT THE FUNCTION'S EXISTENCE. `grep -c 'Store) List('`
# answers 1 whether it returns []model.Page or []pageRow. Controlled against the export in all
# four directions: unchanged -> []model.Page (match) · return type -> []pageRow (EMPTY capture,
# mismatch) · List renamed (EMPTY capture, mismatch) · model.Page -> model.PageSummary
# ([]model.PageSummary, mismatch). An empty capture FAILS this comparison rather than passing it.
#
# ⚠⚠ AND FOR TWO MERGES THAT WAS ONLY HALF THE PREMISE, SO THE COMMAND EXITED 0 WHILE THE PREMISE
# WAS FALSE — the exact failure this file's own header names. The paragraph above says the other
# half out loud: "`page.Handler.List` returns whatever `Store.List` returns". That sentence IS a
# premise and the command did not read it. MEASURED at docs 806109b5 against a disposable
# `git archive` export, mutating the HANDLER and leaving the store alone:
#   a projection added in page.Handler.List  -> Store.List still returns []model.Page -> EXIT 0
#   page.Handler.List renamed                                                         -> EXIT 0
#   internal/page/handler.go DELETED                                                  -> EXIT 0
#   the store's value served through a second identifier (`shaped := forTree(out)`)   -> EXIT 0
# Four ways for the list route to stop serving model.Page rows with this register reporting that
# it still does — and model.Page's tags are untouched throughout, so the DocsPage mirror above
# stays green through all four as well.
# ⚠ THE CONSEQUENCE IS NOT A BLANKED FIELD, IT IS A DOCUMENT. Measured through the real
# apps/bff#stripPageContentList rather than reasoned about: a projected row carrying the page body
# under `body` went in at 120 bytes and came out at 120 bytes — both deletes matched nothing, no
# error, no 502, a 200 with the whole ProseMirror document on the space tree.
# ⚠ SO THE COMMAND NOW READS BOTH HALVES IN ONE COMPARISON, and both files are declared subjects
# because both are read. A `sed` command has no build graph to reach a file it does not name,
# which is why R6 in apps/web/src/settleCommands.test.ts no longer waves a `.go` subject through
# for a command that does not run `go test`. 10/10 controls, each predicted before it ran, both
# the old command and the new one against the same mutated export:
# ~/talyvor-queue/w171-pagelist-premise-controls-r5k9.py.
cannot "talyvor-docs' page LIST still serves model.Page rows — apps/bff/lens.go#stripPageContentList deletes content and content_text from every row BY NAME, and that redaction is the only thing keeping each page's whole ProseMirror document off the space tree; the DocsPage mirror pins the tags but not that this route still returns them" \
    "talyvor-docs internal/page/handler.go, internal/page/store.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) List(/,/^}/p' internal/page/handler.go | grep -o 'out, err := h\\.store\\.List(\\|writeJSON(w, http\\.StatusOK, out)' | tr '\\n' '|')\$(sed -n 's/^func (s \\*Store) List(.*) (\\(\\[\\]model\\.[A-Za-z]*\\), error) {\$/\\1/p' internal/page/store.go)\" = \"out, err := h.store.List(|writeJSON(w, http.StatusOK, out)|[]model.Page\" ]   # in a talyvor-docs checkout; BOTH halves of the premise in ONE comparison — the store call page.Handler.List makes, the identifier it hands to writeJSON, and Store.List's RETURN TYPE. A projection in EITHER layer, a rename of either function, or either file gone yields a capture that does not equal the expected string — including the empty capture, which is the vacuity case a command reading an exit status cannot see"

# ── THE REQUEST HALF OF THE SAME CLASS, AND IT IS THE HALF THAT SPENDS MONEY ─
# DECISION: this app builds the request body for three talyvor-docs AI routes (apps/bff/docs_ai.go)
#           and writes the fourth in the browser (areas/docs/api.ts#ask, forwarded verbatim).
# PREMISE:  the json keys it sends are still the keys those handlers BIND.
#
# ⚠ WHY THIS IS NOT COVERED BY THE RESPONSE MIRRORS ABOVE, AND WHY IT IS WORSE. A response shape
# that drifts renders a blank field. A REQUEST key that drifts is a 200 with a real billed
# completion that read NOTHING — measured on suggest-title, which binds `content` while its two
# siblings bind `text`: {"text":"Some real page text.","page_id":"pg-1"} → 200, 1 completion, 0
# user bytes. No status, error or response field separates that from a correct call.
#
# ⚠ AND THE THREE BFF TESTS THAT DECODE THE SENT BODY CANNOT SEE IT. They decode it through struct
# tags TRANSCRIBED INTO THIS REPO, so both halves of their comparison live here and an upstream
# rename leaves them green. Held to the bodies this repo actually sends by
# apps/web/src/aiRequestBodyRegister.test.ts, so a key changed here without changing the command
# below is a red rather than a question asked about a body nobody sends.
cannot "the summarise route sends what talyvor-docs Transform binds — action chooses what the workspace pays for, page_id is what the charge lands on" \
    "talyvor-docs internal/ai/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Transform(/,/^}/p' internal/ai/handler.go | grep -o 'json:\"[a-z_]*\"' | sed 's/json://;s/\"//g' | LC_ALL=C sort | tr '\n' ' ')\" = \"action page_id text \" ]   # in a talyvor-docs checkout; the WHOLE bind-tag set, so an ADDED key, a REMOVED one or a RENAMED one are each a mismatch — and on this route a wrong key is a 200 with a billed completion, not an error"

cannot "the translate route sends what talyvor-docs Translate binds — an omitted language is not a MISSING language, it is Engine.Translate's defaultLang and a billed completion in English" \
    "talyvor-docs internal/ai/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Translate(/,/^}/p' internal/ai/handler.go | grep -o 'json:\"[a-z_]*\"' | sed 's/json://;s/\"//g' | LC_ALL=C sort | tr '\n' ' ')\" = \"language page_id text \" ]   # in a talyvor-docs checkout; the WHOLE bind-tag set, so an ADDED key, a REMOVED one or a RENAMED one are each a mismatch — and on this route a wrong key is a 200 with a billed completion, not an error"

cannot "the suggest-title route sends what talyvor-docs SuggestTitle binds — this is the route whose key WAS wrong (#234): content here, text on both siblings, and upstream refuses neither" \
    "talyvor-docs internal/ai/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) SuggestTitle(/,/^}/p' internal/ai/handler.go | grep -o 'json:\"[a-z_]*\"' | sed 's/json://;s/\"//g' | LC_ALL=C sort | tr '\n' ' ')\" = \"content page_id \" ]   # in a talyvor-docs checkout; the WHOLE bind-tag set, so an ADDED key, a REMOVED one or a RENAMED one are each a mismatch — and on this route a wrong key is a 200 with a billed completion, not an error"

# ⚠ THE FIFTH ENTRY IS NOT AN AI ROUTE AND IS NOT IN THE AI FILE, WHICH IS WHY IT WAS MISSING.
# The four above were added by sweeping talyvor-docs' `internal/ai/handler.go`; the changelog body
# is built the same way, sent by the same BFF, and binds its keys in `internal/changelog/handler.go`
# — outside the population that sweep could see. `apps/web/src/aiRequestBodyRegister.test.ts` now
# derives the population from `json.Marshal(<Name>{` in apps/bff instead of from that file list.
#
# ⚠ WHAT A DRIFT COSTS HERE IS NOT A COMPLETION, IT IS A ROW. Measured by executing docs' own
# `changelog.Handler.Generate` at `8189d7b5`: `{"version":"v1.2.3","issue_ids":[]}` answers 201,
# performs ZERO Track lookups and writes a durable entry summarised "Generated from 0 issues" —
# and `…/changelog/entries/{id}/publish` pushes it to the workspace's public RSS feed. So a rename
# of `issue_ids` upstream does not error: the BFF's own empty-list refusal reads the BROWSER's key,
# not the wire's, and every generated entry silently becomes an empty release note.
cannot "the changelog generate route sends what talyvor-docs generateBody binds — a renamed issue_ids is a 201 that writes an empty, publishable release note rather than an error" \
    "talyvor-docs internal/changelog/handler.go" \
    "[ \"\$(sed -n '/^type generateBody struct/,/^}/p' internal/changelog/handler.go | grep -o 'json:\"[a-z_]*\"' | sed 's/json://;s/\"//g' | LC_ALL=C sort | tr '\n' ' ')\" = \"issue_ids version workspace_id \" ] && [ \"\$(sed -n '/^type generateBody struct/,/^}/p' internal/changelog/handler.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type generateBody struct/,/^}/p' internal/changelog/handler.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?generateBody\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/changelog | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-docs checkout; the WHOLE bind-tag set. workspace_id is bound upstream and DELIBERATELY not sent (Generate overwrites it from the page's context — measured), so it is declared UPSTREAM-BINDS-ONLY beside docsGenerateBody in docs_changelog.go (spelled without its directory ON PURPOSE: expirySubjects.test.ts reads every repo-relative path on a grep line as a path this command GREPS and demands a subject gate for it, and this command greps only the upstream file) and is part of the union this compares ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "the ask body the browser writes is what talyvor-docs Ask binds — the BFF forwards it verbatim, so api.ts#ask IS the wire; upstream refuses every other spelling with 400 today, and that refusal can be withdrawn upstream" \
    "talyvor-docs internal/ai/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Ask(/,/^}/p' internal/ai/handler.go | grep -o 'json:\"[a-z_]*\"' | sed 's/json://;s/\"//g' | LC_ALL=C sort | tr '\n' ' ')\" = \"question \" ]   # in a talyvor-docs checkout; the WHOLE bind-tag set, so an ADDED key, a REMOVED one or a RENAMED one are each a mismatch — and on this route a wrong key is a 200 with a billed completion, not an error"

# ── THE SAME CLASS AGAIN, ONE PARAMETER WIDE, AND IT IS THE WORST SHAPE OF IT ─
# DECISION: apps/bff's Docs search route (docs_search.go) refuses a mistyped `type` with 400,
#           refuses a two-source page past 50 rows with 400, EXEMPTS the single-source path from
#           that ceiling, and rebuilds the query from exactly five keys rather than forwarding it.
# PREMISE:  five separate facts about talyvor-docs' search handler — its merged-row ceiling, the
#           five keys it reads, the three values it discriminates on, what it does with a fourth,
#           and where it applies the offset.
#
# ⚠ A QUERY PARAMETER IS THE WORST CASE OF THIS WHOLE CLASS AND THAT IS WHY THESE ARE HERE. A
# response shape that drifts renders a blank field. A request BODY key that drifts is a 200 with a
# billed completion that read nothing (#234). A query PARAMETER that drifts is worse than both:
# `r.URL.Query().Get` returns "" for a renamed key, and Docs then DEFAULTS `type` to `all` — so a
# renamed `type` upstream means a `type=semantic` search silently stops asking for the semantic
# half, and the answer is a 200 of full-text rows BYTE-IDENTICAL to a correct one. Semantic page
# search is one of W1.7's eight AI features and its half embeds the query through Lens on every
# call, so this sits on a metered path as well as a silent one.
#
# ⚠ ALL FIVE RUN TRUE TODAY, WHICH IS WHY THEY ARE ENTRIES AND NOT A FIX. MEASURED BY EXECUTING
# docs' OWN search handler at 8189d7b5 — a `git archive` scratch export; that repo was held by
# another tab and was NEVER written to — over a recording full-text store, a recording pgxDB and an
# httptest stand-in for the Lens embeddings endpoint, so "which half ran" is an observation:
#   type=banana / ALL / Fulltext / full-text → 200 {"results":[],"total":0}, ft NOT called, 0 embeds
#   type absent / type=all                   → ft(10, 0) AND one embedding
#   type=fulltext&limit=5&offset=7           → ft(5, 7)          — the offset reached SQL
#   type=semantic&limit=5&offset=7           → pgvector LIMIT 5 OFFSET 7
#   type=all&limit=5&offset=7                → ft(12, 0)         — merged, offset applied after
#   type=all&limit=10&offset=45              → ft(50, 0)         — the 50-row window
#   type=fulltext&limit=10&offset=90         → ft(10, 90)        — single-source pages past it
# INSTRUMENT CONTROL, because "the sixth key was ignored" and "the recorder sees no key at all" are
# the same line: type=semantic&space_id=sp-1 puts a non-nil space in the pgvector $4, while
# space=sp-1 and spaceId=sp-1 leave it nil.
#
# ⚠ AND THE COMMANDS WERE RUN IN EVERY STATE BEFORE BEING WRITTEN DOWN — 14 caught, 2
# predicted-green, 0 anomalies (~/talyvor-queue/w171-docssearch-register-controls-4b7e.py), each
# mutation restored in a `finally` and sha256-verified back. The two vacuity cases are the ones that
# matter: with the Search FUNCTION renamed, and with the handler file EMPTIED, every one of these
# exits non-zero rather than confirming a premise it never looked at.
#
# ⚠ ONE MEASURED BOUNDARY, WRITTEN HERE RATHER THAN LEFT TO BE TRUSTED. The `type` dispatch entry
# pins the SHAPE of docs' two arms, so an upstream `else` branch that runs a half for an
# unrecognised type leaves both arms untouched and that command GREEN. Predicted green, measured
# green (control B1). It catches an arm being inverted or re-aimed; it does not catch a third arm.
#
# apps/web/src/docsSearchRegister.test.ts keeps the values in these commands equal to the values
# docs_search.go actually enforces, and derives the populations — the wire keys from the route's own
# `out.Set` calls, the discriminator from its type map, the window from its constant, and the
# behavioural half from every refusal constant it declares — so a sixth parameter, a fourth type or
# a third refusal cannot be added with nothing asking talyvor-docs about it.
cannot "the 50-row merged window is talyvor-docs' own maxFetchRows — the ceiling apps/bff's two-source refusal is written against, and the number two repos may not disagree on silently" \
    "talyvor-docs internal/search/handler.go" \
    "[ \"\$(grep -o 'maxFetchRows *= *[0-9]*' internal/search/handler.go | tr -s ' ' | LC_ALL=C sort -u | tr '\n' '|')\" = \"maxFetchRows = 50|\" ]   # in a talyvor-docs checkout; the WHOLE assignment, so a moved number and a renamed constant are each a mismatch — and an empty capture, which is what an absent file also produces, is the failure grep's own exit status cannot see"

cannot "docs' search handler reads EXACTLY q / type / space_id / limit / offset — the premise under rebuilding the query instead of forwarding it, because a parameter upstream IGNORES comes back looking honoured" \
    "talyvor-docs internal/search/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Search(/,/^}/p' internal/search/handler.go | grep -o 'URL.Query().Get(.[a-z_]*.)' | tr -d '\"' | LC_ALL=C sort -u | tr '\n' '|')\" = \"URL.Query().Get(limit)|URL.Query().Get(offset)|URL.Query().Get(q)|URL.Query().Get(space_id)|URL.Query().Get(type)|\" ]   # in a talyvor-docs checkout; the WHOLE key set, so a SIXTH key, a renamed one and a deleted one are each a mismatch. A renamed key is not an error upstream: Get returns \"\" and the handler DEFAULTS, which is a 200 that read something else"

cannot "docs' search discriminates on exactly all / fulltext / semantic, and treats an ABSENT type as all — the closed set apps/bff answers 400 for anything outside of, with the empty default deliberately left to upstream so there is only one author of it" \
    "talyvor-docs internal/search/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Search(/,/^}/p' internal/search/handler.go | grep -o 'kind == .[a-z]*.' | tr -d '\"' | LC_ALL=C sort -u | tr '\n' '|')\" = \"kind == |kind == all|kind == fulltext|kind == semantic|\" ]   # in a talyvor-docs checkout; the leading empty member IS the absent-type default and is part of the premise. A FOURTH value accepted upstream while this repo still refuses it is a search nobody can run; a value dropped upstream is one this repo forwards to be ignored"

cannot "docs' search REFUSES an unrecognised type with a 400 of its own, before either dispatch arm — the fact apps/bff's refusal SENTENCE now states, and the reason its own 400 is belt-and-braces rather than the only one" \
    "talyvor-docs internal/search/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Search(/,/^}/p' internal/search/handler.go | grep -o 'kind != .[a-z]*.' | tr -d '\"' | LC_ALL=C sort -u | tr '\n' '|')\" = \"kind != all|kind != fulltext|kind != semantic|\" ] && [ \"\$(sed -n '/^func (h \\*Handler) Search(/,/^}/p' internal/search/handler.go | grep -c 'http.StatusBadRequest')\" = 2 ]   # in a talyvor-docs checkout. ⚠ THIS COMMAND REPLACED ONE THAT ANSWERED YES ABOUT A PREMISE THAT HAD BECOME FALSE, WHICH IS THE FAILURE THIS REGISTER'S HEADER NAMES. The old premise was 'an unrecognised type runs NEITHER half and answers 200', and its command pinned the two dispatch ARMS verbatim. talyvor-docs d54d375 added a refusal ABOVE those arms and left them untouched, so the command still EXITED 0 and reported the premise holding while upstream had started refusing. A command must test the premise, not a proxy for it. Verified BOTH DIRECTIONS against real history in read-only git archive exports: at d54d375 the set is 'kind != all|kind != fulltext|kind != semantic|' and the 400 count is 2 (EXIT 0); at 48c8336, the commit before, the set is EMPTY and the count is 1 (EXIT 1). The empty extraction FAILS the comparison rather than passing it, so a deleted refusal or a renamed Search cannot score a pass"

cannot "docs' search puts the offset into SQL for a SINGLE source and zeroes it only when both halves run — the premise under apps/bff exempting type=fulltext and type=semantic from the 50-row refusal, so deep paging keeps working on one source" \
    "talyvor-docs internal/search/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Search(/,/^}/p' internal/search/handler.go | grep -o 'twoSources := kind == .[a-z]*.\\|sqlOffset := offset\\|sqlOffset = 0\\|window = offset + limit' | tr -d '\"' | tr '\n' '|')\" = \"twoSources := kind == all|sqlOffset := offset|sqlOffset = 0|window = offset + limit|\" ]   # in a talyvor-docs checkout; the whole dataflow in order. If sqlOffset ever starts at 0, single-source deep paging silently returns page 1 forever and the exemption becomes wrong. It pins WHERE the offset goes, not WHETHER the key is read — that is the key-set entry's question, measured (control E2c)"

# ⚠ THE FIVE ENTRIES ABOVE ARE ALL ABOUT THE REQUEST. THIS ONE IS ABOUT THE ANSWER, AND IT IS THE
# ONLY CROSS-REPO CLAIM ON THIS ROUTE THAT A MONEY SENTENCE RESTS ON. The four request-side premises
# decide what gets ASKED; `source` decides what the screen is allowed to SAY it was billed for.
# MEASURED, not reasoned about, by driving the shipped card at suite `567e6d6a` with the dual-match
# literal renamed (`both` -> `hybrid`, which is exactly what an upstream rename produces on the wire):
#   source "both"   -> semantic:"ran"     -> "Embedding the query WAS a metered Lens call billed to
#                                            this workspace under docs-search"
#   source "hybrid" -> semantic:"unknown" -> "WHERE LENS IS CONFIGURED, embedding the query is a
#                                            metered call … Only a row from the semantic index
#                                            proves it happened here"
# So one renamed literal converts a definite charge into a conditional, on a search the workspace WAS
# billed for — and the hedge it falls back to explains itself with "Docs merges an unconfigured
# semantic search in as an empty list", which is FALSE on that very response. The classifier reads
# only the two positive literals, so a rename can never FABRICATE evidence; it silently DELETES it,
# which is the direction no screen can detect.
# ⚠ AND NO TEST IN THIS REPO CAN SEE IT, BY CONSTRUCTION. Censused at 567e6d6a: the dual-match
# literal appears six times in apps/web — three in search.ts (the union and the two classifier arms)
# and three in fixtures authored HERE (search.test.ts x2, searchDocs.test.tsx x1). Both halves of
# every comparison live in this repository, so the fixtures go on passing with the old literal while
# production receives the new one. That is what makes it a register entry and not a test.
# ⚠ MEASURED AND CURRENTLY TRUE, so it is recorded rather than pinned as a sixth claim: the `both`
# tag is decided by `simScore > 0` on a map lookup that returns 0.0 for a MISS, so it would lose a
# dual match whose similarity were exactly 0 — upstream's `similarityThreshold = 0.75`
# (internal/search/semantic.go:38) means a returned row is always >= 0.75, so the condition is sound
# today. This entry pins the emitted SET, not that condition; a re-aimed condition is a different
# question and is not asked here.
cannot "docs' search tags a row both halves matched \`both\` and a semantic-only row \`semantic\` — the two literals apps/web/src/areas/docs/search.ts turns into the semantic-evidence sentence AND the metered-cost sentence, so a rename upstream does not merely lose a label, it RETRACTS a money claim on a search that was billed" \
    "talyvor-docs internal/search/handler.go" \
    "[ \"\$(sed -n '/^func merge(/,/^}/p' internal/search/handler.go | grep -o 'src :*= \"[a-z]*\"\\|Source: *\"[a-z]*\"' | grep -o '\"[a-z]*\"' | tr -d '\"' | LC_ALL=C sort -u | tr '\n' '|')\" = \"both|fulltext|semantic|\" ]   # in a talyvor-docs checkout; the WHOLE set merge() can emit, so a RENAMED literal, a dropped one and a FOURTH one are each a mismatch (measured: both->hybrid, semantic->vectoronly, fulltext->keyword, and a fourth arm — all caught; a reworded comment — green). The quotes are matched EXPLICITLY rather than with the \`.\` wildcard the entries above use: \`Source: *.[a-z]*.\` also matches the UNQUOTED \`Source: src,\` line in the same function and yielded a phantom \`src,\` member on a pristine tree. An empty capture, which is what a renamed merge() and an absent file both produce, is the failure grep's own exit status cannot see"

# ── THE SAME CLASS, IN THE MONEY-READ FILE, AND ONE DELIBERATE DIVERGENCE ────
# DECISION: apps/web/src/lib/api.ts declares TypeScript shapes for four talyvor-lens structs, and
#           every balance, ledger row and spend figure this console renders is typed off them.
# PREMISE:  each interface, plus the fields it declares it does not mirror and the one field it
#           declares it spells differently, is still the whole upstream struct.
#
# ⚠ THE MEASUREMENT THAT PUT THEM HERE IS A NEGATIVE ONE, WHICH IS WHY THE ENTRIES AND NOT A DIFF.
# The seven entries above were added because two mirror headers claimed VERBATIM and were missing
# fields. Sweeping the same class found this file, whose header made the same claim — and at lens
# a04310a, LXCSnapshot, LedgerEntry and LXCLedgerEntry match their Go structs field for field.
# Nothing to fix in the shapes; everything to fix in the fact that nothing was watching them.
#
# ⚠ AND THE ONE REAL DIVERGENCE IS DELIBERATE AND WAS BEING CARRIED BY A PARAGRAPH. LensBalance
# spells held_balance_ulens `?:` against a Go field with no omitempty, because a Lens older than
# the change that added it omits the key and `?? 0` at the read sites is a deployment-skew
# tolerance. That is correct. It was recorded as prose in the GUARD's header — a hand exclusion
# inside the instrument written to stop trusting prose — and it is declared in lib/api.ts now, so
# the command below still asks Lens about the struct Lens actually has.
cannot "LXCSnapshot mirrors talyvor-lens LXCSnapshot — the pegged-token balance the Overview and Spend screens read" \
    "talyvor-lens internal/economy/dualtoken.go" \
    "[ \"\$(sed -n '/^type LXCSnapshot struct/,/^}/p' internal/economy/dualtoken.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"balance_ulxc lifetime_minted_ulxc lifetime_spent_ulxc usd_value_uusd workspace_id \" ] && [ \"\$(sed -n '/^type LXCSnapshot struct/,/^}/p' internal/economy/dualtoken.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type LXCSnapshot struct/,/^}/p' internal/economy/dualtoken.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?LXCSnapshot\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/economy | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "LXCLedgerEntry mirrors talyvor-lens LXCLedgerEntry — the pegged-token ledger row every spend figure on those screens is summed from" \
    "talyvor-lens internal/economy/dualtoken.go" \
    "[ \"\$(sed -n '/^type LXCLedgerEntry struct/,/^}/p' internal/economy/dualtoken.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"amount_ulxc balance_after_ulxc created_at description id metadata type workspace_id \" ] && [ \"\$(sed -n '/^type LXCLedgerEntry struct/,/^}/p' internal/economy/dualtoken.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type LXCLedgerEntry struct/,/^}/p' internal/economy/dualtoken.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?LXCLedgerEntry\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/economy | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "LensBalance mirrors talyvor-lens BalanceSnapshot — the LENS balance, whose held_balance_ulens this repo spells optional ON PURPOSE (declared UPSTREAM-SPELLING; a Lens older than the change that added it omits the key)" \
    "talyvor-lens internal/mining/cache_mining.go" \
    "[ \"\$(sed -n '/^type BalanceSnapshot struct/,/^}/p' internal/mining/cache_mining.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"balance_ulens held_balance_ulens lifetime_earned_ulens lifetime_spent_ulens updated_at workspace_id \" ] && [ \"\$(sed -n '/^type BalanceSnapshot struct/,/^}/p' internal/mining/cache_mining.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type BalanceSnapshot struct/,/^}/p' internal/mining/cache_mining.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?BalanceSnapshot\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/mining | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "LedgerEntry mirrors talyvor-lens LedgerEntry — the LENS ledger row" \
    "talyvor-lens internal/mining/cache_mining.go" \
    "[ \"\$(sed -n '/^type LedgerEntry struct/,/^}/p' internal/mining/cache_mining.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"amount_ulens balance_after_ulens created_at description id metadata type workspace_id \" ] && [ \"\$(sed -n '/^type LedgerEntry struct/,/^}/p' internal/mining/cache_mining.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type LedgerEntry struct/,/^}/p' internal/mining/cache_mining.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?LedgerEntry\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/mining | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

# W4.6.1 step 7 — the earnings read. ⚠ THE FIELD THIS TYPE EXISTS TO REPLACE IS STILL SERVED:
# LensBalance.lifetime_earned_ulens is lifetime CREDITED (talyvor-lens #472 measured 27x on a
# five-row fixture, and unbounded across value-neutral stake/unstake round trips). So a mirror that
# silently loses contribution_settled_ulens would send the next screen back to the wrong field.
cannot "EarningsSummary mirrors talyvor-lens earnings.Summary — what a workspace has EARNED, as opposed to what it has been credited" \
    "talyvor-lens internal/earnings/reader.go" \
    "[ \"\$(sed -n '/^type Summary struct/,/^}/p' internal/earnings/reader.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"by_type capital_settled_ulens contribution_settled_ulens contribution_settled_usd_at_peg disabled_gates earning_enabled held_ulens held_usd_at_peg lens_per_usd revoked_ulens settled_ulens settled_usd_at_peg unclassified_types workspace_id \" ] && [ \"\$(sed -n '/^type Summary struct/,/^}/p' internal/earnings/reader.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type Summary struct/,/^}/p' internal/earnings/reader.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?Summary\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/earnings | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "EarningsTypeLine mirrors talyvor-lens earnings.TypeLine — one ledger type's line in the earnings breakdown, including the REASON it was counted that way" \
    "talyvor-lens internal/earnings/reader.go" \
    "[ \"\$(sed -n '/^type TypeLine struct/,/^}/p' internal/earnings/reader.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"amount_ulens class kind reason rows type \" ] && [ \"\$(sed -n '/^type TypeLine struct/,/^}/p' internal/earnings/reader.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type TypeLine struct/,/^}/p' internal/earnings/reader.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?TypeLine\) (Marshal|Unmarshal)JSON\(' --include='*.go' internal/earnings | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."


# ── THE THREE TRACK WRITE BODIES, AND WHY THEY ARE NOT ONE ENTRY ─────────────
# DECISION: apps/bff/track.go forwards three request bodies to talyvor-track VERBATIM — the
#           browser authors the keys and no Go struct in this repository names them, so
#           aiRequestBodyRegister.test.ts's `json.Marshal` census CANNOT see them by construction
#           and names them as a boundary. apps/web/src/trackWriteBodyRegister.test.ts derives the
#           population and each route's key set from source and requires the three entries below.
# PREMISE:  talyvor-track binds those six keys, AND the consequence of an upstream rename differs
#           by route.
#
# ⚠ ALL THREE DECODE THROUGH THE SAME HELPER AND THAT IS THE TRAP. `httpx.DecodeJSON` calls
# `dec.DisallowUnknownFields()`, which reads like "a renamed key is a 400 everywhere". It is not:
# encoding/json enforces that flag for STRUCT fields only. MEASURED with the flag toggled as its
# own control (struct+renamed, flag OFF → nil, so the struct result is the flag's doing and not
# the type's):
#
#     struct + {"headline":…}  flag ON  → json: unknown field "headline"   → 400 BAD_JSON
#     map    + {"state":…}     flag ON  → nil, map[state:x]                → the key sails through
#
# and `issue.Store.Update` then drops the unknown key WITHOUT A WORD (`continue`), runs no
# statement at all when nothing survives (`len(setClauses) == 0`), and returns the row unchanged:
# a 200 no caller can tell from a stored edit. Upstream has already paid for this once — the
# comment inside `updatableFields` records `PATCH {"milestone_id": …}` answering 200 with the
# field untouched. FOUR of this app's six keys are on that route.
#
# ⚠ THE TWO model.go COUNTS ARE FILE-WIDE ON PURPOSE, AND AN EXISTING GUARD IS WHY. The first
# draft scoped them with `sed -n '/^type Issue struct/,/^}/p'`, which is precise and which
# mirrorSubsetRegister.test.ts reads as a SECOND mirror entry for the same struct — its rule is
# exactly one `cannot` naming both `internal/model/model.go` and `type Issue struct`, and it went
# red on four assertions. The address is not needed: at 3672af1a `json:"title"` and `json:"body"`
# each occur EXACTLY ONCE in that file, so the count of 1 IS the block-scoped answer. If upstream
# grows a second `title` tag anywhere in model.go this reds — a false red that makes someone look,
# which is the direction to fail in.
#
# ⚠ THE ALLOWLIST COUNT IS BLOCK-SCOPED, AND ITS NEGATIVE CONTROL IS WHY: at 3672af1a
# `"assignee_id":` matches FOUR times in internal/issue/store.go (updatableFields AND
# issueRefQueries among them) and exactly ONCE inside the allowlist. A file-wide count would pass
# on a key that is only ever validated and never writable.
cannot "[POST /api/track/issues] sends {title} and Track binds it on a struct (createBody embeds model.Issue), so an upstream rename is a LOUD 400 BAD_JSON — the browser's createRefusal already surfaces it" \
    "talyvor-track internal/issue/handler.go + internal/model/model.go + internal/httpx/httpx.go" \
    "[ \"\$(grep -c 'var body createBody' internal/issue/handler.go)\" = 1 ] && [ \"\$(grep -c 'json:.title.' internal/model/model.go)\" = 1 ] && [ \"\$(grep -c 'DisallowUnknownFields' internal/httpx/httpx.go)\" = 1 ]   # in a talyvor-track checkout; the STRUCT destination is what makes the flag bite, so all three counts are the claim and any of them at 0 is the failure"

cannot "[PATCH /api/track/issues/{id}] sends {assignee_id,description,priority,status} and Track decodes into a map[string]any, so DisallowUnknownFields does NOT bite and a renamed or de-allowlisted key is a SILENT 200 with the row unchanged — the one route of the three whose failure this app cannot see" \
    "talyvor-track internal/issue/handler.go + internal/issue/store.go" \
    "[ \"\$(grep -c 'var updates map\[string\]any' internal/issue/handler.go)\" = 1 ] && [ \"\$(awk '/^var updatableFields = map\[string\]struct\{\}\{/,/^\}/' internal/issue/store.go | grep -c -E '^[[:space:]]+\"(status|description|priority|assignee_id)\":')\" = 4 ]   # in a talyvor-track checkout; the awk slice is the ALLOWLIST BLOCK alone — assignee_id matches 4x file-wide and a file-wide count would pass on a key that is validated but not writable"

cannot "[POST /api/track/issues/{id}/comments] sends {body} and Track binds it on a struct (model.Comment), so an upstream rename is a LOUD 400 BAD_JSON — author_id is UPSTREAM-BINDS-ONLY, resolved from the verified session member and ignored from the body (SEC-5)" \
    "talyvor-track internal/issue/handler.go + internal/model/model.go" \
    "[ \"\$(grep -c 'var in model.Comment' internal/issue/handler.go)\" = 1 ] && [ \"\$(grep -c 'json:.body.' internal/model/model.go)\" = 1 ] && [ \"\$(grep -c 'in.AuthorID = actorID' internal/issue/handler.go)\" = 1 ]   # in a talyvor-track checkout; the third count is the SEC-5 identity rule this app relies on by NOT sending author_id — if it stopped holding, an omitted key would become a forgeable one"

# ⚠ A PREMISE ABOUT MONEY THAT THIS REPO PRINTS ON SCREEN, WHICH IS WHY IT IS HERE RATHER THAN IN
# A COMMENT. SearchIssues.tsx tells the reader the charge appears in the Lens ledger under
# `track-search`; areas/track/meteredCostCensus.test.tsx asserts the card prints that literal.
# BOTH ends are in THIS repo, so both agree with each other for ever and NEITHER can see the tag
# Track actually sends. A rename upstream leaves this app confidently naming a ledger line that
# no longer exists — the failure is silent, and it is silent on the one Track surface whose spend
# is billed to the workspace rather than to an issue.
#
# ⚠ THE COUNT IS OF THE LIVE CALL LINE, NOT OF THE STRING — AND THE ANCHOR IS THERE BECAUSE THE
# FIRST DRAFT FAILED ITS OWN CONTROL. `"track-search"` appears exactly once in engine.go at
# bfc5574, so an unanchored count looked sufficient; run against a scratch export in which the
# call was renamed and the OLD line left above it as a comment, the unanchored form still
# answered 1. It would have reported a premise it never looked at — the exact failure this
# helper's own header describes. Anchoring to the start of the line drops a commented copy,
# MEASURED: live 1, renamed 0, renamed-with-the-old-line-commented-out 0.
cannot "[GET /api/track/issues/search] SearchIssues.tsx prints \`track-search\` as the ledger tag the workspace's search spend appears under, and the census pins that literal — the tag is set upstream from callEmbeddingsViaLens's featureID argument (X-Talyvor-Feature, engine.go:263) and a rename there makes this app's only workspace-billed cost note name a ledger line that does not exist" \
    "talyvor-track internal/ai/engine.go" \
    "[ \"\$(grep -cE '^[[:space:]]+vec, err := e\\.callEmbeddingsViaLens\\(ctx, workspaceID, \"track-search\", query\\)\$' internal/ai/engine.go)\" = 1 ]   # in a talyvor-track checkout; anchored to the LIVE call line — measured against a scratch export, the unanchored form still answered 1 with the call renamed and the old line left as a comment above it"


# ── THE SIX REQUEST BODIES THIS BFF SENDS talyvor-lens ───────────────────────
#
# The sibling block above asks talyvor-docs and talyvor-track about the bodies this repo builds
# from a NAMED Go struct. These six are anonymous maps and struct literals — json.Marshal(
# map[string]int64{"usd_cents": …}) and friends — which is why aiRequestBodyRegister.test.ts's
# census could only put them in a bucket and count them. An anonymous literal is not a lesser
# claim about another repository; it is the same claim with nowhere to hang a test.
#
# ⚠ NOT ONE OF THE SIX LENS HANDLERS CALLS DisallowUnknownFields. That is the fact the whole
# block rests on and it was MEASURED, not assumed: a renamed key upstream is indistinguishable
# from an absent one, the field takes its ZERO VALUE, and the decode reports success. So the
# question is never "is it an error" — it is "what does the zero value DO", and that was answered
# by executing Lens's own code at f09348d1 in a read-only git archive export (the repo was held
# by another tab and was NEVER written to): the real newProvisionHandler over fakes for its two
# interfaces, and the real downstream validators for the five mounted as closures in main.go.
#
# ⚠⚠ THE MONEY ROUTES FAIL LOUD AND THE CONSENT ROUTES FAIL SILENT. Both amounts are refused by
# an upstream allow-list or minimum, so a renamed usd_cents or lxc_amount_ulxc is a 400 someone
# sees. Every route that records a CHOICE — pooling consent, distill policy, session lifetime —
# answers 200 and stores something else. That is the opposite of where the attention has gone,
# and it is why these six are one block rather than six scattered lines.
#
# The full nine-case verdict table is in apps/web/src/lensRequestBodyRegister.test.ts, which also
# holds each entry below to the key set this repo actually sends. CI here checks out this
# repository alone, so these commands are the only thing that asks Lens.

cannot "[POST /v1/workspaces/{wsID}/billing/checkout] apps/bff/billing.go sends {usd_cents} and Lens binds it on a plain decoder with NO DisallowUnknownFields, so a renamed key is an ACCEPTED zero — LOUD only because 0 is off billing.AllowedTopUpCents() ([1000 5000 10000]) and yields ErrAmountNotAllowed. The refusal is upstream's allow-list, not a decode error, and shortening that list to include 0 would make this route silent" \
    "talyvor-lens cmd/lens/main.go" \
    "[ \"\$(grep -A12 -F 'bill.post(authed, \"/v1/workspaces/{wsID}/billing/checkout\", func' cmd/lens/main.go | sed '/NewDecoder/q' | grep -oE 'json:\"[a-z_]+' | sed 's/json:\"//' | sort -u | tr '\\n' ' ' | sed 's/ \$//')\" = \"usd_cents\" ]   # in a talyvor-lens checkout; the window is BOUNDED at the decoder line so a short struct cannot borrow the next handler's tags, and a missing anchor yields the EMPTY set — which fails this comparison rather than passing it. 30/30 controls red (~/talyvor-queue/w171-lens-register-controls-9f2c.py): key renamed, key added, key deleted, the route mount renamed, and the file emptied, for each of the six"

cannot "[POST /v1/workspaces/{wsID}/lxc/convert] apps/bff/convert.go sends {lxc_amount_ulxc} and a renamed key reaches ConvertLENStoLXC as 0, refused by the 100000 uLXC minimum before the rate engine or the database is touched — LOUD, and again by a downstream minimum rather than by the decoder" \
    "talyvor-lens cmd/lens/main.go" \
    "[ \"\$(grep -A12 -F 'econ.post(authed, \"/v1/workspaces/{wsID}/lxc/convert\", func' cmd/lens/main.go | sed '/NewDecoder/q' | grep -oE 'json:\"[a-z_]+' | sed 's/json:\"//' | sort -u | tr '\\n' ' ' | sed 's/ \$//')\" = \"lxc_amount_ulxc\" ]   # in a talyvor-lens checkout; the window is BOUNDED at the decoder line so a short struct cannot borrow the next handler's tags, and a missing anchor yields the EMPTY set — which fails this comparison rather than passing it. 30/30 controls red (~/talyvor-queue/w171-lens-register-controls-9f2c.py): key renamed, key added, key deleted, the route mount renamed, and the file emptied, for each of the six"

cannot "[POST /v1/workspaces/{wsID}/api-keys] apps/bff/keys.go sends {name,scopes,expires_at} and the two that matter fail in OPPOSITE directions — a renamed scopes is LOUD because tenant.ValidateScopes refuses an empty list AT ISSUANCE, which is load-bearing: auth.RequireScope grandfathers len(Scopes)==0 into passing every scope check, so that refusal is the only thing between this rename and a console-minted key that satisfies the proxy gate spending the workspace credit. A renamed name is SILENT — CreateAPIKey stores an empty name and the blank-name refusal is the BFF's own, so an upstream rename is the ONLY way to reach that arm" \
    "talyvor-lens cmd/lens/main.go" \
    "[ \"\$(grep -A12 -F 'authed.Post(\"/v1/workspaces/{wsID}/api-keys\", func' cmd/lens/main.go | sed '/NewDecoder/q' | grep -oE 'json:\"[a-z_]+' | sed 's/json:\"//' | sort -u | tr '\\n' ' ' | sed 's/ \$//')\" = \"expires_at name scopes\" ]   # in a talyvor-lens checkout; the window is BOUNDED at the decoder line so a short struct cannot borrow the next handler's tags, and a missing anchor yields the EMPTY set — which fails this comparison rather than passing it. 30/30 controls red (~/talyvor-queue/w171-lens-register-controls-9f2c.py): key renamed, key added, key deleted, the route mount renamed, and the file emptied, for each of the six"

cannot "[POST /v1/provision] apps/bff/tenant.go sends {identity,display_name,cache_poolable,ttl_hours} and a renamed ttl_hours is SILENT ON A CREDENTIAL LIFETIME — auth.ClampTTL(0) returns DefaultTokenTTL 24h, so the session JWT this repo asks to keep short at 8h lives three times as long, and the BFF cannot see it because expires_at is computed from the TTL Lens actually applied. A renamed cache_poolable reaches Lens as SILENCE so the new-workspace default replaces the person's choice; identity is the LOUD one, 400. display_name is declared with omitempty and never assigned, so it is never on the wire — the tag is still this repo asserting Lens binds that name" \
    "talyvor-lens cmd/lens/provision_handler.go" \
    "[ \"\$(awk '/^type provisionRequest struct/,/^}/' cmd/lens/provision_handler.go | grep -oE 'json:\"[a-z_]+' | sed 's/json:\"//' | sort -u | tr '\\n' ' ' | sed 's/ \$//')\" = \"cache_poolable display_name identity ttl_hours\" ] && [ \"\$(sed -n '/^type provisionRequest struct/,/^}/p' cmd/lens/provision_handler.go | grep -cE '^[[:space:]]+[A-Za-z_]')\" = \"\$(sed -n '/^type provisionRequest struct/,/^}/p' cmd/lens/provision_handler.go | grep -c 'json:')\" ] && [ \"\$(grep -rlE 'func \([A-Za-z_]+ \*?provisionRequest\) (Marshal|Unmarshal)JSON\(' --include='*.go' cmd/lens | wc -l | tr -d ' ')\" = 0 ]   # in a talyvor-lens checkout; the window is BOUNDED at the decoder line so a short struct cannot borrow the next handler's tags, and a missing anchor yields the EMPTY set — which fails this comparison rather than passing it. 30/30 controls red (~/talyvor-queue/w171-lens-register-controls-9f2c.py): key renamed, key added, key deleted, the route mount renamed, and the file emptied, for each of the six ⚠ AND TWO CLAUSES SAY THE DECLARATION IS STILL THE WIRE, not merely that the tags did not move — see the WIRE-VERSUS-DECLARATION note above this block for what each one refuses and what was measured."

cannot "[PUT /v1/workspaces/{wsID}/distill] apps/bff/distill.go sends {distill_policy} and a rename is SILENT WITH THE FAIL-SAFE AIMED AT THE WRONG SHAPE — normalizeDistillPolicy resolves garbage to DistillDisabled under a comment saying a misconfiguration never silently distills, but a renamed key produces the EMPTY value, which has its own arm: DefaultDistillPolicy, and that is DistillAlways. Measured end to end, a workspace whose owner chose disabled was recorded always, 200" \
    "talyvor-lens cmd/lens/main.go" \
    "[ \"\$(grep -A12 -F 'authed.Put(\"/v1/workspaces/{wsID}/distill\", func' cmd/lens/main.go | sed '/NewDecoder/q' | grep -oE 'json:\"[a-z_]+' | sed 's/json:\"//' | sort -u | tr '\\n' ' ' | sed 's/ \$//')\" = \"distill_policy\" ]   # in a talyvor-lens checkout; the window is BOUNDED at the decoder line so a short struct cannot borrow the next handler's tags, and a missing anchor yields the EMPTY set — which fails this comparison rather than passing it. 30/30 controls red (~/talyvor-queue/w171-lens-register-controls-9f2c.py): key renamed, key added, key deleted, the route mount renamed, and the file emptied, for each of the six"

cannot "[PUT /v1/workspaces/{wsID}/cache-poolable] apps/bff/tenant.go sends {cache_poolable} and Lens binds a plain bool, so a renamed key is false and a workspace that opted IN is recorded opted OUT with a 200 — the privacy-preserving direction, which is exactly why it is written down: a consent that can be withdrawn by an upstream rename with no error anywhere is not being recorded" \
    "talyvor-lens cmd/lens/main.go" \
    "[ \"\$(grep -A12 -F 'authed.Put(\"/v1/workspaces/{wsID}/cache-poolable\", func' cmd/lens/main.go | sed '/NewDecoder/q' | grep -oE 'json:\"[a-z_]+' | sed 's/json:\"//' | sort -u | tr '\\n' ' ' | sed 's/ \$//')\" = \"cache_poolable\" ]   # in a talyvor-lens checkout; the window is BOUNDED at the decoder line so a short struct cannot borrow the next handler's tags, and a missing anchor yields the EMPTY set — which fails this comparison rather than passing it. 30/30 controls red (~/talyvor-queue/w171-lens-register-controls-9f2c.py): key renamed, key added, key deleted, the route mount renamed, and the file emptied, for each of the six"

# ── THE METERED-SURFACE UPSTREAM COLUMN (W1.7.1, tab-p9r4) ───────────────────
# Both metered censuses carry an `upstream` field per surface — the call site in the other repo
# that makes that surface cost money — and both headers present it as holding the STALE
# direction: "an entry names the upstream call site that makes it metered. If a surface stops
# spending, its row must be DELETED rather than left passing."
#
# ⚠ THE ONLY ASSERTION ON THAT COLUMN IS `toMatch(/^internal\//)`, WHICH IS A SHAPE. Nothing
# asked either repo anything, and it showed: measured read-only at docs 48c8336 / track b2f282e,
# TWO of the nine pointers name a function that upstream does not declare — the Docs census wrote
# `Engine.Ask` where talyvor-docs declares `AskDocs`, and the Track census wrote `Engine.Triage`
# where talyvor-track declares `TriageIssue`. Both were wrong at the SHA each census pins, not
# drifted since. The line numbers, checked the same way, are all correct — they point at the
# `callAnthropicViaLens` CALL lines, which is what those tables' arrows say and is NOT the `func`
# line a first reading assumes.
#
# These two entries are what a deployer can run to settle the column. Both were verified by
# EXECUTING them against read-only `git archive` exports, and armed seven ways: every declared
# subject emptied AND deleted (3/3 pairs red), and six real premise moves red — including the two
# renames the suite currently mis-writes, which is the direct evidence these entries would have
# caught what a shape check could not.
cannot "the four Docs AI surfaces still bill under the tags their cards print, and the Ask engine is still declared under the name the census names (what makes areas/docs/meteredCostCensus.test.tsx's upstream column a fact rather than a shape)" \
    "talyvor-docs internal/ai/engine.go, internal/search/semantic.go" \
    "[ \"\$(grep -oE '\"docs-ai-(ask|summarize|title|translate)\"' internal/ai/engine.go | sort -u | tr '\\n' ' ' | sed 's/ \$//')\" = '\"docs-ai-ask\" \"docs-ai-summarize\" \"docs-ai-title\" \"docs-ai-translate\"' ] && [ \"\$(grep -cE '^func \\(e \\*Engine\\) (AskDocs|Summarize|Translate|SuggestTitle)\\(' internal/ai/engine.go)\" = 4 ] && [ \"\$(grep -c 'X-Talyvor-Feature\", \"docs-search\"' internal/search/semantic.go)\" = 1 ] && [ \"\$(grep -c 'func (s \*SemanticSearch) embed(' internal/search/semantic.go)\" = 1 ]   # in a talyvor-docs checkout. Extraction, not exit status: the tag SET is compared, so a fifth tag or a renamed one both red. Verified at 48c8336 — and both renames the suite currently mis-writes (Engine.Ask, Engine.Triage) red their half."

cannot "the three issue-attributed Track AI surfaces still pass the ISSUE as the Lens feature tag and search still passes the static track-search (what makes the payer column in areas/track/meteredCostCensus.test.tsx true — the first three charge a ticket, the fourth charges the workspace)" \
    "talyvor-track internal/ai/engine.go" \
    "[ \"\$(grep -cE '^func \\(e \\*Engine\\) (TriageIssue|FindDuplicates|SummarizeThread|SemanticSearch)\\(' internal/ai/engine.go)\" = 4 ] && [ \"\$(grep -c 'callAnthropicViaLens(ctx, issue.WorkspaceID, issue.Identifier,' internal/ai/engine.go)\" = 3 ] && [ \"\$(grep -c 'callEmbeddingsViaLens(ctx, workspaceID, \"track-search\", query)' internal/ai/engine.go)\" = 1 ]   # in a talyvor-track checkout. Counts compared, never grep -c's own status: 3 is the three issue-attributed calls and a drop to 2 is a surface that stopped paying by issue. Verified at b2f282e."

# ── D10 ──────────────────────────────────────────────────────────────────────
# DECISION: apps/web/src/meteredSurfacePopulation.test.ts leaves areas/chat OUT of the metered
#           surface population, so no census counts it and no metered rule is written for it.
# PREMISE:  three talyvor-lens facts, all of them flags or branches rather than impossibilities.
#
# ⚠ THIS IS THE FIRST ENTRY IN THIS REGISTER FOR THE CHAT SEAM, AND THAT IS THE FINDING RATHER
#   THAN A TIDY-UP. Measured at d2f11a3: a grep across all 48 uncheckable entries for
#   session-key / SESSION_KEYS / tlv_sk_ / LXCShadow / shadowSpend / agentKeyID returned ZERO.
#   R8 in settleCommands.test.ts is the rule that exists for exactly this and it iterates the
#   `upstream:` fields of census ROWS — an excluded area has no row, so the obligation never
#   attached. An inclusion whose premise decays gets a wrong NUMBER; an exclusion whose premise
#   decays gets a surface nobody counts, while every census that says "all nine" keeps saying nine.
cannot "areas/chat is EXCLUDED from the metered surface population — a session-key request moves NO LXC in the DEFAULT configuration, which is the whole reason that screen shows a catalog LIST PRICE and claims no bill (R9 in apps/web/src/settleCommands.test.ts joins the exclusion to this entry)" \
    "talyvor-lens internal/proxy/shadow_lxc.go, internal/proxy/agent_allocator.go, internal/config/config.go, internal/auth/manager.go" \
    "[ \"\$(go test ./internal/config/ -run 'TestLoad_SessionKeysAreOffByDefault|TestLoad_LXCShadowSpendEnabledDefaultsOffAndParses' -v 2>&1 | grep -cE '^--- PASS: (TestLoad_SessionKeysAreOffByDefault|TestLoad_LXCShadowSpendEnabledDefaultsOffAndParses) ')\" = 2 ] && [ \"\$(grep -c 'func (p \*Proxy) shadowSpendLXC(' internal/proxy/shadow_lxc.go)\" = 1 ] && [ \"\$(grep -rcE '\.(SpendLXCForAgent|ReserveLXCForAgent|SettleLXCReservation|SpendLXC)\(' --include='*.go' --exclude='*_test.go' internal/proxy | grep -v ':0\$' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ \$//')\" = 'internal/proxy/agent_allocator.go:4 internal/proxy/shadow_lxc.go:1' ] && [ \"\$(grep -rhoE 'APIKeyID: *[A-Za-z0-9_.]+' --include='*.go' --exclude='*_test.go' internal/auth | sed 's/APIKeyID: *//' | LC_ALL=C sort -u | tr '\n' ' ' | sed 's/ \$//')\" = 'key.ID' ]   # NEEDS NO DATABASE — and that is MEASURED, not assumed: the two tests in the first clause live in internal/config and parse environment variables, and both were RUN to PASS in a git archive export with no LENS_TEST_DATABASE_URL set at all. In a talyvor-lens checkout, and every clause was RUN against that read-only export at 1bddd21. The FIRST clause's anchor is a trailing SPACE and not \$: go prints '--- PASS: Name (0.00s)', so the \$ form this was first written with counted ZERO against two PASSING tests and the entry cried wolf on a healthy premise. Only running it showed that — including its negative direction, which is what the third clause exists to record: the first version compared the SET of mover names (sort -u) and ADDING A CALL SITE OF AN EXISTING MOVER DID NOT CHANGE IT, so it could not say no to the one change that matters. Counts per file, not a set of names. The second clause declares the symbol R9 joins on. The FIRST clause is the --- PASS: shape rather than a bare go test for a reason measured here too: TestSessionKey_AuthenticatesWithExactlyTheProxyScope holds the APIKeyID assertion and SKIPS without Postgres, and a bare \`go test\` exits 0 on that skip — so the source extraction in the fourth clause carries that half instead."

# ── D9 ───────────────────────────────────────────────────────────────────────
# DECISION: a missing bundle file 404s instead of answering 200 with index.html, so the deploy
#           checks in README.md §6 and FULL-STACK-DEPLOY.md can read a STATUS CODE for
#           /assets/… and /version.json.
# PREMISE:  the BFF excludes exactly `/assets/` from the SPA fallback (apps/bff/lens.go,
#           bundleAssetsDir), and the web build still emits its files THERE — Vite's default
#           assetsDir, which apps/web/vite.config.ts does not override.
#
# ⚠ THE TWO HALVES ARE IN DIFFERENT LANGUAGES IN DIFFERENT DIRECTORIES AND NEITHER CAN SEE THE
#   OTHER. A Go test proves the BFF refuses `/assets/…`; nothing in it can observe where Vite
#   writes. Set `build: { assetsDir: 'static' }` and every check in both runbooks silently goes
#   back to reading a 200 that means nothing — with the BFF's test suite fully green, because
#   its fixture writes its own assets/ directory.
#
# ⚠ THE FIRST DRAFT OF THIS CHECK GREPPED THE WHOLE FILE FOR `assetsDir` AND VOIDED IMMEDIATELY —
#   on the COMMENT that was added in the same change to warn against setting it. A guard that
#   cannot tell a mention from a setting reports the documentation as the defect. Comment lines
#   are stripped first, and the two directions are controlled: adding `assetsDir: 'static'` to
#   vite.config.ts voids this, and the warning prose alone does not.
#
# ⚠⚠ THE VITE HALF WAS `grep -v … | grep -qE …` AND WOULD HAVE FAILED TOWARD "FINE" IN EXACTLY
#   THE STATE IT EXISTS TO DETECT. Under this script's `-o pipefail`, GNU grep's `-q` exits on
#   the first match and the upstream `grep -v` dies of SIGPIPE, so the pipeline is 141 — non-zero
#   — and `|| _d9_vite=1` fires: "vite still writes there (default assetsDir)" ABOUT A FILE THAT
#   SETS assetsDir. Measured 2026-08-28 in debian:bookworm-slim: D7's identical shape on
#   apps/bff/auth.go returns 141 (10.8 KB still to write after the match), this one on
#   vite.config.ts returns 0 (2 KB to write — the writer finishes first). SO IT IS SAFE ONLY BY
#   THE SIZE OF THE FILE, AND FILES GROW. Counted instead, which reads to EOF. A count that is
#   not a number is -1 and voids, the way D3's already does.
#
# ⚠ THE VITE HALF IS AN ABSENCE TEST. `_d9_vite=1` means "assetsDir is NOT set", which is what a
# missing vite.config.ts also looks like: measured, D9 printed `ok` — "vite still writes there
# (default assetsDir)" — about a build configuration that was not on disk. The BFF half is a
# POSITIVE match and would void on its own, so gating it changes no verdict; it is gated anyway
# so the RULE is uniform — every literal path this file greps is asserted present first — and
# because "lens.go is not there" is a better thing to tell a deployer than "lens.go no longer
# pins bundleAssetsDir".
_d9_read=0
subject apps/bff/lens.go "a missing bundle file 404s, so a deploy check may read its status code" || _d9_read=1
subject apps/web/vite.config.ts "a missing bundle file 404s, so a deploy check may read its status code" || _d9_read=1
# BOTH are asked, and neither short-circuits the other: with both files gone a deployer should
# be told both anchors moved, not the first one this file happens to name.
if [ "${_d9_read}" = 0 ]; then
_d9_bff=0
_d9_vite=0
grep -qE '^const bundleAssetsDir = "assets"$' apps/bff/lens.go 2>/dev/null && _d9_bff=1
_d9_assets=$(grep -vE '^\s*(//|/\*|\*)' apps/web/vite.config.ts 2>/dev/null | grep -cE '\bassetsDir\b')
case "${_d9_assets}" in '' | *[!0-9]*) _d9_assets=-1 ;; esac
[ "${_d9_assets}" = 0 ] && _d9_vite=1
if [ "${_d9_bff}" = 1 ] && [ "${_d9_vite}" = 1 ]; then
    ok "the BFF excludes /assets/ from the SPA fallback and vite still writes there (default assetsDir)"
else
    void "a missing bundle file 404s, so a deploy check may read its status code" \
        "deploy/README.md §6 and deploy/FULL-STACK-DEPLOY.md §Reading verification output" \
        "$( [ "${_d9_bff}" = 1 ] || echo 'apps/bff/lens.go no longer pins bundleAssetsDir = "assets". ' )$( [ "${_d9_vite}" = 1 ] || echo 'apps/web/vite.config.ts now sets assetsDir, so the build writes outside the directory the BFF refuses. ' )A missing asset answers 200 with index.html again and every status-code check in both runbooks passes against a white screen."
fi
fi

# ── verdict ──────────────────────────────────────────────────────────────────
echo
printf 'checked here: %d   stale: %d   uncheckable here: %d\n' "${checked}" "${stale}" "${uncheckable}"
if [ "${stale}" -gt 0 ]; then
    echo
    echo "One or more deploy decisions rest on a premise that has moved."
    echo "Fix the document sections named above — do not silence this script."
    exit 1
fi
echo "All locally-checkable premises still hold."
echo "⚠ The UNCHECKABLE ones are NOT passes. They are the set where 'someone will notice' is"
echo "  still doing the work; run their commands in the named repo before a deploy."
exit 0
