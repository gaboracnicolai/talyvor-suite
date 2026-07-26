package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// bffVersion is THE version string for this binary. /api/version and `bff version` both read it
// from here, so one stamp identifies the running process wherever it is asked.
//
// IT IS A VAR, NOT A CONST, BECAUSE IT IS INJECTED AT BUILD TIME:
//
//	go build -ldflags="-X main.bffVersion=$(git rev-parse --short HEAD)" .
//
// ⚠ A CONST CANNOT BE SET BY -X, AND THE FAILURE IS SILENT: the build succeeds, the flag is
// accepted, and the value does not change. That was the actual bug in Lens #364 — not a missing
// stamp, an unstampable one. version_test.go asserts this declaration is a var via the AST,
// because nothing at runtime can tell "const" apart from "var that was never stamped".
//
// THE DEFAULT IS "dev", DELIBERATELY. An unstamped build says so rather than claiming a version.
// A placeholder that looks like a version is worse than one that admits it: "dev" is checkable,
// "0.1.0" is not — and apps/web/package.json carried "0.1.0" from the first commit to this one
// without ever being either right or wrong, which is exactly the defect this replaces.
//
// Nothing here can check that the stamp was APPLIED. See scripts/build-release.sh and the CI
// build steps, which assert it against the built artifact.
var bffVersion = "dev"

// unstampedPlaceholder is the value bffVersion has when the link step did not set it. Named once
// so the guard, the reporting and the build script cannot disagree about what "unset" looks like.
const unstampedPlaceholder = "dev"

// bundleVersionFile is the web build's own version artifact, emitted by apps/web/vite.config.ts
// into dist/ and served verbatim by whoever serves the bundle.
const bundleVersionFile = "version.json"

// maxBundleVersionBytes caps the read. version.json is ~100 bytes; anything larger is not the
// file we mean, and an unauthenticated endpoint should not read an unbounded file from disk.
const maxBundleVersionBytes = 4 << 10

// binaryVersion identifies a build. Field for field the same contract as Lens's
// econflags.Binary, because an operator compares the two services side by side during a deploy
// and should not have to learn two shapes.
//
// ⚠ Commit is omitempty ON PURPOSE: an unstamped build reports NO commit rather than a commit
// called "dev", so `jq .commit` yields null instead of a plausible-looking string.
type binaryVersion struct {
	Commit  string `json:"commit,omitempty"`
	Stamped bool   `json:"stamped"`
	Note    string `json:"note,omitempty"`
}

// describeBinary reports build identity from a raw stamp value. "dev" (and empty, and whitespace)
// mean UNSTAMPED; reporting either as a commit would be the same defect as reporting a config
// default as an observed value.
func describeBinary(v string) binaryVersion {
	t := strings.TrimSpace(v)
	if t == "" || t == unstampedPlaceholder {
		return binaryVersion{
			Stamped: false,
			Note: "this binary carries no commit stamp (bffVersion is unset or the \"dev\" " +
				"placeholder), so the code that produced this readout cannot be identified — " +
				"build with scripts/build-release.sh, which applies it",
		}
	}
	return binaryVersion{Commit: t, Stamped: true}
}

// bundleVersion is the web bundle's identity as read from disk.
//
// ⚠ Readable IS A SEPARATE FIELD FROM Stamped, and both are separate from Commit, because there
// are three distinct states and collapsing any two of them misleads:
//
//	readable=false            — no version.json on disk. Says NOTHING about which bundle it is.
//	readable=true stamped=false — a real bundle, built without the stamp.
//	readable=true stamped=true  — a bundle that names its commit.
//
// A zero value must never read as agreement. See TestMissingBundleVersionIsReportedNotHidden.
type bundleVersion struct {
	Readable bool   `json:"readable"`
	Commit   string `json:"commit,omitempty"`
	Stamped  bool   `json:"stamped"`
	Note     string `json:"note,omitempty"`
}

// versionResponse is the /api/version payload: this binary, the bundle it is serving, and whether
// they agree.
type versionResponse struct {
	Service string `json:"service"` // always "bff" — names which of the two this describes
	Commit  string `json:"commit,omitempty"`
	Stamped bool   `json:"stamped"`
	Note    string `json:"note,omitempty"`

	// Bundle is the web artifact this process is serving from WEB_DIST. Never nil: an
	// unreadable bundle is reported as unreadable, not omitted.
	Bundle *bundleVersion `json:"bundle"`

	// Agree is null unless BOTH sides are stamped. Two unknowns are not a match, and a false
	// "true" here would tell an operator the deploy is consistent when nothing was established.
	Agree *bool `json:"agree"`

	// Verdict is the conclusion in words, so the reader does not have to reconstruct the rule
	// from the fields at 2am. This is the field to read first.
	Verdict string `json:"verdict"`
}

