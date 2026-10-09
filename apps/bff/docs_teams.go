package main

// docs_teams.go — B28.450: a Docs page shared with a team, and who is on the team (talyvor-docs B28.446).
//
//	GET|POST    /api/docs/teams                                       → /v1/workspaces/{ws}/teams
//	PUT|DELETE  /api/docs/teams/{teamID}/members/{memberID}           → /v1/workspaces/{ws}/teams/{t}/members/{m}
//	GET|POST    /api/docs/spaces/{spaceID}/pages/{pageID}/permissions → /v1/spaces/{s}/pages/{p}/permissions
//
// The workspace is the session's, like every Docs workspace route here. Docs decides the rest: only a team's
// creator may change who is on it, only a page's admin may grant it, and a team grant stops at edit — every
// refusal is Docs' own and passes through. Member ids are the workspace roster's (GET /api/members).

import (
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
)

func (a *app) docsTeams() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, "GET, POST")
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		body, ok := postBody(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/teams"), "", r.Method, body, nil)
	})
}

func (a *app) docsTeamMember() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut && r.Method != http.MethodDelete {
			methodNotAllowed(w, "PUT, DELETE")
			return
		}
		teamID, ok := pathID(w, "teamID", r.PathValue("teamID"))
		if !ok {
			return
		}
		memberID, ok := pathID(w, "memberID", r.PathValue("memberID"))
		if !ok {
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		// Someone just added on Members is unknown to Docs until its next roster sweep: sync first, so they
		// can go on a team straight away.
		if r.Method == http.MethodPut {
			if err := a.nudgeDocsMemberSync(r.Context(), ws); err != nil && !errors.Is(err, errDocsNotConfigured) {
				log.Printf("bff: docs member-sync before a team add: %s", redactSecret(err.Error()))
			}
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/teams")+"/"+url.PathEscape(teamID)+"/members/"+url.PathEscape(memberID),
			"", r.Method, nil, nil)
	})
}

func (a *app) docsPagePermissions() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, "GET, POST")
			return
		}
		spaceID, ok := pathID(w, "spaceID", r.PathValue("spaceID"))
		if !ok {
			return
		}
		pageID, ok := pathID(w, "pageID", r.PathValue("pageID"))
		if !ok {
			return
		}
		if _, ok := a.docsWorkspaceFor(w, r); !ok {
			return
		}
		body, ok := postBody(w, r)
		if !ok {
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			"/v1/spaces/"+url.PathEscape(spaceID)+"/pages/"+url.PathEscape(pageID)+"/permissions",
			"", r.Method, body, nil)
	})
}

// postBody is a POST's bounded body, and no body for a GET.
func postBody(w http.ResponseWriter, r *http.Request) (io.Reader, bool) {
	if r.Method != http.MethodPost {
		return nil, true
	}
	return docsRelayBody(w, r)
}
