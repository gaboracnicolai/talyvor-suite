package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// B11.3 — the Try-it pages' two routes. Each forwards the input to Lens's preview for the SESSION's
// workspace (talyvor-lens B11.4): the feature runs on it with no model call and no charge.
//
//	POST /api/features/tare/preview        {content, kind, model?} → POST /v1/workspaces/{ws}/tare/preview
//	POST /api/features/conversion/preview  document bytes          → POST /v1/workspaces/{ws}/distill/preview
//
// Same posture as the other feature routes: session-gated, same-Origin on the write (ServeHTTP), key
// attached server-side. Lens's reply is relayed as it is — the page shows what Lens did, not a copy.

const (
	tryTareMaxBytes       = 1 << 20  // Lens caps a Tare preview at 1 MiB
	tryConversionMaxBytes = 10 << 20 // distill.MaxInputBytes
)

func (a *app) handleTryTare(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	// Forwarded as sent — {content, kind, model?} is Lens's contract, which it validates; the BFF only
	// refuses an empty paste so the page can say so without a round trip.
	body, err := io.ReadAll(io.LimitReader(r.Body, tryTareMaxBytes+4096))
	var in struct {
		Content string `json:"content"`
	}
	if err != nil || json.Unmarshal(body, &in) != nil || in.Content == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "paste something for Tare to look at"})
		return
	}
	a.relayPreview(w, r.Context(), t, "/tare/preview", "application/json", body)
}

func (a *app) handleTryConversion(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, tryConversionMaxBytes+1))
	if err != nil || len(body) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "choose a document to convert"})
		return
	}
	if len(body) > tryConversionMaxBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "the document is larger than 10 MB"})
		return
	}
	a.relayPreview(w, r.Context(), t, "/distill/preview", r.Header.Get("Content-Type"), body)
}

// relayPreview POSTs to a workspace-scoped Lens preview and relays its answer. A 4xx from Lens carries
// a reason the person can act on (an unsupported file type, a document too large), so its message is
// passed through; anything else is a plain "could not run".
func (a *app) relayPreview(w http.ResponseWriter, ctx context.Context, t tenant, suffix, contentType string, body []byte) {
	path := lensWorkspacePath(t, suffix)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.lensBaseURL+path, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not run the preview"})
		return
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+t.token)
	resp, err := a.client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not reach Lens to run the preview"})
		return
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	switch {
	case resp.StatusCode == http.StatusOK:
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(raw)
	case resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden:
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		if strings.TrimSpace(e.Error) == "" {
			e.Error = "Lens could not run the preview on this input"
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": e.Error})
	default:
		writeJSON(w, upstreamStatusOr(&lensStatusError{path: "POST " + path, status: resp.StatusCode}, http.StatusBadGateway),
			map[string]string{"error": "could not run the preview"})
	}
}
