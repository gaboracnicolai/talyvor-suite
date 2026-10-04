package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

// features.go — B8.2: the Features screen's read, and the two switches it adds.
//
//	GET  /api/features                       every capability setting on the session's workspace
//	POST /api/features/tare                  → PUT /v1/workspaces/{ws}/tare
//	POST /api/features/cost-optimize-routing → PUT /v1/workspaces/{ws}/cost-optimize-routing
//	POST /api/features/guardrails            → POST /v1/workspaces/{ws}/guardrails   (B18.22)
//	POST /api/features/logging               → PUT /v1/workspaces/{ws}/logging        (B18.22)
//	GET  /api/features/budget                the workspace's own spending limit       (B18.22)
//	POST /api/features/budget                → POST or PATCH /v1/workspaces/{ws}/budgets (B18.22)
//	POST /api/features/pattern-mining        → POST or DELETE /v1/workspaces/{ws}/pattern-mining/opt-in (B18.55)
//	POST /api/features/tare-model            → PUT /v1/workspaces/{ws}/tare-model     (B27.37)
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

// patternMiningState is whether the workspace shares its routing patterns, and whether this
// deployment mines patterns at all (when it does not, Lens refuses the opt-in).
type patternMiningState struct {
	OptedIn bool `json:"opted_in"`
	Enabled bool `json:"enabled"`
}

type featuresState struct {
	TarePolicy          *string             `json:"tare_policy"`
	TareModel           *bool               `json:"tare_model"`
	DistillPolicy       *string             `json:"distill_policy"`
	CompressionPolicy   *string             `json:"compression_policy"`
	LoggingPolicy       *string             `json:"logging_policy"`
	CachePoolable       *bool               `json:"cache_poolable"`
	DistillPoolable     *bool               `json:"distill_poolable"`
	CostOptimizeRouting *bool               `json:"cost_optimize_routing"`
	Guardrails          *featuresGuardrails `json:"guardrails"`
	PatternMining       *patternMiningState `json:"pattern_mining"`
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
	// Best-effort too: Lens mounts the opt-in only when its economy is on, so a 404 leaves it unread.
	st.PatternMining, _ = a.readPatternMining(ctx, t)
	return st, nil
}

// readPatternMining reads Lens's GET /v1/workspaces/{ws}/pattern-mining/opt-in (talyvor-lens B18.54).
func (a *app) readPatternMining(ctx context.Context, t tenant) (*patternMiningState, error) {
	raw, err := a.lensGet(ctx, t, lensWorkspacePath(t, "/pattern-mining/opt-in"))
	if err != nil {
		return nil, err
	}
	var p struct {
		OptedIn *bool `json:"opted_in"`
		Enabled *bool `json:"enabled"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.OptedIn == nil || p.Enabled == nil {
		return nil, fmt.Errorf("pattern mining: the reply does not state opted_in and enabled")
	}
	return &patternMiningState{OptedIn: *p.OptedIn, Enabled: *p.Enabled}, nil
}

// handleFeaturePatternMining — B18.55: POST /api/features/pattern-mining {"opted_in": bool} opts the
// workspace in (Lens's POST) or out (its DELETE) of sharing routing patterns, then answers what Lens
// reads back. Lens refuses an opt-in with 503 when the deployment has pattern mining off.
func (a *app) handleFeaturePatternMining(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		OptedIn *bool `json:"opted_in"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.OptedIn == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "opted_in (boolean) required"})
		return
	}
	method := http.MethodDelete
	if *in.OptedIn {
		method = http.MethodPost
	}
	_, err := a.lensSendWorkspace(r.Context(), t, method, "/pattern-mining/opt-in", nil, http.StatusOK)
	var out *patternMiningState
	if err == nil {
		out, err = a.readPatternMining(r.Context(), t)
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not record the choice"})
		return
	}
	writeJSON(w, http.StatusOK, out)
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

