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
