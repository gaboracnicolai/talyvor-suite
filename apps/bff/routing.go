package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

// routing.go — B28.364: the read behind Chat's cheaper-model hint (talyvor-lens B28.105 builds on it).
//
//	GET /api/routing/recommendation?provider=openai&input_range=small
//	  → GET /v1/workspaces/{ws}/routing/recommendation?provider=openai&input_range=small
//
// Lens names the model on that provider that answers questions of that size best for the money,
// among the models the workspace may use — or none. Chat offers it under an answer when it costs
// less than the model that wrote the answer, with one click to ask again on it.
//
// The feature is Chat's own tag: Chat's questions reach Lens as X-Talyvor-Feature: chat (B28.106), so they are
// in Lens's "chat" cohort.
//
// ⚠ PROJECTED FIELD BY FIELD, like /api/features: Lens's reason names how many questions and
// workspaces the pick rests on, and the screen needs only the model, its provider and the basis.
// An unrecognised basis is reported as none — the screen offers a model only on a basis it knows.

// routingInputRanges is Lens's input-size vocabulary (internal/mining: small < 500 input tokens,
// medium < 2000, large < 8000, xlarge beyond).
var routingInputRanges = map[string]bool{"small": true, "medium": true, "large": true, "xlarge": true}

// routingBases is Lens's routing.Basis vocabulary.
var routingBases = map[string]bool{"quality_per_dollar": true, "quality": true, "none": true}

type routingRecommendation struct {
	Model      string `json:"model"`
	Provider   string `json:"provider"`
	Basis      string `json:"basis"`
	Confidence string `json:"confidence"`
}

func (a *app) handleRoutingRecommendation(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	provider, inputRange := r.URL.Query().Get("provider"), r.URL.Query().Get("input_range")
	if !streamProviders[provider] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provider must be one Chat can ask"})
		return
	}
	if !routingInputRanges[inputRange] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "input_range must be small, medium, large or xlarge"})
		return
	}
	q := url.Values{"provider": {provider}, "input_range": {inputRange}, "feature": {chatFeature}}
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/routing/recommendation?"+q.Encode()))
	var in routingRecommendation
	if err == nil {
		err = json.Unmarshal(raw, &in)
	}
	if err == nil && in.Basis == "" {
		err = fmt.Errorf("routing recommendation: no basis in the reply")
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not read Lens's model recommendation"})
		return
	}
	if !routingBases[in.Basis] || in.Basis == "none" {
		in = routingRecommendation{Provider: provider, Basis: "none"}
	}
	writeJSON(w, http.StatusOK, in)
}