// handleFeatureTareModel — B27.37: POST /api/features/tare-model {"tare_model": bool} writes Lens's
// PUT /v1/workspaces/{ws}/tare-model {"enabled": bool} — Tare phase 2a, the prose model, which drops
// words where phase 1 refused (talyvor-lens B27.35) — and answers what Lens recorded.
func (a *app) handleFeatureTareModel(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		TareModel *bool `json:"tare_model"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.TareModel == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tare_model (boolean) required"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensTareModelBody: none
	body, _ := json.Marshal(map[string]bool{"enabled": *in.TareModel})
	raw, err := a.lensPutWorkspace(r.Context(), t, "/tare-model", body)
	var out struct {
		TareModel *bool `json:"tare_model"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err == nil && out.TareModel == nil {
		err = fmt.Errorf("tare-model: the reply does not state tare_model")
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not record the choice"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tare_model": *out.TareModel})
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
// handleFeatureDistillPoolable — B11.2: POST /api/features/distill-poolable {"distill_poolable": bool}
// writes Lens's PUT /v1/workspaces/{ws}/distill-poolable (the shared-document-conversions consent,
// separate from answer sharing) and answers what Lens recorded.
func (a *app) handleFeatureDistillPoolable(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		DistillPoolable *bool `json:"distill_poolable"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.DistillPoolable == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "distill_poolable (boolean) required"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensDistillPoolableBody: none
	body, _ := json.Marshal(map[string]bool{"distill_poolable": *in.DistillPoolable})
	raw, err := a.lensPutWorkspace(r.Context(), t, "/distill-poolable", body)
	var out struct {
		DistillPoolable bool `json:"distill_poolable"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not record the choice"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"distill_poolable": out.DistillPoolable})
}

// tareSavingsTotal is what Tare saved in this workspace, all work items together. Token counts are
// Lens's request-body ESTIMATES before and after the reduction, and the cost is those tokens at the
// billed model's input rate — so the screen labels both as estimated.
type tareSavingsTotal struct {
	Requests     int64   `json:"requests"`
	TokensBefore int64   `json:"tokens_before"`
	TokensAfter  int64   `json:"tokens_after"`
	CostSavedUSD float64 `json:"cost_saved_usd"`
}

