package main

import (
	"bytes"
	"context"
	"encoding/json"
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

// distillState is what the screen renders: the recorded policy plus a COUNT of documents.
type distillState struct {
	DistillPolicy string `json:"distill_policy"`
	Converted     int    `json:"converted"`
	VisionOCR     int    `json:"vision_ocr"`
	Days          int    `json:"days"`
}

// handleDistill serves the current state (GET) and records a change (POST).
func (a *app) handleDistill(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		st, err := a.readDistillState(r.Context(), t)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not read the document setting"})
			return
		}
		writeJSON(w, http.StatusOK, st)
	case http.MethodPost:
		if !a.originAllowed(r) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "bad origin"})
			return
		}
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
		// offers only the two ends.
		switch *in.DistillPolicy {
		case "always", "opt_in", "disabled":
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "distill_policy must be always, opt_in or disabled"})
			return
		}
		recorded, err := a.setDistillPolicy(r.Context(), t, *in.DistillPolicy)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not record the choice"})
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
		return "", fmt.Errorf("distill: lens returned %d", resp.StatusCode)
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
	st.DistillPolicy = ws.DistillPolicy

	// The counts are best-effort: a Lens too old to serve /distill/usage (404) or with no reader
	// wired (503) must still leave the SETTING readable, because the control is the part that is
	// owed. Counts absent ⇒ zero ⇒ the screen renders no count line at all.
	if usageRaw, err := a.lensGet(ctx, t, lensWorkspacePath(t, "/distill/usage")); err == nil {
		var u struct {
			Converted int `json:"converted"`
			VisionOCR int `json:"vision_ocr"`
			Days      int `json:"days"`
		}
		if json.Unmarshal(usageRaw, &u) == nil {
			st.Converted, st.VisionOCR, st.Days = u.Converted, u.VisionOCR, u.Days
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
		return nil, fmt.Errorf("lens GET %s: %d", path, resp.StatusCode)
	}
	return raw, nil
}
