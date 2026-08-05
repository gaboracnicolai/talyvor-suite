package main

import (
	"log"
	"net/http"
	"strings"
)

// operator.go — THE OPERATOR BOUNDARY.
//
// ── WHY A SECOND BOUNDARY EXISTS ─────────────────────────────────────────────────────────────────
//
// Lens already serves the cross-tenant admin reads. The blocker was never the backend: this BFF
// boots with `allowlist=OPEN` and `signup_open=true`, so every Google account that signs up gets a
// full session. Mounting an admin read behind requireSession alone would show every tenant's spend,
// purchases and royalties to anyone who has ever signed up.
//
// ⚠ OPERATOR IS INDEPENDENT OF THE SIGNUP ALLOWLIST, AND CONFLATING THEM IS THE BUG.
// OIDC_ALLOWED_EMAILS answers "who may sign in". This answers "who may see everything". They are
// different questions with different blast radii, so they are different variables and neither reads
// the other.
//
// ── IDENTITY IS (issuer, sub), NOT EMAIL ─────────────────────────────────────────────────────────
//
// ⚠ AN EMAIL ALLOWLIST IS SPOOFABLE BY WHOEVER OWNS THE DOMAIN NEXT. Addresses are reassigned:
// a company folds, someone re-registers the domain, and `ops@old-startup.com` is issued to a
// stranger who then authenticates truthfully and is admitted. Google's `sub` is the opposite — an
// opaque per-account identifier that is stable for the life of the account and is never reissued to
// anyone else. It is the only thing in the token the issuer actually guarantees about WHO this is.
// The session already stores it (auth.go), and this repo already treats identity as (issuer, sub)
// for per-user provisioning, so this is the existing rule applied to a second question rather than
// a new one invented here.
//
// ⚠ WHAT BREAKS IF YOU CHANGE GOOGLE ACCOUNT: you lose operator access, and you must add the new
// account's `sub` to OPERATOR_SUBS and restart. That is the correct behaviour — a different account
// is a different identity, and a boundary that followed you across accounts would be following an
// address, which is the thing that can be taken over. The cost is real and worth stating: `sub` is
// opaque (`110248495…`), so it has to be read out of /auth/me once and written into config.
//
// ── UNSET MEANS NOBODY ───────────────────────────────────────────────────────────────────────────
//
// ⚠ An empty list refuses EVERY identity, including the deployment owner's. Not "everyone", not
// "the first user", not "the owner by inference" — a boundary whose default is open is not a
// boundary, and every fresh deployment starts unset. The only way in is to name yourself.
const operatorSubsEnv = "OPERATOR_SUBS"

// parseOperatorSubs reads the comma-separated allowlist. Whitespace is trimmed and blanks dropped,
// so `OPERATOR_SUBS=` and `OPERATOR_SUBS=,,` both mean the same thing: nobody.
//
// ⚠ THERE IS DELIBERATELY NO "*" WILDCARD. OIDC_ALLOWED_EMAILS has one because opening SIGN-UP is a
// legitimate posture; opening cross-tenant financial reads to everyone who signs up is not, and a
// wildcard here would be one character away from exactly the disclosure this file exists to stop.
func parseOperatorSubs(raw string) []string {
	out := []string{}
	for _, s := range strings.Split(raw, ",") {
		if t := strings.TrimSpace(s); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// isOperator reports whether this session's subject is on the list. Exact match on the full `sub`;
// no prefixes, no patterns, nothing that could match more than the one account it names.
func (a *app) isOperator(s session) bool {
	if len(a.cfg.operatorSubs) == 0 {
		return false // unset ⇒ nobody, including me
	}
	for _, sub := range a.cfg.operatorSubs {
		if sub == s.sub {
			return true
		}
	}
	return false
}

// requireOperator gates a handler on the operator boundary.
//
// ⚠ IT DOES NOT USE requireTenant, AND THAT IS THE POINT. Every other route resolves a workspace
// from the session and pins the upstream path to it — that resolver is what makes cross-tenant reads
// impossible everywhere else, and it must keep doing so. An admin read is cross-tenant BY DEFINITION,
// so instead of teaching the resolver a "skip" flag — one typo away from a cross-tenant read on a
// normal route — this handler simply never calls it. The workspace resolver is untouched and has no
// bypass to misuse; admin routes are the only ones that do not ask it, and they are the only ones
// behind this gate.
func (a *app) requireOperator(next func(http.ResponseWriter, *http.Request, session)) http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		sess, ok := a.auth.sessionFrom(r)
		if !ok {
			// requireSession already answered; unreachable, and fail closed regardless.
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication required"})
			return
		}
		if !a.isOperator(sess) {
			// ⚠ THE REFUSAL IS AUDITED TOO. Someone probing the operator surface is worth a line;
			// a boundary that only records success cannot show you an attempt.
			a.auditOperatorRead(r, sess, false)
			writeJSON(w, http.StatusForbidden, map[string]string{
				"error": "operator access required — this account is not on OPERATOR_SUBS"})
			return
		}
		a.auditOperatorRead(r, sess, true)
		next(w, r, sess)
	})
}

// auditOperatorRead writes one line per operator read, granted or refused.
//
// ⚠ WHERE IT GOES, AND WHAT THAT IS WORTH. It goes to the BFF's stdout log — the same stream
// docker/journald already collects, and the only sink this service has today. That is honest but
// limited: it is NOT queryable, NOT tamper-evident, and NOTHING in the product reads it back. An
// operator cannot ask "who looked at the finances last week" from any screen; they must grep the
// container logs. Writing it to Postgres so it is readable is the obvious upgrade and is
// deliberately NOT done here — it would be a second, unreviewed authz surface in the same change.
//
// The identity is logged as the SUB, not the email: the sub is what the boundary actually checked,
// and logging an address instead would record a claim the decision never used.
func (a *app) auditOperatorRead(r *http.Request, s session, granted bool) {
	outcome := "REFUSED"
	if granted {
		outcome = "granted"
	}
	log.Printf("bff: operator-read %s sub=%s path=%s — cross-tenant admin surface", outcome, s.sub, r.URL.Path)
}

// adminNotWired answers every /api/admin/* route until Lens grows a read credential this BFF can
// present.
//
// ⚠ IT RETURNS 501 AND SAYS SO, RATHER THAN FAKING DATA. Lens's admin routes exist but require a
// credential the BFF does not hold; inventing a plausible-looking body here would put numbers on a
// screen that no ledger produced, which is the failure this project has spent weeks removing. The
// boundary is the deliverable — this is the honest placeholder behind it, and it is reached ONLY by
// an authenticated operator, so the 501 itself discloses nothing.
func (a *app) adminNotWired(w http.ResponseWriter, r *http.Request, _ session) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{
		"error": "operator reads are not wired yet: Lens's /v1/admin/* routes need a read credential " +
			"this BFF does not hold. The operator boundary is live; the data path is not.",
		"path": r.URL.Path,
	})
}
