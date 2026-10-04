package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
)

// provider_keys.go — B27.27, "Your provider keys" on Settings, for a workspace on the BYOK plan (Lens B27.26).
//
//	GET    /api/provider-keys            → Lens GET    /v1/workspaces/{ws}/provider-keys (gated: absent = no custody here)
//	PUT    /api/provider-keys/{provider} → Lens PUT    /v1/workspaces/{ws}/provider-keys/{provider} {"key": "…"}
//	DELETE /api/provider-keys/{provider} → Lens DELETE /v1/workspaces/{ws}/provider-keys/{provider}
//
// A key passes through once, on its way to Lens, and is never logged, stored or answered here: Lens answers
// with the provider and the last four characters only, and that is what is relayed. The workspace is the
// SESSION's and the provider comes from a fixed list, so the upstream path cannot be steered.

// byokProviders are the providers Lens takes a BYOK key for (talyvor-lens internal/byok.Providers).
var byokProviders = map[string]bool{"anthropic": true, "google": true, "groq": true, "mistral": true, "openai": true}

// providerKeyMaxBytes bounds the body: a provider API key is at most 512 characters at Lens.
const providerKeyMaxBytes = 4 << 10

func (a *app) handleProviderKey(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPut && r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodPut+", "+http.MethodDelete)
		return
	}
	provider := r.PathValue("provider")
	if !byokProviders[provider] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provider must be one of anthropic, google, groq, mistral, openai"})
		return
	}
	path := lensWorkspacePath(t, "/provider-keys/"+provider)
	switch r.Method {
	case http.MethodPut:
		var in struct {
			Key string `json:"key"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, providerKeyMaxBytes)).Decode(&in); err != nil || in.Key == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "paste your provider API key"})
			return
		}
		// UPSTREAM-BINDS-ONLY lensProviderKeyBody: none
		body, err := json.Marshal(map[string]string{"key": in.Key})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "encode"})
			return
		}
		a.relayProviderKey(w, r, t, http.MethodPut, path, body)
	case http.MethodDelete:
		a.relayProviderKey(w, r, t, http.MethodDelete, path, nil)
	}
}

// relayProviderKey answers what Lens answered: its JSON on 200, 204 on a removal, its status and sentence
// on a 4xx (402: not on the BYOK plan; 400: a malformed key; 404: nothing to remove), a 502 otherwise.
// Neither the request body nor Lens's error body is logged — the first is the key.
func (a *app) relayProviderKey(w http.ResponseWriter, r *http.Request, t tenant, method, path string, body []byte) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, a.cfg.lensBaseURL+path, rd)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: provider key %s: upstream unreachable", method)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	switch {
	case resp.StatusCode == http.StatusNoContent:
		w.WriteHeader(http.StatusNoContent)
	case resp.StatusCode == http.StatusOK && json.Valid(raw):
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		var refusal struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
	default:
		log.Printf("bff: provider key %s: lens upstream status %d", method, resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
	}
}
