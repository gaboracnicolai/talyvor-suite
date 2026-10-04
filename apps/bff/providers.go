package main

// providers.go — B18.58: which of Lens's proxy providers this deployment has a key for, so the chat
// picker lists only models it can actually answer with.
//
// Lens's catalog lists every priced model whether or not the deployment holds that provider's key,
// and Lens says nothing else about its configuration. What it does say, on every provider route, is
// 503 "<provider> not configured" — BEFORE it reads the request body. A configured provider reads the
// body, and a body that is not JSON is refused 400 before a model is chosen, a cache is consulted or
// an upstream is called. So one invalid-JSON POST per provider tells the two apart and costs nothing.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"sort"
	"sync"
)

// providerProbeBody is deliberately not JSON: a configured provider refuses it 400 at the parse, so
// the probe can never reach a model or a ledger.
var providerProbeBody = []byte("{")

// handleAIProviders answers GET /api/ai/providers with {"unconfigured": [...]}: the providers whose
// Lens route answered 503.
//
// ⚠ IT NAMES WHAT LENS REFUSED, NOT WHAT IT ACCEPTED. A probe that fails any other way — Lens slow,
// rate limited, unreachable — leaves the provider listed, and a question sent to it gets Lens's own
// answer. Hiding a working provider because a probe was unlucky is the worse mistake.
func (a *app) handleAIProviders() http.HandlerFunc {
	return a.requireTenant(func(w http.ResponseWriter, r *http.Request, t tenant) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		key, err := a.sessionKeyFor(r.Context(), t)
		if err != nil {
			log.Printf("bff: providers credential: %v", err)
			var refused mintRefused
			if errors.As(err, &refused) {
				writeJSON(w, http.StatusBadGateway, map[string]string{
					"error": "lens refused the chat credential",
					"code":  chatCredentialRefusedCode,
				})
				return
			}
			writeUpstreamFailure(w, "lens", err)
			return
		}

		var (
			mu           sync.Mutex
			wg           sync.WaitGroup
			unconfigured = []string{}
		)
		for provider := range streamProviders {
			wg.Add(1)
			go func(provider string) {
				defer wg.Done()
				if a.providerRefused(r.Context(), provider, key) {
					mu.Lock()
					unconfigured = append(unconfigured, provider)
					mu.Unlock()
				}
			}(provider)
		}
		wg.Wait()
		sort.Strings(unconfigured)
		writeJSON(w, http.StatusOK, map[string][]string{"unconfigured": unconfigured})
	})
}

// providerRefused reports whether Lens answered 503 for provider's proxy route.
func (a *app) providerRefused(ctx context.Context, provider, key string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		a.cfg.lensBaseURL+"/v1/proxy/"+provider+"/v1/chat/completions", bytes.NewReader(providerProbeBody))
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		log.Printf("bff: provider probe %s: %v", provider, err)
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		return false
	}
	// B27.5 — Lens also answers 503 when it could not CHECK the session key (a database hiccup).
	// That says nothing about the provider, and reading it as "not configured" hid every model.
	var body struct {
		Code string `json:"code"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body)
	return body.Code != lensAuthUnavailableCode
}
