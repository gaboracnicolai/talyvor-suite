package main

// The login-time Docs nudge: close the first-visit window instead of waiting out a sweep.
//
// ── WHAT WAS ACTUALLY WRONG ─────────────────────────────────────────────────
//
// Not the deadlock. That one is closed: Docs enumerates workspaces from TRACK rather than from
// the workspaces it already holds content for (talyvor-track bf60842, talyvor-docs c970329), so a
// brand-new identity's workspace is visible to Docs the moment Track mints it, with no content
// required first. What remained is a TIMING window — Docs learns the roster on a periodic sweep,
// so between signing up and the next sweep the workspace exists, Docs can see it, and Docs has
// not read the membership yet. Every write 403s in that gap.
//
// Shortening the sweep narrows the window. It does not close it, because "narrower" is still
// "sometimes", and the person it lands on is by construction someone in their first minute.
//
// ── WHY A NUDGE AND NOT SOMETHING STRONGER ──────────────────────────────────
//
// The alternative shapes were considered and are worse:
//
//   - Sync on every Docs request: a Track round-trip on the hot path, forever, to fix the first
//     ten seconds of an account's life.
//   - Have Docs trust the caller's identity headers instead of its own roster: that deletes the
//     membership check, which is the tenancy boundary.
//   - Block login until Docs confirms: makes Docs a hard dependency of signing in, which it is
//     not — see rule 1.
//
// The nudge is an optimisation of WHEN a reconcile happens, never the only path to one. THE
// SWEEP REMAINS THE BACKSTOP, so a nudge that is dropped, refused or never sent is a delay of
// minutes rather than a permanent 403. That property is what makes best-effort honest here
// rather than a euphemism.
//
// ── THE TWO RULES ARE TRACK'S, AND THEY BIND HARDER HERE ────────────────────
//
//  1. A DOCS FAILURE MUST NOT FAIL LOGIN (handleCallback logs and continues, asserted in
//     docs_membersync_test.go). Track's version of this rule trades login availability against a
//     product being unavailable; this one trades it against a few minutes of latency on one
//     product. The trade is far more lopsided, so the rule is far less negotiable.
//  2. IT MUST NOT BE CACHED IN THE SESSION, and here that is enforced by ABSENCE rather than by
//     a retry: the nudge returns nothing the BFF keeps. A "nudged" flag would freeze one failed
//     attempt for the session's twelve hours, and a "not nudged" flag would duplicate the sweep.
//     No field exists, and a test fails if one appears.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// docsMemberSyncPath is Docs' gateway-authed service route for reconciling ONE workspace's roster
// from Track (talyvor-docs internal/trackintegration/service_handler.go).
//
// It is under /v1/service/, not /v1/workspaces/, for exactly the reason Track's bootstrap is not:
// Docs' workspace authz reads the segment after /v1/workspaces/ as a membership check, and the
// caller this route exists for is by definition the one whose membership has not been read yet.
func docsMemberSyncPath(workspaceID string) string {
	return "/v1/service/workspaces/" + workspaceID + "/member-sync"
}

// errDocsNotConfigured means this deployment has no Docs upstream. Distinct from a failure:
// nothing is wrong, the product simply is not wired here — the same distinction
// errTrackNotConfigured draws for Track.
var errDocsNotConfigured = errors.New("docs upstream not configured on this BFF")

// nudgeDocsMemberSync asks Docs to reconcile one workspace's roster from Track, now.
//
// The workspace is the one TRACK just minted for this identity, so the BFF is not choosing a
// tenant — it is forwarding the id Track derived from verified identity headers moments earlier.
// An empty id is refused rather than sent: "" would address /v1/service/workspaces//member-sync,
// a different route shape whose behaviour is not this function's to assume.
//
// Idempotent upstream — the reconcile is an upsert-and-prune against Track's current roster — so
// a nudge that races the sweep, or a retry, costs one Track round-trip and changes nothing.
func (a *app) nudgeDocsMemberSync(ctx context.Context, workspaceID string) error {
	if a.cfg.docsBaseURL == "" || a.cfg.docsGatewaySecret == "" {
		return errDocsNotConfigured
	}
	if workspaceID == "" {
		return errors.New("docs member-sync: no workspace to sync")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		a.cfg.docsBaseURL+docsMemberSyncPath(workspaceID), bytes.NewReader(nil))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gateway-Auth", a.cfg.docsGatewaySecret) // transit proof, server-side only

	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// Drain so the connection is reusable; the body carries nothing the BFF acts on.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		// ⚠ SAY WHICH KIND OF FAILURE. This route shipped 403ing every call, and the log line
		// — "returned 403" — read like any other upstream hiccup, so it was filed as noise
		// against a backstop that was quietly carrying the whole feature.
		//
		// A 4xx here is a CONTRACT or CONFIGURATION failure: the secret is wrong, or Docs
		// wants something this request does not carry. It will fail identically on every
		// login until someone changes something. A 5xx is Docs having a moment and is
		// genuinely transient. They deserve different reactions and the old message gave
		// them the same one.
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return fmt.Errorf("docs member-sync: returned %d — this is a configuration or "+
				"contract failure, not a transient one: it will recur on every login until "+
				"the gateway secret or the route contract is fixed", resp.StatusCode)
		}
		return fmt.Errorf("docs member-sync: returned %d (transient; the sweep remains the "+
			"backstop)", resp.StatusCode)
	}
	return nil
}
