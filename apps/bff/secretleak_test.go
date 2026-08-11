package main

import (
	"net/http"
	"strings"
	"testing"
)

// secretleak_test.go — THE NEEDLE A LEAK SWEEP SEARCHES FOR MUST BE INSTALLED IN THE
// SYSTEM UNDER TEST.
//
// ── THE DEFECT THIS FILE EXISTS FOR ──────────────────────────────────────────
//
// Four sweeps in four files asserted "no secret reaches the browser", and every one of
// them searched for `testKey` ("tlv_ws_SECRET0000…") and the literal "tlv_ws_".
// NO FIXTURE IN THIS PACKAGE EVER PUT EITHER STRING INTO AN APP. `newTestApp`,
// `startOIDCBFF`, `billingApp` and `productApp` all build `config{provisionSecret:
// testProvisionSecret …}` — "test-provision-secret" — and `config` has no workspace-key
// field at all, because the BFF deliberately stopped holding one (tenant.go: "The BFF
// holds LENS_PROVISION_SECRET, never LENS_API_KEY"; main.go refuses to start when
// LENS_API_KEY is set).
//
// So the sweeps were searching fourteen responses for a credential the architecture had
// REMOVED, while the credential the BFF actually holds — the one whose own comment says
// it "can create a workspace and mint a session token for it" — went unswept.
//
// MEASURED, not read (~/talyvor-queue/w11-secretleak-controls.py, verdicts read from
// `--- FAIL:` lines over the WHOLE package rather than from an exit code):
//
//	P8   the secret echoed into GET /api/lxc/topup-options   → CAUGHT, and by
//	     TestKeyNeverReachesResponse ALONE — the test whose name claims this guarantee
//	P6b  THE SAME LEAK with the old needle restored           → NOT CAUGHT, nothing failed
//	P4b  the secret in a response HEADER, old needle          → NOT CAUGHT, nothing failed
//
// ⚠ AND ONE PREDICTION WAS WRONG, WHICH IS WHAT NARROWED THE CLAIM. P6 ran the blinding
// on `/api/context` and was predicted NOT CAUGHT; it came back CAUGHT, by
// `TestContext_StillCarriesNoCredential` in public_lens_url_test.go — a test that does
// search for `testProvisionSecret`, on that ONE route, in the BODY ONLY. So the honest
// statement is not "nothing could see this secret": ONE route's body was covered by a
// test outside this family, and every other swept route, plus the header half of every
// route including that one, was not. P4b is the header half measured rather than argued.
//
// ── WHY THE REPAIR IS A PREMISE ASSERTION AND NOT A LONGER NEEDLE LIST ───────
//
// Adding `testProvisionSecret` to the four lists would fix today's hole and leave the
// SHAPE of the defect untouched: the next secret added to `config` would be unswept in
// exactly the same silent way, and the sweeps would still read as coverage. So the
// needles are DERIVED FROM THE APP'S OWN CONFIG, and `assertNoSecretLeak` refuses to run
// at all when that derivation comes back empty. A sweep that cannot name a single secret
// the system under test is holding is not a passing sweep — it is an unarmed one, and it
// now says so instead of exiting 0.
//
// ⚠ THE SHAPE NEEDLES ARE KEPT AND THEY ARE NOT THE PREMISE. "tlv_ws_" and "gwsecret_"
// still catch a credential that arrives from UPSTREAM rather than from config — the
// minted key in keys_test.go is a real `tlv_ws_` value on the POST mint path. But an
// upstream-shaped needle can never vouch for a config-held secret, which is the whole
// reason this file exists, so they are listed separately and satisfy nothing.

// installedSecrets returns the secret values THIS app is actually holding, read off its
// own config rather than from a constant that may or may not have been wired in.
//
// Empty fields are omitted deliberately: `strings.Contains(body, "")` is true for every
// response, so an unset secret would turn every sweep into an unconditional failure. The
// omission is safe only because assertNoSecretLeak fails when the result is empty — the
// two halves are a pair, and neither is correct alone.
func installedSecrets(cfg config) map[string]string {
	all := map[string]string{
		"provisionSecret":    cfg.provisionSecret,
		"trackGatewaySecret": cfg.trackGatewaySecret,
		"docsGatewaySecret":  cfg.docsGatewaySecret,
		"oidcClientSecret":   cfg.oidcClientSecret,
	}
	out := map[string]string{}
	for name, v := range all {
		if v != "" {
			out[name] = v
		}
	}
	return out
}

// credentialShapes are prefixes of credentials that reach this BFF from UPSTREAM, so they
// cannot be read off config. They are additional needles, never evidence that the sweep is
// armed — see the header.
var credentialShapes = []string{"tlv_ws_", "gwsecret_"}

// assertNoSecretLeak fails if any secret the app is holding, or any upstream credential
// shape, appears in the response body or in any response header.
//
// `where` names the endpoint so a failure says which response leaked.
func assertNoSecretLeak(t *testing.T, where string, cfg config, body string, hdr http.Header) {
	t.Helper()

	secrets := installedSecrets(cfg)
	// ⚠ THE ASSERTION THE OLD SWEEPS DID NOT HAVE. Without it a sweep whose needles are
	// absent from the system under test passes for every possible product behaviour, which
	// is exactly what four of them were doing.
	if len(secrets) == 0 {
		t.Fatalf("%s: this sweep is unarmed — the app under test holds no secret this helper "+
			"can name, so searching its response proves nothing. Give the fixture a real "+
			"config secret, or teach installedSecrets about the field it does hold.", where)
	}

	for name, v := range secrets {
		if strings.Contains(body, v) {
			t.Fatalf("%s: config secret %s reached the response BODY", where, name)
		}
		for hn, vals := range hdr {
			for _, hv := range vals {
				if strings.Contains(hv, v) {
					t.Fatalf("%s: config secret %s reached response header %s", where, name, hn)
				}
			}
		}
	}

	for _, shape := range credentialShapes {
		if strings.Contains(body, shape) {
			t.Fatalf("%s: a %s credential appeared in the response BODY", where, shape)
		}
		for hn, vals := range hdr {
			for _, hv := range vals {
				if strings.Contains(hv, shape) {
					t.Fatalf("%s: a %s credential appeared in response header %s", where, shape, hn)
				}
			}
		}
	}
}

// TestLeakSweepIsArmed pins the premise itself, so the repair cannot be quietly undone by
// a future config change that empties every field this helper knows about.
//
// ⚠ IT ASSERTS THE NEGATIVE CASE TOO. A helper that only ever sees a well-populated config
// would never exercise the refusal, and the refusal is the entire fix — so the empty case
// is run here through the same function, and the sweep's own arming is a checked fact
// rather than a claim in this comment.
func TestLeakSweepIsArmed(t *testing.T) {
	if got := installedSecrets(config{}); len(got) != 0 {
		t.Fatalf("an empty config must yield no needles, got %v", got)
	}

	// The fixture every sweep in this package builds on must arm the sweep.
	a := newTestApp(t, nil)
	armed := installedSecrets(a.cfg)
	if len(armed) == 0 {
		t.Fatal("newTestApp's app holds no nameable secret — every sweep built on it is unarmed")
	}
	if _, ok := armed["provisionSecret"]; !ok {
		t.Fatalf("the provisioning secret is the one credential this BFF holds and it is not "+
			"among the needles: %v", armed)
	}

	// And an empty field must never become the needle "", which matches every response.
	for name, v := range installedSecrets(config{provisionSecret: "x", trackGatewaySecret: ""}) {
		if v == "" {
			t.Fatalf("needle %s is the empty string — it would match every response", name)
		}
	}
}
