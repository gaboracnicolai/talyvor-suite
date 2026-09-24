package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// track_cycles.go — B4.1: Track's cycles (sprints) in the suite. Three routes of talyvor-track's
// internal/cycle/handler.go Mount, under the SESSION's Track workspace:
//
//	GET  /api/track/teams/{teamID}/cycles                → GET  /v1/workspaces/{ws}/teams/{teamID}/cycles
//	POST /api/track/teams/{teamID}/cycles                → POST /v1/workspaces/{ws}/teams/{teamID}/cycles
//	GET  /api/track/teams/{teamID}/cycles/{id}/progress  → GET  …/cycles/{id}/progress
//
// Adding an issue to a cycle needs no route here: it is the existing issue PATCH with a
// `cycle_id`, which Track's issue updatableFields already allows.

// maxCycleBody caps a cycle create. The body is a name and two dates.
const maxCycleBody = 4 << 10

// trackCycleCreateBody is the create request this BFF builds. Track's Create decodes a whole
// model.Cycle, so a forwarded body could also set `status`, `number` or `id`; the three fields a
// person chooses when they start a cycle are the only ones sent.
type trackCycleCreateBody struct {
	Name      string `json:"name"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

func (a *app) trackCycles() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		teamID, ok := pathID(w, "teamID", r.PathValue("teamID"))
		if !ok {
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, "GET, POST")
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		path := trackWorkspacePath(ws, "/teams/"+url.PathEscape(teamID)+"/cycles")
		if r.Method == http.MethodGet {
			a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
				path, "", http.MethodGet, nil, nil)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCycleBody))
		if err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "cycle request too large"})
			return
		}
		var in trackCycleCreateBody
		if err := json.Unmarshal(raw, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		start, errS := time.Parse(time.RFC3339, in.StartDate)
		end, errE := time.Parse(time.RFC3339, in.EndDate)
		switch {
		case in.Name == "":
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a cycle needs a name"})
			return
		case errS != nil || errE != nil:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "start_date and end_date must be RFC 3339 timestamps"})
			return
		case !end.After(start):
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a cycle must end after it starts"})
			return
		}
		payload, err := json.Marshal(in)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not build the cycle request"})
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			path, "", http.MethodPost, bytes.NewReader(payload), nil)
	})
}

func (a *app) trackCycleProgress() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		teamID, ok := pathID(w, "teamID", r.PathValue("teamID"))
		if !ok {
			return
		}
		cycleID, ok := pathID(w, "id", r.PathValue("id"))
		if !ok {
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/teams/"+url.PathEscape(teamID)+"/cycles/"+url.PathEscape(cycleID)+"/progress"),
			"", http.MethodGet, nil, nil)
	})
}
