package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// stored_answers.go — B21.4: Features' "Stored answers" section. What this workspace has stored,
// deleting it (the answers it shared, or everything), and asking Talyvor to delete all of its
// data — Lens's B21.3 routes, reached with this session's own token.
//
// Lens decides who may delete and checks the typed name itself: its DELETE and its deletion
// request are refused to anyone but the workspace's owner or an admin, and a name that is not the
// workspace's is refused before anything is deleted. The BFF forwards those refusals' statuses
// unchanged, so the screen can say which one it was.

// storedAnswersCounts is Lens's storedanswers.Counts: what a workspace holds, or what a deletion removed.
type storedAnswersCounts struct {
	SharedAnswers      int64 `json:"shared_answers"`
	PrivateAnswers     int64 `json:"private_answers"`
	SharedConversions  int64 `json:"shared_conversions"`
	PrivateConversions int64 `json:"private_conversions"`
}

// storedAnswersReading is GET /api/features/stored-answers: the counts, and the name a deletion is
// confirmed with. That is the session's workspace id — the name Lens gives a workspace it
// provisioned (provision_handler.go: an empty display_name becomes the id).
type storedAnswersReading struct {
	storedAnswersCounts
	ConfirmWith string `json:"confirm_with"`
}

// handleStoredAnswers — GET /api/features/stored-answers.
func (a *app) handleStoredAnswers(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	raw, err := a.lensGet(r.Context(), t, lensWorkspacePath(t, "/stored-answers"))
	var out storedAnswersReading
	if err == nil {
		err = json.Unmarshal(raw, &out.storedAnswersCounts)
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not read what this workspace has stored"})
		return
	}
	out.ConfirmWith = t.workspaceID
	writeJSON(w, http.StatusOK, out)
}

// handleStoredAnswersDelete — POST /api/features/stored-answers/delete {"scope": "shared"|"all",
// "confirm": "<workspace>"} deletes through Lens's DELETE /v1/workspaces/{ws}/stored-answers and
// answers what Lens says it deleted.
func (a *app) handleStoredAnswersDelete(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		Scope   string `json:"scope"`
		Confirm string `json:"confirm"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&in); err != nil ||
		(in.Scope != "shared" && in.Scope != "all") || in.Confirm == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": `scope ("shared" or "all") and confirm (the workspace's name) required`})
		return
	}
	// UPSTREAM-BINDS-ONLY lensStoredAnswersDeleteBody: none
	body, _ := json.Marshal(map[string]string{"scope": in.Scope, "confirm": in.Confirm})
	raw, err := a.lensSendWorkspace(r.Context(), t, http.MethodDelete, "/stored-answers", body, http.StatusOK)
	var out struct {
		Scope   string               `json:"scope"`
		Deleted *storedAnswersCounts `json:"deleted"`
	}
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	if err == nil && out.Deleted == nil {
		err = errors.New("stored-answers: the reply does not say what was deleted")
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not delete"})
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// deletionRequest is the part of Lens's storedanswers.Request the screen shows.
type deletionRequest struct {
	ID          int64      `json:"id"`
	Status      string     `json:"status"`
	RequestedAt time.Time  `json:"requested_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

// handleDeletionRequests — GET /api/features/deletion-requests lists this workspace's requests to
// delete everything Talyvor holds for it; POST files one (Lens's POST …/deletion-requests), which
// an operator completes.
func (a *app) handleDeletionRequests(w http.ResponseWriter, r *http.Request, t tenant) {
	var raw []byte
	var err error
	switch r.Method {
	case http.MethodGet:
		raw, err = a.lensGet(r.Context(), t, lensWorkspacePath(t, "/deletion-requests"))
		var out struct {
			Requests []deletionRequest `json:"requests"`
		}
		if err == nil {
			err = json.Unmarshal(raw, &out)
		}
		if err != nil {
			writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "could not read this workspace's deletion requests"})
			return
		}
		if out.Requests == nil {
			out.Requests = []deletionRequest{}
		}
		writeJSON(w, http.StatusOK, out)
	case http.MethodPost:
		// UPSTREAM-BINDS-ONLY lensDeletionRequestBody: none
		body, _ := json.Marshal(map[string]string{"note": "Asked from Features"})
		raw, err = a.lensSendWorkspace(r.Context(), t, http.MethodPost, "/deletion-requests", body, http.StatusCreated)
		var out deletionRequest
		if err == nil {
			err = json.Unmarshal(raw, &out)
		}
		if err == nil && (out.ID == 0 || out.Status == "") {
			err = fmt.Errorf("deletion-requests: the reply does not name the request")
		}
		if err != nil {
			writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "the request was not recorded"})
			return
		}
		writeJSON(w, http.StatusCreated, out)
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}
