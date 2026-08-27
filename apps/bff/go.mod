module github.com/gaboracnicolai/talyvor-suite/apps/bff

go 1.25.0

// ⚠ THE SECURITY FLOOR THIS MODULE SHIPS, AND IT IS A MEASUREMENT RATHER THAN A PREFERENCE.
//
// There was no `toolchain` directive here at all, so CI's `go-version-file: apps/bff/go.mod`
// resolved the `go 1.25.0` line and actions/setup-go installed EXACTLY go1.25.0 — the .0 patch.
// Measured in CI on 2026-08-27 by the vuln job's own output, not inferred: `GOTOOLCHAIN='local'`,
// `GOVERSION='go1.25.0'`, and `govulncheck ./...` reporting **32 CALLED vulnerabilities from the
// Go standard library** — html/template, crypto/tls, crypto/x509, net/http, net/url, net/textproto,
// encoding/asn1, net. That is the runtime `scripts/build-release.sh bff` links the shipped binary
// against in the same workflow.
//
// ⚠⚠ AND THE SAME SCAN ON A DEVELOPER MACHINE SAID **NINE**, WHICH IS THE TRAP WORTH RECORDING.
// With GOTOOLCHAIN=auto and no directive here, a laptop uses whatever Go it happens to have
// installed (go1.26.3 on the machine that filed W6.36) and govulncheck grades THAT stdlib. The
// local number was not a smaller estimate of the same thing — it was a measurement of a runtime
// this repo does not ship. A directive removes the ambiguity: local and CI now grade the same
// stdlib, because both resolve it from this line.
//
// ⚠ RAISING THIS MEANS RE-MEASURING. Lowering it restores the 32. talyvor-lens, talyvor-track
// (W6.34) and talyvor-docs all pin the same go1.26.6 floor, each for the same reason.
toolchain go1.26.6

require (
	github.com/coreos/go-oidc/v3 v3.20.0
	golang.org/x/oauth2 v0.36.0
)

require github.com/go-jose/go-jose/v4 v4.1.4 // indirect
