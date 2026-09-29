package main

// feedback.go — B23.12: the chat's thumbs-down.
//
//	POST /api/ai/feedback {"request_id", "signal": "negative"|"repeat"} → Lens POST /v1/feedback
//
// Lens (talyvor-lens B23.1) removes the stored answer that request was served — its copies in this
// workspace's cache and in the shared pool — so it is never served to anyone again, and records who
// marked it. It goes on the chat's own session key: Lens reads the request id inside the credential's
// workspace, and this is the key the answer was asked with.

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
)

const lensFeedbackPath = "/v1/feedback"

// requestIDHeader is Lens's id for one proxied request, stamped on every answer it serves. The chat
// keeps it with the answer, and a thumbs-down names the answer by it.
const requestIDHeader = "X-Talyvor-Request-ID"

// feedbackSignals are the signals that remove an answer: marked wrong, and flagged as unsatisfying.
var feedbackSignals = map[string]bool{"negative": true, "repeat": true}

// answerFeedback is what Lens removed: whether it had the answer stored, where it was served from,
// and how many stored answers and exact-cache copies went.
type answerFeedback struct {
	Stored             bool   `json:"stored"`
	ServedFrom         string `json:"served_from"`
	AnswersRemoved     int    `json:"answers_removed"`
	ExactCopiesRemoved int    `json:"exact_copies_removed"`
}

func (a *app) handleAIFeedback(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		RequestID string `json:"request_id"`
		Signal    string `json:"signal"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&in); err != nil ||
		in.RequestID == "" || len(in.RequestID) > 128 || !feedbackSignals[in.Signal] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request_id and signal (negative or repeat) required"})
		return
	}
	key, err := a.sessionKeyFor(r.Context(), t)
	if err != nil {
		log.Printf("bff: feedback credential: %v", err)
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
	// UPSTREAM-BINDS-ONLY lensFeedbackBody: prompt_hash
	body, _ := json.Marshal(map[string]string{"request_id": in.RequestID, "signal": in.Signal})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, a.cfg.lensBaseURL+lensFeedbackPath, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		writeUpstreamFailure(w, "lens", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	var out answerFeedback
	if resp.StatusCode != http.StatusOK {
		err = &lensStatusError{path: "POST " + lensFeedbackPath, status: resp.StatusCode}
	} else {
		err = json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out)
	}
	if err != nil {
		writeJSON(w, upstreamStatusOr(err, http.StatusBadGateway), map[string]string{"error": "lens did not record it"})
		return
	}
	writeJSON(w, http.StatusOK, out)
}
