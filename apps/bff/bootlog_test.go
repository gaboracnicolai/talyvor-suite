package main

import (
	"regexp"
	"strings"
	"testing"
)

// bootlog_test.go — THE VACUITY QUESTION, APPLIED TO LOG OUTPUT.
//
// "What does this line print in the dangerous state, and is that distinguishable from the safe
// one?" A check that cannot fail is worthless; so is a log line whose two readings are the same
// string.
//
// THE DEFECT THIS PINS, observed on the live deploy. With OIDC_ALLOWED_EMAILS=* the BFF booted:
//
//	bff: auth=oidc issuer=… public=… allowlist=1 entries
//
// which reads as ONE PERMITTED ADDRESS and means the exact opposite — every identity the issuer
// authenticates. The code was right the whole way down: parseAllowedEmails turns "*" into a
// one-element slice, signupIsOpen checks for exactly that, and /auth/me's signup_open reported
// the truth. Only the boot line lied, and it lied by reporting a COUNT for a value where the
// count carries no information. An operator read it as closed and came within one commit of
// "fixing" a working configuration.
//
// ⚠ THESE ASSERT THE STRING, because the string IS the defect. A test on len(allowedEmails)
// would have passed against the broken line — the number was never wrong, its presentation was.

// countLike matches a bare count of allowlist entries — the shape that misled. Deliberately
// permissive: `allowlist=1 entries`, `1 entries`, `entries=1` all read the same way to someone
// scanning boot output.
var countLike = regexp.MustCompile(`(?i)allowlist\s*[=:]\s*\d+|^\s*\d+\s+entries|entries\s*[=:]\s*\d+`)

func TestBootLog_OpenAllowlistCannotBeReadAsRestricted(t *testing.T) {
	got := describeAllowlist([]string{"*"})

	// 1. It must not print a number at all. "1" is the specific lie, but any digit invites the
	//    reading "that many addresses are permitted".
	if strings.ContainsAny(got, "0123456789") {
		t.Errorf("open allowlist logs %q — it contains a digit, which reads as a count of "+
			"permitted addresses. The open state has no count; say the state.", got)
	}
	if countLike.MatchString(got) {
		t.Errorf("open allowlist logs %q — that is the `allowlist=N entries` shape that caused "+
			"the incident", got)
	}

	// 2. It must SAY it is open, in a word an operator scanning boot output cannot miss.
	if !strings.Contains(got, "OPEN") {
		t.Errorf("open allowlist logs %q — it does not contain the word OPEN. The operator must "+
			"not have to know that one entry might mean unlimited.", got)
	}

	// 3. And it must say what open MEANS here, because "open" alone invites "open to the
	//    allowlist" as easily as "open to everyone".
	if !strings.Contains(strings.ToLower(got), "every") {
		t.Errorf("open allowlist logs %q — it does not say that EVERY identity is admitted", got)
	}
}

func TestBootLog_TheTwoStatesAreNotTheSameString(t *testing.T) {
	// The heart of it: one permitted address and unlimited addresses both had len==1 and both
	// printed "allowlist=1 entries". Whatever the wording, these two must never coincide.
	open := describeAllowlist([]string{"*"})
	one := describeAllowlist([]string{"solo@example.com"})

	if open == one {
		t.Fatalf("the wide-open and single-address states log the SAME string (%q). That is the "+
			"original defect: two opposite configurations, one indistinguishable line.", open)
	}
	if strings.Contains(one, "OPEN") {
		t.Errorf("a single-address allowlist logs %q, which contains OPEN — the inverse mistake, "+
			"and worse: it would read as wide-open while the door is shut", one)
	}
}

func TestBootLog_RestrictedStatesStillReportTheirSize(t *testing.T) {
	// The fix must not throw away information the operator does use. A restricted allowlist's
	// size is meaningful — it is only the OPEN state where the number means nothing.
	for _, tc := range []struct {
		name  string
		in    []string
		wantN string
	}{
		{"one address", []string{"a@x.com"}, "1"},
		{"three addresses", []string{"a@x.com", "b@x.com", "c@x.com"}, "3"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := describeAllowlist(tc.in)
			if !strings.Contains(got, tc.wantN) {
				t.Errorf("describeAllowlist(%d addresses) = %q; want it to state the count", len(tc.in), got)
			}
			if !strings.Contains(strings.ToLower(got), "restricted") {
				t.Errorf("restricted allowlist logs %q — it should say so plainly", got)
			}
		})
	}
}

func TestBootLog_DerivesOpennessFromTheOnePredicate(t *testing.T) {
	// ⚠ ONE PREDICATE, NOT A SECOND COPY OF THE RULE. signupIsOpen already decides this for
	// /auth/me's signup_open and for the signup prose. A boot line that re-implemented
	// `len==1 && [0]=="*"` would be a second source of truth, and the two would eventually
	// disagree about the same deployment — which is exactly the class of defect being fixed
	// here, one layer up.
	//
	// Checked by behaviour rather than by reading the implementation: for every input, the
	// line says OPEN if and only if signupIsOpen says open.
	for _, in := range [][]string{
		{"*"},
		{"a@x.com"},
		{"a@x.com", "b@x.com"},
		{},
		nil,
		{"*", "a@x.com"}, // not the open form — parseAllowedEmails refuses it, but be explicit
	} {
		saysOpen := strings.Contains(describeAllowlist(in), "OPEN")
		if saysOpen != signupIsOpen(in) {
			t.Errorf("describeAllowlist(%v) says open=%v but signupIsOpen says %v — two copies of "+
				"one rule, already disagreeing", in, saysOpen, signupIsOpen(in))
		}
	}
}

func TestBootLog_EmptyAllowlistIsNotSilentlyOpen(t *testing.T) {
	// parseAllowedEmails refuses an empty value at boot, so this should be unreachable. Pinned
	// anyway: if that refusal is ever relaxed, an empty slice must not render as OPEN — the
	// failure would hand every identity the door while the line claims a restriction.
	got := describeAllowlist(nil)
	if strings.Contains(got, "OPEN") {
		t.Errorf("an EMPTY allowlist logs %q — absence must never render as permission", got)
	}
}
