package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

// documentMaxBytes is the largest document the chat can attach: Lens's own upload cap
// (talyvor-lens internal/documents.MaxBytes, 25 MB).
const documentMaxBytes = 25 << 20

// documentUploadTimeout is how long a browser has to send one: 25 MB in three minutes is about 1.2 Mbit/s.
const documentUploadTimeout = 3 * time.Minute

// documentIDPattern is the shape of an id Lens stores a document under: tdoc_ and a UUID.
var documentIDPattern = regexp.MustCompile(`^tdoc_[A-Za-z0-9-]{1,64}$`)

// uploadedDocument is one document as Lens lists it, without its bytes.
type uploadedDocument struct {
	ID         string    `json:"id"`
	MediaType  string    `json:"media_type"`
	Filename   string    `json:"filename"`
	SizeBytes  int64     `json:"size_bytes"`
	UploadedAt time.Time `json:"uploaded_at"`
}

// documentsUnavailableCode says this deployment's Lens cannot list or delete uploaded documents yet
// (talyvor-lens B28.132 adds GET /v1/documents and DELETE /v1/documents/{id}).
const documentsUnavailableCode = "documents_unavailable"

// handleDocuments — /api/documents: POST stores a document the chat attaches (B18.24), GET lists every
// document the workspace has stored (B28.380).
func (a *app) handleDocuments(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodPost:
		a.handleDocumentUpload(w, r, t)
	case http.MethodGet:
		a.handleDocumentList(w, r, t)
	default:
		methodNotAllowed(w, "GET, POST")
	}
}

// handleDocumentList — GET /api/documents (B28.380): the documents uploaded in Chat, as Lens GET
// /v1/documents lists them → {"documents": [{id, media_type, filename, size_bytes, uploaded_at}]}.
// It asks on the chat's session key, the credential that uploaded them (handleDocumentUpload).
func (a *app) handleDocumentList(w http.ResponseWriter, r *http.Request, t tenant) {
	resp, ok := a.documentsCall(w, r, t, http.MethodGet, "/v1/documents")
	if !ok {
		return
	}
	defer func() { _ = resp.Body.Close() }()
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case resp.StatusCode == http.StatusOK:
	// A Lens without the list answers 404 (no such route) or 405 (only the upload's POST on that path).
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Lens cannot list uploaded files on this deployment yet", "code": documentsUnavailableCode})
		return
	case resp.StatusCode >= 500:
		log.Printf("bff: document list: lens status %d", resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens couldn’t list the files just now"})
		return
	default:
		log.Printf("bff: document list: lens status %d", resp.StatusCode)
		writeJSON(w, resp.StatusCode, map[string]string{"error": "Lens refused to list the files"})
		return
	}
	var listed struct {
		Documents []uploadedDocument `json:"documents"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&listed); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens answered with something that is not a list of files"})
		return
	}
	if listed.Documents == nil {
		listed.Documents = []uploadedDocument{}
	}
	writeJSON(w, http.StatusOK, listed)
}

// handleDocumentDelete — DELETE /api/documents/{id} (B28.380): Lens DELETE /v1/documents/{id} removes the
// document, so no question can reference it again. 204 when it is gone; 404 for an id this workspace has
// not (or no longer) stored, as Lens says.
func (a *app) handleDocumentDelete(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	id := r.PathValue("id")
	if !documentIDPattern.MatchString(id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such file"})
		return
	}
	resp, ok := a.documentsCall(w, r, t, http.MethodDelete, "/v1/documents/"+id)
	if !ok {
		return
	}
	defer func() { _ = resp.Body.Close() }()
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK:
		w.WriteHeader(http.StatusNoContent)
	case resp.StatusCode == http.StatusNotFound:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such file: it may have been deleted already"})
	case resp.StatusCode == http.StatusMethodNotAllowed:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Lens cannot delete uploaded files on this deployment yet", "code": documentsUnavailableCode})
	case resp.StatusCode >= 500:
		log.Printf("bff: document delete: lens status %d", resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens couldn’t delete the file just now"})
	default:
		log.Printf("bff: document delete: lens status %d", resp.StatusCode)
		writeJSON(w, resp.StatusCode, map[string]string{"error": "Lens refused to delete the file"})
	}
}

// documentsCall sends a bodiless request to a Lens documents route on the chat's session key. When it
// cannot, it has written the failure and reports false.
func (a *app) documentsCall(w http.ResponseWriter, r *http.Request, t tenant, method, path string) (*http.Response, bool) {
	key, err := a.sessionKeyFor(r.Context(), t)
	if err != nil {
		log.Printf("bff: document credential: %v", err)
		var refused mintRefused
		if errors.As(err, &refused) {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens refused the chat credential", "code": chatCredentialRefusedCode})
			return nil, false
		}
		writeUpstreamFailure(w, "lens", err)
		return nil, false
	}
	up, err := http.NewRequestWithContext(r.Context(), method, a.cfg.lensBaseURL+path, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return nil, false
	}
	up.Header.Set("Authorization", "Bearer "+key)
	up.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(up)
	if err != nil {
		log.Printf("bff: documents %s %s: %v", method, path, err)
		writeUpstreamFailure(w, "lens", err)
		return nil, false
	}
	return resp, true
}

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
	up, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, bytes.NewReader(doc))
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
