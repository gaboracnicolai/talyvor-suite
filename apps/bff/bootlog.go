package main

import "fmt"

// describeAllowlist renders the OIDC allowlist's STATE for the boot log.
//
// ⚠ IT REPORTS A STATE, NOT A COUNT, AND THAT IS THE WHOLE POINT. The line it replaces was:
//
//	bff: auth=oidc issuer=… public=… allowlist=%d entries
//
// With OIDC_ALLOWED_EMAILS=* that printed `allowlist=1 entries` on the live deploy — because
// parseAllowedEmails represents "any identity" as the one-element slice ["*"]. One permitted
// address and EVERY permitted address produced the identical string, and the string reads as
// the restrictive one. An operator read it as closed and came within a commit of "fixing" a
// working configuration; only /auth/me's signup_open told the truth.
//
// Nothing below the log line was wrong. parseAllowedEmails was right, signupIsOpen was right,
// the count was accurate. The defect was reporting a NUMBER for a value where the number
// carries no information — the dangerous state and the safe state rendered the same.
//
// So: in the open state there is no count to give, and none is given. In a restricted state the
// size is real information and is kept.
//
// ⚠ OPENNESS IS DERIVED FROM signupIsOpen, NEVER RE-IMPLEMENTED. That predicate already decides
// /auth/me's signup_open and the signup prose. A boot line carrying its own copy of
// `len == 1 && [0] == "*"` would be a second source of truth about one deployment, and the two
// would eventually disagree — the same class of defect as the one being fixed, one layer up.
// bootlog_test.go checks the equivalence by behaviour, not by reading this code.
func describeAllowlist(allowed []string) string {
	if signupIsOpen(allowed) {
		return "OPEN — every identity this issuer authenticates"
	}
	if len(allowed) == 1 {
		return "restricted to 1 address"
	}
	return fmt.Sprintf("restricted to %d addresses", len(allowed))
}
