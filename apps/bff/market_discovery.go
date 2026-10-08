package main

import (
	"net/http"
	"net/url"
)

// market_discovery.go — B32.61: the marketplace's Discover screen, relayed to Lens's discovery (B32.50):
//
//	GET /api/marketplace/search?q=&capability=&kind=&licence=&max_price_per_use=&min_eval=&verified_only=&sort=&page=
//	                                        a page of the approved public listings that match; max_price_per_use in µUSD
//	GET /api/marketplace/capabilities       the controlled list a listing declares what it can do from
//	GET /api/marketplace/collections        the public collections, the operator's featured ones first
//	GET /api/marketplace/collections/{id}   one collection and its listings, in its curator's order
//
// Every read goes on the session's workspace token, as the catalog's does. Lens decides what matches, how it is
// ranked and what a use is billed; a 4xx sentence (a capability not on the list, a price that is not a number) is
// relayed because it is the screen's answer to "why not?".

// discoverParams are the search's parameters Lens reads; anything else on the request is not sent on.
var discoverParams = []string{"q", "capability", "kind", "licence", "max_price_per_use", "min_eval", "verified_only", "sort", "page"}

// handleMarketSearch — GET /api/marketplace/search.
func (a *app) handleMarketSearch(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	in := r.URL.Query()
	if !marketKinds[in.Get("kind")] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "kind must be agent, prompt, skill, evaluation or pipeline"})
		return
	}
	out := url.Values{}
	for _, name := range discoverParams {
		if v := in.Get(name); v != "" {
			out.Set(name, v)
		}
	}
	path := "/v1/marketplace/search"
	if len(out) > 0 {
		path += "?" + out.Encode()
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
}

// handleMarketCapabilities — GET /api/marketplace/capabilities.
func (a *app) handleMarketCapabilities(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, "/v1/marketplace/capabilities", nil, "")
}

// handleMarketCollections — GET /api/marketplace/collections.
func (a *app) handleMarketCollections(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, "/v1/marketplace/collections", nil, "")
}

// handleMarketCollection — GET /api/marketplace/collections/{id}.
func (a *app) handleMarketCollection(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "collection id", r.PathValue("id"))
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, "/v1/marketplace/collections/"+url.PathEscape(id), nil, "")
}