// handleFeatureTareSavings — B11.2: GET /api/features/tare-savings sums Lens's
// GET /v1/workspaces/{ws}/tare/savings (grouped per work item) into one reading for the Tare row.
func (a *app) handleFeatureTareSavings(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/tare/savings"))
	var in struct {
		ByWorkItem []struct {
			Requests     int64   `json:"requests"`
			TokensIn     int64   `json:"tokens_in"`
			TokensOut    int64   `json:"tokens_out"`
			DeltaCostUSD float64 `json:"delta_cost_usd"`
		} `json:"by_work_item"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &in)
	}
	if err == nil && in.ByWorkItem == nil {
		// A reply without the list is not "nothing saved" — it is a reply this BFF does not understand.
		err = fmt.Errorf("tare savings: no by_work_item in the reply")
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not read Tare's savings"})
		return
	}
	var out tareSavingsTotal
	for _, s := range in.ByWorkItem {
		out.Requests += s.Requests
		out.TokensBefore += s.TokensIn
		out.TokensAfter += s.TokensOut
		out.CostSavedUSD += s.DeltaCostUSD
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *app) lensPutWorkspace(ctx context.Context, t tenant, suffix string, body []byte) ([]byte, error) {
	return a.lensSendWorkspace(ctx, t, http.MethodPut, suffix, body, http.StatusOK)
}

// lensSendWorkspace sends body to a workspace-scoped Lens route with method, and returns Lens's
// reply when it answers with want.
func (a *app) lensSendWorkspace(ctx context.Context, t tenant, method, suffix string, body []byte, want int) ([]byte, error) {
	path := lensWorkspacePath(t, suffix)
	req, err := http.NewRequestWithContext(ctx, method, a.cfg.lensBaseURL+path, bytes.NewReader(body))
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
	if resp.StatusCode != want {
		return nil, &lensStatusError{path: method + " " + path, status: resp.StatusCode}
	}
	return raw, nil
}

// handleFeatureGuardrails — B18.22: POST /api/features/guardrails {"injection": bool} or {"pii": bool}
// switches prompt-injection or personal-data detection and answers the two flags Lens recorded.
//
// ⚠ LENS'S POST REPLACES THE WHOLE POLICY — blocked topics and words, custom rules, the actions and
// the output checks. A body carrying one flag would reset every other rule to its zero value, so the
// current policy is read and written back with only the one flag changed.
func (a *app) handleFeatureGuardrails(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Injection *bool `json:"injection"`
		PII       *bool `json:"pii"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || (in.Injection == nil) == (in.PII == nil) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "exactly one of injection or pii (boolean) required"})
		return
	}
	key, on := "enable_injection", in.Injection
	if in.PII != nil {
		key, on = "enable_pii", in.PII
	}
	var policy map[string]json.RawMessage
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/guardrails"))
	if err == nil {
		err = json.Unmarshal(raw, &policy)
	}
	if err == nil && policy == nil {
		err = fmt.Errorf("guardrails: no policy in the reply")
	}
	if err == nil {
		policy[key] = json.RawMessage(strconv.FormatBool(*on))
		body, _ := json.Marshal(policy)
		raw, err = a.lensSendWorkspace(r.Context(), t, http.MethodPost, "/guardrails", body, http.StatusOK)
	}
	var out struct {
		EnableInjection *bool `json:"enable_injection"`
		EnablePII       *bool `json:"enable_pii"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err == nil && (out.EnableInjection == nil || out.EnablePII == nil) {
		err = fmt.Errorf("guardrails: the reply does not state both flags")
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not record the choice"})
		return
	}
	writeJSON(w, http.StatusOK, featuresGuardrails{Injection: *out.EnableInjection, PII: *out.EnablePII})
}

// handleFeatureLogging — B18.22: POST /api/features/logging {"logging_policy": "full"|"metadata"|"none"}
// writes Lens's PUT /v1/workspaces/{ws}/logging and answers the policy Lens recorded.
func (a *app) handleFeatureLogging(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		LoggingPolicy *string `json:"logging_policy"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.LoggingPolicy == nil ||
		!loggingPolicies[*in.LoggingPolicy] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "logging_policy must be full, metadata or none"})
		return
	}
	// UPSTREAM-BINDS-ONLY lensLoggingBody: none
	body, _ := json.Marshal(map[string]string{"logging_policy": *in.LoggingPolicy})
	raw, err := a.lensPutWorkspace(r.Context(), t, "/logging", body)
	var out struct {
		LoggingPolicy *string `json:"logging_policy"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err == nil && knownOrNil(out.LoggingPolicy, loggingPolicies) == nil {
		err = fmt.Errorf("logging: the reply does not state a known policy")
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not record the choice"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logging_policy": *out.LoggingPolicy})
}

// budgetEnforcements is Lens's budgets.Enforcement vocabulary.
var budgetEnforcements = map[string]bool{"off": true, "alert": true, "hard_block": true}

// lensBudget is the part of a Lens budget this screen reads and writes back.
type lensBudget struct {
	ID              string          `json:"id"`
	Scope           string          `json:"scope"`
	Period          string          `json:"period"`
	LimitUSD        float64         `json:"limit_usd"`
	SpentUSD        float64         `json:"spent_usd"`
	AlertThresholds []float64       `json:"alert_thresholds"`
	Enforcement     string          `json:"enforcement"`
	EndsAt          json.RawMessage `json:"ends_at,omitempty"`
}

// featuresBudget is the workspace's own spending limit as the Features screen shows it. Several means
// more than one workspace-wide limit was set through Lens's API, which this screen does not choose
// between.
type featuresBudget struct {
	Budget  *featuresBudgetLimit `json:"budget"`
	Several bool                 `json:"several"`
}

type featuresBudgetLimit struct {
	Period      string  `json:"period"`
	LimitUSD    float64 `json:"limit_usd"`
	SpentUSD    float64 `json:"spent_usd"`
	Enforcement string  `json:"enforcement"`
}

func projectBudget(b lensBudget) *featuresBudgetLimit {
	return &featuresBudgetLimit{Period: b.Period, LimitUSD: b.LimitUSD, SpentUSD: b.SpentUSD, Enforcement: b.Enforcement}
}

// workspaceBudgets lists the workspace-wide budgets (team and sprint budgets are not this screen's).
func (a *app) workspaceBudgets(ctx context.Context, t tenant) ([]lensBudget, error) {
	raw, err := a.lensGet(ctx, t, lensWorkspacePath(t, "/budgets"))
	if err != nil {
		return nil, err
	}
	var all []lensBudget
	if err := json.Unmarshal(raw, &all); err != nil {
		return nil, fmt.Errorf("budgets: unreadable list: %w", err)
	}
	var out []lensBudget
	for _, b := range all {
		if b.Scope == "workspace" {
			out = append(out, b)
		}
	}
	return out, nil
}

// handleFeatureBudget — B18.22. GET answers the workspace's spending limit (none, one, or several).
// POST {"limit_usd": n, "enforcement": "hard_block"|"alert"|"off"} sets it: Lens's POST creates a
// monthly one when there is none, and its PATCH changes the one there is.
//
// ⚠ LENS'S PATCH REPLACES limit, thresholds, enforcement, period and end date together, so the
// existing budget's period, thresholds and end date are sent back unchanged beside the new values.
func (a *app) handleFeatureBudget(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		return
	}
	var in struct {
		LimitUSD    *float64 `json:"limit_usd"`
		Enforcement *string  `json:"enforcement"`
	}
	if r.Method == http.MethodPost {
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil || in.LimitUSD == nil ||
			*in.LimitUSD <= 0 || in.Enforcement == nil || !budgetEnforcements[*in.Enforcement] {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "limit_usd (above 0) and enforcement (hard_block, alert or off) required"})
			return
		}
	}
	list, err := a.workspaceBudgets(r.Context(), t)
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not read this workspace's spending limit"})
		return
	}
	if len(list) > 1 {
		if r.Method == http.MethodPost {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "this workspace has several spending limits; change them through Lens"})
			return
		}
		writeJSON(w, http.StatusOK, featuresBudget{Budget: nil, Several: true})
		return
	}
	if r.Method == http.MethodGet {
		var limit *featuresBudgetLimit
		if len(list) == 1 {
			limit = projectBudget(list[0])
		}
		writeJSON(w, http.StatusOK, featuresBudget{Budget: limit, Several: false})
		return
	}

	var raw []byte
	if len(list) == 0 {
		// UPSTREAM-BINDS-ONLY lensBudgetCreateBody: id, workspace_id, scope_id, spent_usd, alert_thresholds, starts_at, ends_at, created_at, updated_at
		body, _ := json.Marshal(map[string]any{"scope": "workspace", "period": "monthly", "limit_usd": *in.LimitUSD, "enforcement": *in.Enforcement})
		raw, err = a.lensSendWorkspace(r.Context(), t, http.MethodPost, "/budgets", body, http.StatusCreated)
	} else {
		b := list[0]
		// UPSTREAM-BINDS-ONLY lensBudgetUpdateBody: id, workspace_id, scope, scope_id, spent_usd, starts_at, created_at, updated_at
		body, _ := json.Marshal(map[string]any{"period": b.Period, "limit_usd": *in.LimitUSD, "alert_thresholds": b.AlertThresholds, "enforcement": *in.Enforcement, "ends_at": b.EndsAt})
		raw, err = a.lensSendWorkspace(r.Context(), t, http.MethodPatch, "/budgets/"+url.PathEscape(b.ID), body, http.StatusOK)
	}
	var out lensBudget
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err == nil && (out.Scope != "workspace" || !budgetEnforcements[out.Enforcement]) {
		err = fmt.Errorf("budgets: the reply is not a workspace budget")
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not record the limit"})
		return
	}
	writeJSON(w, http.StatusOK, featuresBudget{Budget: projectBudget(out), Several: false})
}
