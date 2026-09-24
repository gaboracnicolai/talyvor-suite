package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// track_projects.go — B4.2: Track's projects in the suite. Two routes of talyvor-track's
// internal/project/handler.go Mount, under the SESSION's Track workspace:
//
//	GET  /api/track/projects → GET  /v1/workspaces/{ws}/projects
//	POST /api/track/projects → POST /v1/workspaces/{ws}/projects
//
// Assigning an issue is the existing issue PATCH with a `project_id`, and filtering the list by a
// project is the existing issue list's `project_id` filter — neither needs a route here.

const maxProjectBody = 8 << 10

// trackProjectCreateBody is the create request this BFF builds. Track's Create decodes a whole
// model.Project, so a forwarded body could also set `status`, `priority` or dates; the four fields
// a person names when they start a project are the only ones sent. Track asserts the team is in the
// workspace (tenancy.AssertRefInWorkspace) and requires team, name and identifier.
type trackProjectCreateBody struct {
	TeamID      string `json:"team_id"`
	Name        string `json:"name"`
	Identifier  string `json:"identifier"`
	Description string `json:"description"`
}

func (a *app) trackProjects() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, "GET, POST")
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		path := trackWorkspacePath(ws, "/projects")
		if r.Method == http.MethodGet {
			a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
				path, "", http.MethodGet, nil, nil)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxProjectBody))
		if err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "project request too large"})
			return
		}
		var in trackProjectCreateBody
		if err := json.Unmarshal(raw, &in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json"})
			return
		}
		in.TeamID = strings.TrimSpace(in.TeamID)
		in.Name = strings.TrimSpace(in.Name)
		in.Identifier = strings.TrimSpace(in.Identifier)
		in.Description = strings.TrimSpace(in.Description)
		if in.TeamID == "" || in.Name == "" || in.Identifier == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a project needs a team, a name and an identifier"})
			return
		}
		payload, err := json.Marshal(in)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not build the project request"})
			return
		}
		a.forwardProduct(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			path, "", http.MethodPost, bytes.NewReader(payload), nil)
	})
}
