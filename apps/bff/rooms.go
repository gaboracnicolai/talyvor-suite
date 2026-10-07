package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
)

// rooms.go — B32.53: Chat's rooms. Lens's rooms (B32.28–B32.30) relayed the way marketplace.go relays the
// marketplace, on the session's workspace token:
//
//	GET  /api/rooms?topic=        the open public rooms by latest activity, the rooms this workspace is in, the
//	                              rooms it is invited to, and what its plan lets it open (rooms_plan_limits)
//	POST /api/rooms               {title, topic, description, visibility, terms}: this workspace opens a room it owns
//	GET  /api/rooms/{id}          a room, its current terms, its members and agents, and this workspace's membership
//	POST /api/rooms/{id}/join     {terms_version}: join, accepting the room's current terms
//
// Lens decides who may open or join a room (the workspace's owner or an admin), what the plan allows and whether
// the terms accepted are the current ones. A refusal reaches the screen with Lens's sentence — a rooms_plan_limits
// refusal names the setting, the plan and the plan that allows more — because that sentence is the answer to
// "why not?". A body travels as the JSON the screen sent, bounded and checked to be JSON; the workspace a room is
// opened for is the session's, in the path, and never one the body names.

// roomBody is the screen's JSON body for Lens, or false having answered 400.
func roomBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil || int64(len(raw)) > limit || !json.Valid(raw) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return nil, false
	}
	return raw, true
}

// handleRooms — GET /api/rooms lists the rooms; POST opens one for the session's workspace.
func (a *app) handleRooms(w http.ResponseWriter, r *http.Request, t tenant) {
	switch r.Method {
	case http.MethodGet:
		path := "/v1/rooms"
		if topic := r.URL.Query().Get("topic"); topic != "" {
			path += "?topic=" + url.QueryEscape(topic)
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
	case http.MethodPost:
		body, ok := roomBody(w, r, 32<<10)
		if !ok {
			return
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodPost, lensWorkspacePath(t, "/rooms"), body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleRoom — GET /api/rooms/{id}.
func (a *app) handleRoom(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	id, ok := pathID(w, "room id", r.PathValue("id"))
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, "/v1/rooms/"+url.PathEscape(id), nil, "")
}

// handleRoomJoin — POST /api/rooms/{id}/join {terms_version}.
func (a *app) handleRoomJoin(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	id, ok := pathID(w, "room id", r.PathValue("id"))
	if !ok {
		return
	}
	body, ok := roomBody(w, r, 4<<10)
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, "/v1/rooms/"+url.PathEscape(id)+"/join", body, "")
}