// readBundleVersion reads dist/version.json.
//
// ⚠ READ PER REQUEST, NOT CACHED AT BOOT — deliberately. The bundle is a directory on the host
// (WEB_DIST=/opt/talyvor/web-dist) that a deploy replaces WITHOUT restarting this process, which
// is precisely how the two versions come to disagree. A value cached at startup would report the
// bundle that was there when the BFF booted, i.e. it would be most wrong exactly in the case
// this endpoint exists to detect.
func readBundleVersion(webDist string) bundleVersion {
	path := filepath.Join(filepath.Clean(webDist), bundleVersionFile)
	f, err := os.Open(path) //nolint:gosec // path derived from operator config, not a request
	if err != nil {
		return bundleVersion{
			Readable: false,
			Note: fmt.Sprintf("no readable %s at %s (%v) — the bundle predates the version "+
				"surface, or WEB_DIST does not point at the bundle being served; either way its "+
				"commit is UNKNOWN, not matching", bundleVersionFile, path, err),
		}
	}
	defer f.Close() //nolint:errcheck // read-only

	raw, err := io.ReadAll(io.LimitReader(f, maxBundleVersionBytes))
	if err != nil {
		return bundleVersion{Readable: false, Note: fmt.Sprintf("reading %s: %v", path, err)}
	}
	var parsed struct {
		Commit  string `json:"commit"`
		Stamped bool   `json:"stamped"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return bundleVersion{
			Readable: false,
			Note: fmt.Sprintf("%s is not valid JSON (%v) — treat the bundle commit as UNKNOWN",
				path, err),
		}
	}

	b := bundleVersion{Readable: true}
	if d := describeBinary(parsed.Commit); d.Stamped && parsed.Stamped {
		b.Commit, b.Stamped = d.Commit, true
		return b
	}
	b.Note = "the bundle was built without a commit stamp, so which commit produced it is " +
		"UNKNOWN — build with scripts/build-release.sh, which applies it"
	return b
}

// buildVersionResponse assembles the payload. Split from the handler so the comparison logic is
// testable without an HTTP round trip.
func buildVersionResponse(rawVersion, webDist string) versionResponse {
	self := describeBinary(rawVersion)
	bundle := readBundleVersion(webDist)

	resp := versionResponse{
		Service: "bff",
		Commit:  self.Commit,
		Stamped: self.Stamped,
		Note:    self.Note,
		Bundle:  &bundle,
	}

	switch {
	case !bundle.Readable:
		resp.Verdict = "CANNOT COMPARE — the bundle does not report a version. Its commit is " +
			"unknown; do not read this as a match."
	case !self.Stamped && !bundle.Stamped:
		resp.Verdict = "CANNOT COMPARE — neither the BFF nor the bundle is stamped. This is a " +
			"development build, or a release built without scripts/build-release.sh."
	case !self.Stamped:
		resp.Verdict = "CANNOT COMPARE — this BFF binary is unstamped, so which commit is " +
			"running is unknown even though the bundle names one."
	case !bundle.Stamped:
		resp.Verdict = "CANNOT COMPARE — the bundle is unstamped, so which commit built the " +
			"served app is unknown even though this binary names one."
	case self.Commit == bundle.Commit:
		agree := true
		resp.Agree = &agree
		resp.Verdict = "MATCH — the BFF and the bundle it serves were built from " + self.Commit + "."
	default:
		agree := false
		resp.Agree = &agree
		// ⚠ THE INTERESTING CASE. These deploy as two independent operations on the same host
		// (scp the binary + restart; rsync the bundle directory), so a partial deploy leaves
		// them split. Say which is which and what it implies, because "they differ" alone does
		// not tell an operator which half is stale.
		resp.Verdict = fmt.Sprintf("MISMATCH — this BFF is %s but the bundle it serves is %s. "+
			"They are shipped by two separate steps, so one of them did not complete: a newer "+
			"BFF means the bundle rsync was missed or failed; a newer bundle means the binary "+
			"was not replaced or the service was not restarted. The browser is running %s.",
			self.Commit, bundle.Commit, bundle.Commit)
	}
	return resp
}

// handleVersion answers GET /api/version.
//
// ⚠ UNAUTHENTICATED, UNLIKE EVERY OTHER /api/ ROUTE. The reasoning is in
// TestVersionEndpointIsNotBehindTheSession, which fails if a session gate is added. In short: the
// reader is an operator mid-deploy; this BFF's own failure modes include "login does not work";
// and build identity is already public on this origin via the content-hashed asset filenames in
// index.html, so a gate would change the label rather than the disclosure.
func (a *app) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	resp := buildVersionResponse(bffVersion, a.cfg.webDist)

	w.Header().Set("Content-Type", "application/json")
	// A version is a property of the running process and the bundle on disk right now; a cached
	// answer is worthless mid-deploy, which is the only time anyone asks.
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("bff: version: encode: %v", err)
	}
}
