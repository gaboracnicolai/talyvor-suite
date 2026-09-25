package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// features.go — B8.2: the Features screen's read, and the two switches it adds.
//
//	GET  /api/features                       every capability setting on the session's workspace
//	POST /api/features/tare                  → PUT /v1/workspaces/{ws}/tare
//	POST /api/features/cost-optimize-routing → PUT /v1/workspaces/{ws}/cost-optimize-routing
//
// Same posture as /api/distill: session-gated, same-Origin on the write (ServeHTTP), key attached
// server-side, and a write answers with what Lens RECORDED, never an echo of the request.
//
// ⚠ PROJECTED FIELD BY FIELD, like readDistillState: GET /v1/workspaces/{id} is the whole tenant
// record (spend caps, allowlists, retention), and forwarding it would widen this route from "the
// settings on the Features screen" to "everything about the tenant".
//
// ⚠ AN UNRECOGNISED VALUE IS REPORTED AS UNREAD (null), NEVER PASSED THROUGH. The screen reads
// every policy as a sentence about what is happening to the customer's requests; a string it
// cannot classify would become a claim. See TestDistillReadRefusesAnUnrecognisedPolicy.

// reducerPolicies is the vocabulary Lens's tare, distill and compression policies share.
var reducerPolicies = map[string]bool{"disabled": true, "opt_in": true, "always": true}

// loggingPolicies is Lens's workspace.LoggingPolicy vocabulary.
var loggingPolicies = map[string]bool{"full": true, "metadata": true, "none": true}

type featuresGuardrails struct {
	Injection bool `json:"injection"`
	PII       bool `json:"pii"`
}

type featuresState struct {
	TarePolicy          *string             `json:"tare_policy"`
	DistillPolicy       *string             `json:"distill_policy"`
	CompressionPolicy   *string             `json:"compression_policy"`
	LoggingPolicy       *string             `json:"logging_policy"`
	CachePoolable       *bool               `json:"cache_poolable"`
	DistillPoolable     *bool               `json:"distill_poolable"`
	CostOptimizeRouting *bool               `json:"cost_optimize_routing"`
	Guardrails          *featuresGuardrails `json:"guardrails"`
}

func knownOrNil(v *string, vocab map[string]bool) *string {
	if v == nil || !vocab[*v] {
		return nil
	}
	return v
}

func (a *app) handleFeatures(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	st, err := a.readFeatures(r.Context(), t)
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway),
			map[string]string{"error": "could not read this workspace's settings"})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (a *app) readFeatures(ctx context.Context, t tenant) (featuresState, error) {
	var st featuresState
	raw, err := a.lensGet(ctx, t, lensWorkspacePath(t, ""))
	if err != nil {
		return st, err
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return st, fmt.Errorf("features: unreadable workspace: %w", err)
	}
	st.TarePolicy = knownOrNil(st.TarePolicy, reducerPolicies)
	st.DistillPolicy = knownOrNil(st.DistillPolicy, reducerPolicies)
	st.CompressionPolicy = knownOrNil(st.CompressionPolicy, reducerPolicies)
	st.LoggingPolicy = knownOrNil(st.LoggingPolicy, loggingPolicies)
	st.Guardrails = nil

	// Best-effort, like distill's counts: the guardrail policy lives in a separate Lens engine, and
	// a refusal there must not hide the settings above. Unread stays null.
	if gRaw, err := a.lensGet(ctx, t, lensWorkspacePath(t, "/guardrails")); err == nil {
		var g struct {
			EnableInjection *bool `json:"enable_injection"`
			EnablePII       *bool `json:"enable_pii"`
		}
		if json.Unmarshal(gRaw, &g) == nil && g.EnableInjection != nil && g.EnablePII != nil {
			st.Guardrails = &featuresGuardrails{Injection: *g.EnableInjection, PII: *g.EnablePII}
		}
	}
	return st, nil
}

// handleFeatureTare records the workspace's Tare policy.
func (a *app) handleFeatureTare(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		TarePolicy *string `json:"tare_policy"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.TarePolicy == nil ||
		!reducerPolicies[*in.TarePolicy] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tare_policy must be always, opt_in or disabled"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensTareBody: none
	body, _ := json.Marshal(map[string]string{"tare_policy": *in.TarePolicy})
	raw, err := a.lensPutWorkspace(r.Context(), t, "/tare", body)
	var out struct {
		TarePolicy string `json:"tare_policy"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not record the choice"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tare_policy": out.TarePolicy})
}

// handleFeatureCostRouting records the workspace's consent to cost-optimised routing.
func (a *app) handleFeatureCostRouting(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		CostOptimizeRouting *bool `json:"cost_optimize_routing"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.CostOptimizeRouting == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cost_optimize_routing (boolean) required"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensCostRoutingBody: none
	body, _ := json.Marshal(map[string]bool{"cost_optimize_routing": *in.CostOptimizeRouting})
	raw, err := a.lensPutWorkspace(r.Context(), t, "/cost-optimize-routing", body)
	var out struct {
		CostOptimizeRouting bool `json:"cost_optimize_routing"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not record the choice"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cost_optimize_routing": out.CostOptimizeRouting})
}

// lensPutWorkspace PUTs body to a workspace-scoped Lens route and returns Lens's reply, which states
// what it recorded.
func (a *app) lensPutWorkspace(ctx context.Context, t tenant, suffix string, body []byte) ([]byte, error) {
	path := lensWorkspacePath(t, suffix)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, a.cfg.lensBaseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+t.token)
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, &lensStatusError{path: "PUT " + path, status: resp.StatusCode}
	}
	return raw, nil
}
