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
if subject apps/web/vite.config.ts "version comparison replaces the bundle content grep"; then
    if ! grep -q 'stampBuild' apps/web/vite.config.ts 2>/dev/null; then
        void "version comparison replaces the bundle content grep" \
            "deploy/FULL-STACK-DEPLOY.md § 'STEP 6d'" \
            "the stamping plugin is gone from vite.config.ts, so dist/version.json is not emitted and every version-based check silently reads nothing."
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
        grep -qF 'a.nudgeDocsMemberSync(' "$_f" 2>/dev/null && _d7_code=1
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
    "grep -q \"source = 'track'\" internal/membership/store.go   # in a talyvor-docs checkout"

cannot "Track answers 200+[] for an unknown workspace and has no 404 branch on /v1/service/members (why an unknown id cannot error the sync)" \
    "talyvor-track internal/member/handler.go" \
    "go test ./internal/member/ -run TestServiceMembers_NonExistentWorkspace_EmptyAndAudited -v 2>&1 | grep -q '^--- PASS: TestServiceMembers_NonExistentWorkspace_EmptyAndAudited'   # in a talyvor-track checkout, against its test Postgres; that test asserts the 200 AND the [] body"

cannot "Docs enumerates workspaces from Track, not from its own content (the whole basis for deleting the seed)" \
    "talyvor-docs internal/trackintegration/enumerate.go" \
    "go test ./internal/trackintegration/ -run TestSyncMembers_ReachesAWorkspaceWithNoContent -v 2>&1 | grep -q '^--- PASS: TestSyncMembers_ReachesAWorkspaceWithNoContent'"

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
    "[ \"\$(go test ./internal/ai/ -run '^TestAttribution_(EachSinglePageOperationBindsItsPage|AskSpansPagesAndBindsNothing)\$' -v 2>&1 | grep -c -E '^--- PASS: TestAttribution_(EachSinglePageOperationBindsItsPage|AskSpansPagesAndBindsNothing) ')\" = 2 ]   # in a talyvor-docs checkout; BOTH halves — attribution exists AND ask/search bind nothing — anchored at both ends because the prefix form counted a RENAMED test and reported the premise confirmed, and a count of 0, which is also what a deleted test produces, is the failure neither go test's nor grep -c's exit status can see"

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
    "[ \"\$(go test ./internal/trackintegration/ -run 'TestServiceRoute' -v 2>&1 | grep -c '^--- PASS: TestServiceRoute')\" = 2 ]   # BOTH halves: accepts the BFF's exact request, AND still refuses without the proof — one passing is not the premise"

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
cannot "TrackWorkspace mirrors talyvor-track Workspace — the workspace row the console renders from the ONE Track route the BFF proxies today" \
    "talyvor-track internal/model/model.go" \
    "[ \"\$(sed -n '/^type Workspace struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"created_at id logo_url name plan slug updated_at \" ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "TrackIssue mirrors talyvor-track Issue — the issue shape the list and detail screens read, and the one this subset was measured short on (labels and sort_order are on every response)" \
    "talyvor-track internal/model/model.go" \
    "[ \"\$(sed -n '/^type Issue struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"ai_cost_usd ai_tokens assignee_id,omitempty completed_at,omitempty created_at creator_id cycle_id,omitempty description due_date,omitempty field_values,omitempty ice_score,omitempty id identifier is_blocked,omitempty labels lens_feature milestone_id,omitempty number parent_id,omitempty priority project_id,omitempty relations,omitempty rice_score,omitempty sort_order status team_id time_tracked_sec,omitempty title updated_at workspace_id \" ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "TrackComment mirrors talyvor-track Comment — the comment thread shape" \
    "talyvor-track internal/model/model.go" \
    "[ \"\$(sed -n '/^type Comment struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"author_id body created_at edited_at,omitempty id issue_id updated_at \" ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "TrackTeam mirrors talyvor-track Team — the team shape behind the identifier this UI renders" \
    "talyvor-track internal/model/model.go" \
    "[ \"\$(sed -n '/^type Team struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"color created_at icon id identifier name updated_at workspace_id \" ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "TrackMember mirrors talyvor-track memberView — the assignee-picker projection, mirrored twice in this repo (areas/track/types.ts and areas/lens/Members.tsx)" \
    "talyvor-track internal/member/mgmt_handler.go" \
    "[ \"\$(sed -n '/^type memberView struct/,/^}/p' internal/member/mgmt_handler.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"avatar_url email id name role \" ]   # in a talyvor-track checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "DocsSpace mirrors talyvor-docs Space — the space row SpaceList renders from the one live Docs read" \
    "talyvor-docs internal/model/model.go" \
    "[ \"\$(sed -n '/^type Space struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"color created_at created_by description icon id name private slug updated_at workspace_id \" ]   # in a talyvor-docs checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "DocsPage mirrors talyvor-docs Page — the page shape the tree and reader read, and the one that grew own_ai_cost_usd / total_ai_cost_usd while this repo said it mirrored the struct whole" \
    "talyvor-docs internal/model/model.go" \
    "[ \"\$(sed -n '/^type Page struct/,/^}/p' internal/model/model.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"ai_cost_usd content content_text cover_url created_at created_by depth doc_status,omitempty icon id is_template last_verified_at,omitempty last_viewed_at,omitempty linked_issues,omitempty locked locked_at,omitempty locked_by,omitempty own_ai_cost_usd page_type,omitempty parent_id,omitempty position slug space_id stale_after_days title total_ai_cost_usd updated_at updated_by verified_by,omitempty view_count workspace_id \" ]   # in a talyvor-docs checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

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
    "[ \"\$(sed -n '/^type generateBody struct/,/^}/p' internal/changelog/handler.go | grep -o 'json:\"[a-z_]*\"' | sed 's/json://;s/\"//g' | LC_ALL=C sort | tr '\n' ' ')\" = \"issue_ids version workspace_id \" ]   # in a talyvor-docs checkout; the WHOLE bind-tag set. workspace_id is bound upstream and DELIBERATELY not sent (Generate overwrites it from the page's context — measured), so it is declared UPSTREAM-BINDS-ONLY beside docsGenerateBody in docs_changelog.go (spelled without its directory ON PURPOSE: expirySubjects.test.ts reads every repo-relative path on a grep line as a path this command GREPS and demands a subject gate for it, and this command greps only the upstream file) and is part of the union this compares"

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

cannot "an unrecognised type runs NEITHER half of docs' search and answers 200 with an empty list — the fact apps/bff's own 400 exists because of, since upstream cannot tell a mistyped type from a workspace with no matching documents" \
    "talyvor-docs internal/search/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Search(/,/^}/p' internal/search/handler.go | grep -o 'if kind == .[a-z]*. || kind == .[a-z]*. {' | tr -d '\"' | tr '\n' '|')\" = \"if kind == all || kind == fulltext {|if kind == all || kind == semantic {|\" ]   # in a talyvor-docs checkout; BOTH dispatch arms verbatim and in order, so an arm inverted to a negation or re-aimed at another value is a mismatch. MEASURED BOUNDARY: a THIRD branch added elsewhere leaves both arms untouched and this command green"

cannot "docs' search puts the offset into SQL for a SINGLE source and zeroes it only when both halves run — the premise under apps/bff exempting type=fulltext and type=semantic from the 50-row refusal, so deep paging keeps working on one source" \
    "talyvor-docs internal/search/handler.go" \
    "[ \"\$(sed -n '/^func (h \\*Handler) Search(/,/^}/p' internal/search/handler.go | grep -o 'twoSources := kind == .[a-z]*.\\|sqlOffset := offset\\|sqlOffset = 0\\|window = offset + limit' | tr -d '\"' | tr '\n' '|')\" = \"twoSources := kind == all|sqlOffset := offset|sqlOffset = 0|window = offset + limit|\" ]   # in a talyvor-docs checkout; the whole dataflow in order. If sqlOffset ever starts at 0, single-source deep paging silently returns page 1 forever and the exemption becomes wrong. It pins WHERE the offset goes, not WHETHER the key is read — that is the key-set entry's question, measured (control E2c)"

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
    "[ \"\$(sed -n '/^type LXCSnapshot struct/,/^}/p' internal/economy/dualtoken.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"balance_ulxc lifetime_minted_ulxc lifetime_spent_ulxc usd_value_uusd workspace_id \" ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "LXCLedgerEntry mirrors talyvor-lens LXCLedgerEntry — the pegged-token ledger row every spend figure on those screens is summed from" \
    "talyvor-lens internal/economy/dualtoken.go" \
    "[ \"\$(sed -n '/^type LXCLedgerEntry struct/,/^}/p' internal/economy/dualtoken.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"amount_ulxc balance_after_ulxc created_at description id metadata type workspace_id \" ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "LensBalance mirrors talyvor-lens BalanceSnapshot — the LENS balance, whose held_balance_ulens this repo spells optional ON PURPOSE (declared UPSTREAM-SPELLING; a Lens older than the change that added it omits the key)" \
    "talyvor-lens internal/mining/cache_mining.go" \
    "[ \"\$(sed -n '/^type BalanceSnapshot struct/,/^}/p' internal/mining/cache_mining.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"balance_ulens held_balance_ulens lifetime_earned_ulens lifetime_spent_ulens updated_at workspace_id \" ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"

cannot "LedgerEntry mirrors talyvor-lens LedgerEntry — the LENS ledger row" \
    "talyvor-lens internal/mining/cache_mining.go" \
    "[ \"\$(sed -n '/^type LedgerEntry struct/,/^}/p' internal/mining/cache_mining.go | grep -o 'json:.[a-z_,]*' | sed 's/json:.//' | LC_ALL=C sort | tr '\n' ' ')\" = \"amount_ulens balance_after_ulens created_at description id metadata type workspace_id \" ]   # in a talyvor-lens checkout; the WHOLE json-tag set, so an ADDED field, a REMOVED one and an omitempty that came or went are each a mismatch"


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
grep -vE '^\s*(//|/\*|\*)' apps/web/vite.config.ts 2>/dev/null | grep -qE '\bassetsDir\b' || _d9_vite=1
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
