package main

import (
	"bytes"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"
)

// documentMaxBytes is the largest document the chat can attach: Lens's own upload cap
// (talyvor-lens internal/documents.MaxBytes, 25 MB).
const documentMaxBytes = 25 << 20

// documentUploadTimeout is how long a browser has to send one: 25 MB in three minutes is about 1.2 Mbit/s.
const documentUploadTimeout = 3 * time.Minute

// handleDocumentUpload — POST /api/documents?filename=… (B18.24): a document the chat attaches, up to
// 25 MB, relayed to Lens POST /v1/documents (B18.13). The body is the file and its Content-Type the
// document's media type, exactly as Lens reads them. Lens answers 201 with the tdoc_ id a chat request
// then references instead of carrying the file in its 4 MiB body.
//
// ⚠ IT GOES UP ON THE CHAT'S OWN SESSION KEY, NOT THE WORKSPACE TOKEN. Lens reads an uploaded document
// only for the workspace whose credential uploaded it, and /v1/documents sits behind the same {proxy}
// scope as the chat routes, so the key that will reference the document is the one that stores it.
func (a *app) handleDocumentUpload(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	// ⚠ THE SERVER'S 15s READ BOUND WOULD CUT A 25 MB UPLOAD OFF on an ordinary uplink (it needs ~14 Mbit/s
	// to finish in time), and its 30s write bound runs from the same moment. This route alone gets room.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Now().Add(documentUploadTimeout))
	_ = rc.SetWriteDeadline(time.Now().Add(documentUploadTimeout + 30*time.Second))
	key, err := a.sessionKeyFor(r.Context(), t)
	if err != nil {
		log.Printf("bff: document credential: %v", err)
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
	// Read whole so an oversized file is a clean 413 here rather than a transfer cut off half way to Lens.
	doc, err := io.ReadAll(http.MaxBytesReader(w, r.Body, documentMaxBytes))
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "a document can be at most 25 MB"})
		return
	case err != nil:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read the document"})
		return
	}
	target := a.cfg.lensBaseURL + "/v1/documents"
	if name := r.URL.Query().Get("filename"); name != "" && len(name) <= 255 {
		target += "?filename=" + url.QueryEscape(name)
	}
	// B17.36 — an upload that meets a Lens restart is sent again once Lens is back, like the chat's
	// question (B17.30): Lens never stored a file it never answered for, and storing one moves no LXC.
	up, err := http.NewRequestWithContext(resendOnRestart(r.Context()), http.MethodPost, target, bytes.NewReader(doc))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	up.Header.Set("Authorization", "Bearer "+key)
	up.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	up.Header.Set("Accept", "application/json")
	// The stream client: no whole-exchange bound, so a 25 MB upload is not cut off at the shared
	// client's 10 seconds.
	resp, err := a.streamClient.Do(up)
	if err != nil {
		log.Printf("bff: document upload: %v", err)
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 500 {
		log.Printf("bff: document upload: lens status %d", resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens couldn’t store the document just now"})
		return
	}
	// Lens's 201 (the document) and its refusals — 413 over 25 MB, 415 a format it cannot read — in its words.
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(answer)
}
