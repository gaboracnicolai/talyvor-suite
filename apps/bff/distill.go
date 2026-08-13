package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// distill.go — the document-conversion disclosure's control and evidence.
//
// ⚠ WHY THIS ROUTE EXISTS. Lens's DefaultDistillPolicy is DistillAlways, so every workspace
// already has distill_policy = 'always' and a customer attaching a PDF is ALREADY having it
// converted before the model sees it. PUT /v1/workspaces/{wsID}/distill has been live the whole
// time with nothing calling it — a setting that exists, is on, and cannot be reached.
//
// Mirrors handlePoolingChoice exactly, including the two properties that matter:
//   · a state-changing POST must carry the configured public Origin;
//   · the response states what Lens RECORDED, never an optimistic echo of the request.
//
// ⚠ DELIBERATELY OUT OF SCOPE: distill_poolable. That is a SEPARATE and more sensitive consent —
// it governs whether a document-derived answer may be shared across companies — and it must not
// ride along on a screen about a saving. A person turning document conversion on has not thereby
// agreed to share what those documents produced.

// lensStatusError is an upstream REFUSAL: Lens answered, and the answer was no. It carries the
// status so a composing handler can forward it, the way `forward` already does for every
// workspace-scoped proxy in this BFF ("Upstream status is preserved so a real not-found or error
// surfaces honestly rather than masked").
//
// ⚠ THE DISTINCTION IT DRAWS IS THE WHOLE POINT, AND IT IS WHY THIS IS A TYPE RATHER THAN AN INT.
// "Lens said no" and "Lens said nothing" are different facts and the browser acts on them
// differently. A transport failure never becomes one of these and stays a 502.
//
// ⚠ WHAT IT COST TO NOT HAVE ONE: this route collapsed every upstream refusal into 502, and the
// app's three dead-credential mechanisms all key on 401 — the session bar (isSessionExpired), the
// "a 401 is a verdict, not a flake" retry rule, and the gate re-probe. The document-conversion
// panel was the one workspace-scoped surface that could not report a dead credential, and the
// sentence it renders instead promises that its buttons still work.
type lensStatusError struct {
	path   string
	status int
}

func (e *lensStatusError) Error() string { return fmt.Sprintf("lens %s: %d", e.path, e.status) }

// upstreamStatusOr reports the status Lens refused with, or `fallback` when the failure was not
// an upstream answer at all.
//
// ⚠ ONLY 4xx AND 5xx ARE FORWARDED. A 204 or a 302 from Lens is a protocol surprise rather than a
// refusal, and re-emitting it here would send the browser a status this handler cannot honour
// (a 204 carrying a JSON body is not a 204). Those stay a 502, which is what they are.
func upstreamStatusOr(err error, fallback int) int {
	var e *lensStatusError
	if errors.As(err, &e) && e.status >= 400 && e.status <= 599 {
		return e.status
	}
	return fallback
}

// distillPolicies is the vocabulary — declared ONCE and enforced in BOTH directions.
//
// ⚠ THE ASYMMETRY IT CLOSES. The write allow-listed the value going UP, with a comment stating
// exactly why ("an unknown value forwarded from a browser is client input reaching a policy
// write — the shape this codebase refuses elsewhere"), and the read passed anything coming DOWN.
// MEASURED on the rendered panel: "opt_in", "", "weird" and a JSON null ALL draw "Document
// conversion is currently off for this workspace." The screen HAS a third state ("could not be
// read, so it is not shown") and NOTHING that arrives on a 200 can reach it — this handler emits
// distill_policy unconditionally, so a Go zero value is a present empty string, not an absent
// field. Every successful read became a positive claim about what happens to a customer's
// documents, whatever Lens actually said.
//
// ⚠ 'opt_in' IS NOT COLLAPSED HERE and that boundary is the point. It is a RECOGNISED state with
// a written reading on the screen (not on BY DEFAULT), so it passes through verbatim. Only the
// UNRECOGNISED case changes, and it is routed into copy the screen already owns rather than into
// new vocabulary. If Lens ever adds a fourth policy this route says "could not be read" instead
// of silently asserting "off" — the safe direction, and the reason this is a refusal rather than
// a default.
var distillPolicies = map[string]bool{"always": true, "opt_in": true, "disabled": true}

// truncate bounds an upstream string before it reaches an error message. The value is rejected
// precisely because nothing here vouches for it, so its LENGTH is not vouched for either.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// distillState is what the screen renders: the recorded policy plus a COUNT of documents.
//
// ⚠ THE COUNTS ARE POINTERS BECAUSE "NOT READ" AND "READ, AND IT WAS ZERO" ARE DIFFERENT FACTS,
// AND LENS SPENDS A STATUS CODE KEEPING THEM APART. talyvor-lens a04310a,
// internal/api/distill_usage.go, on ErrNoDistillUsageStore: "so the route can answer 503 ('not
// wired') rather than 200 with a zero — an absent reader and a workspace that converted nothing
// must not render identically." That sentence is written about RENDERING, and this repository
// holds the only renderer. These fields were plain ints, so a 503 arrived at the browser as
// converted:0, vision_ocr:0, days:0 — the exact 200-with-a-zero Lens refused to send, with
// days:0 as the tell that no window had been read at all.
//
// ⚠ AND NOT `omitempty` ON PLAIN INTS, which is the obvious cheaper fix and is the same collapse
// wearing the other coat: omitempty drops a ZERO, so a workspace that genuinely converted nothing
// would go absent beside the unwired one. A *int is nil when nothing was read and points at 0
// when 0 is the reading. distill_test.go pins BOTH directions.
type distillState struct {
	DistillPolicy string `json:"distill_policy"`
	Converted     *int   `json:"converted,omitempty"`
	VisionOCR     *int   `json:"vision_ocr,omitempty"`
	Days          *int   `json:"days,omitempty"`
}

