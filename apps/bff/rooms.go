package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
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
// "why not?". A body travels as the JSON the screen sent, bounded, and carrying no key but the ones the screen
// sends — so nothing Lens binds later can be set from the browser; the workspace a room is opened for is the
// session's, in the path, and never one the body names.

// roomDraftKeys are the keys of Lens's rooms.Draft the new-room form sends; terms names the keys inside it.
var roomDraftKeys = map[string][]string{"title": nil, "topic": nil, "description": nil, "visibility": nil,
	"terms": {"split_rule", "remix_share_bps", "default_price_usd_micros", "spend_policy"}}

// roomJoinKeys is the one key a join sends: the terms version the person accepted.
var roomJoinKeys = map[string][]string{"terms_version": nil}

// roomBody is the screen's JSON body for Lens, or false having answered 400: a JSON object with no key `allowed`
// does not name, and no key inside one of its objects that `allowed` does not list for it.
func roomBody(w http.ResponseWriter, r *http.Request, limit int64, allowed map[string][]string) ([]byte, bool) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil || int64(len(raw)) > limit || !onlyKeys(raw, allowed) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return nil, false
	}
	return raw, true
}

func onlyKeys(raw []byte, allowed map[string][]string) bool {
	var top map[string]json.RawMessage
	if json.Unmarshal(raw, &top) != nil || top == nil {
		return false
	}
	for k, v := range top {
		inner, ok := allowed[k]
		if !ok {
			return false
		}
		if inner == nil {
			continue
		}
		var obj map[string]json.RawMessage
		if json.Unmarshal(v, &obj) != nil {
			return false
		}
		for ik := range obj {
			if !slices.Contains(inner, ik) {
				return false
			}
		}
	}
	return true
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
		body, ok := roomBody(w, r, 32<<10, roomDraftKeys)
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
	body, ok := roomBody(w, r, 4<<10, roomJoinKeys)
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, "/v1/rooms/"+url.PathEscape(id)+"/join", body, "")
}