// handleDistill serves the current state (GET) and records a change (POST).
func (a *app) handleDistill(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		st, err := a.readDistillState(r.Context(), t)
		if err != nil {
			writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway),
				map[string]string{"error": "could not read the document setting"})
			return
		}
		writeJSON(w, http.StatusOK, st)
	case http.MethodPost:
		var in struct {
			DistillPolicy *string `json:"distill_policy"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.DistillPolicy == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "distill_policy (string) required"})
			return
		}
		// ⚠ ALLOW-LIST, not pass-through. Lens validates too, but an unknown value forwarded from a
		// browser is client input reaching a policy write — the shape this codebase refuses
		// elsewhere. 'opt_in' is accepted because it is a real Lens state, even though this screen
		// offers only the two ends. The set is `distillPolicies` so the READ enforces the same
		// vocabulary; it was inline here, and widening it to accept "banana" reddened nothing in
		// this package — measured, which is why the write half is now asserted too.
		if !distillPolicies[*in.DistillPolicy] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "distill_policy must be always, opt_in or disabled"})
			return
		}
		recorded, err := a.setDistillPolicy(r.Context(), t, *in.DistillPolicy)
		if err != nil {
			writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway),
				map[string]string{"error": "could not record the choice"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"distill_policy": recorded})
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// setDistillPolicy writes the policy upstream and returns WHAT LENS RECORDED.
func (a *app) setDistillPolicy(ctx context.Context, t tenant, policy string) (string, error) {
	body, _ := json.Marshal(map[string]string{"distill_policy": policy})
	req, err := http.NewRequestWithContext(ctx, http.MethodPut,
		a.cfg.lensBaseURL+lensWorkspacePath(t, "/distill"), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.token)
	resp, err := a.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return "", &lensStatusError{path: "PUT " + lensWorkspacePath(t, "/distill"), status: resp.StatusCode}
	}
	var out struct {
		DistillPolicy string `json:"distill_policy"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("distill: unreadable response: %w", err)
	}
	// Report what Lens RECORDED, never what was asked for.
	return out.DistillPolicy, nil
}

// readDistillState reads the policy off the workspace and the counts off the usage route.
//
// ⚠ IT EXTRACTS distill_policy RATHER THAN FORWARDING THE WORKSPACE OBJECT. GET /v1/workspaces/{id}
// returns the whole record — spend caps, allowlists, retention, every other policy — and proxying
// that to a browser would widen this route from "one setting" to "everything about the tenant".
func (a *app) readDistillState(ctx context.Context, t tenant) (distillState, error) {
	var st distillState

	wsRaw, err := a.lensGet(ctx, t, lensWorkspacePath(t, ""))
	if err != nil {
		return st, err
	}
	var ws struct {
		DistillPolicy string `json:"distill_policy"`
	}
	if err := json.Unmarshal(wsRaw, &ws); err != nil {
		return st, fmt.Errorf("distill: unreadable workspace: %w", err)
	}
	// A value this BFF cannot classify is not reported as a setting. The screen turns everything
	// that is not "always" into the sentence "Document conversion is currently off", so handing it
	// an unrecognised string is handing it a claim; its "could not be read" state is the honest
	// one and it already exists. See distillPolicies.
	if !distillPolicies[ws.DistillPolicy] {
		return st, fmt.Errorf("distill: unrecognised distill_policy %q", truncate(ws.DistillPolicy, 32))
	}
	st.DistillPolicy = ws.DistillPolicy

	// The counts are best-effort: a Lens too old to serve /distill/usage (404) or with no reader
	// wired (503) must still leave the SETTING readable, because the control is the part that is
	// owed. What changes is what "best-effort" leaves behind when the effort fails: the keys stay
	// ABSENT rather than being filled with zeroes this BFF never read. See distillState.
	//
	// An unreadable BODY on a 200 is treated the same way, and deliberately: a response this
	// handler cannot parse is not a reading either, and inventing three zeroes for it is the same
	// claim by a different route.
	if usageRaw, err := a.lensGet(ctx, t, lensWorkspacePath(t, "/distill/usage")); err == nil {
		var u struct {
			Converted int `json:"converted"`
			VisionOCR int `json:"vision_ocr"`
			Days      int `json:"days"`
		}
		if json.Unmarshal(usageRaw, &u) == nil {
			st.Converted, st.VisionOCR, st.Days = &u.Converted, &u.VisionOCR, &u.Days
		}
	}
	return st, nil
}

// lensGet performs an authenticated GET against Lens and returns the body on 200.
func (a *app) lensGet(ctx context.Context, t tenant, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.lensBaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+t.token)
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, &lensStatusError{path: "GET " + path, status: resp.StatusCode}
	}
	return raw, nil
}
