package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"time"
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

// B32.54 — the room screen. Lens's messages, event stream, contributions and runs (B32.30, B32.31, B32.33), relayed the
// same way, on the session's workspace token:
//
//	GET   /api/rooms/{id}/messages?before=&after=&limit=   a page of the room's messages, oldest first, with its events_cursor
//	POST  /api/rooms/{id}/messages                         {body}: a member posts
//	GET   /api/rooms/{id}/events?after=                    the room's events as Server-Sent Events, relayed as they come
//	GET   /api/rooms/{id}/contributions                    the room's contributions with their tallies and this member's vote
//	POST  /api/rooms/{id}/contributions                    {kind, title, description, artifact, changelog, price_usd_micros, parents}
//	GET   /api/rooms/{id}/contributions/{cid}              one, with its listing
//	PATCH /api/rooms/{id}/contributions/{cid}              {status}: the owner or an editor accepts or rejects it
//	POST  /api/rooms/{id}/contributions/{cid}/fork         {title, description, artifact, changelog, price_usd_micros}
//	PUT   /api/rooms/{id}/contributions/{cid}/vote         {value}: +1 or −1, the latest counting
//	POST  /api/rooms/{id}/runs                             {target, version, input, variables, model, pay, max_price_usd_micros}
//
// Lens decides who may post, contribute, vote and run, and on whose money: paying "room", the room's wallet judges and
// pays; paying "self", the member's own workspace. The run's message — what ran, what it cost and who paid — reaches
// every member through the event stream.

var (
	roomMessageKeys      = map[string][]string{"body": nil}
	roomContributionKeys = map[string][]string{"kind": nil, "title": nil, "description": nil, "artifact": nil, "changelog": nil,
		"price_usd_micros": nil, "parents": nil}
	roomForkKeys     = map[string][]string{"title": nil, "description": nil, "artifact": nil, "changelog": nil, "price_usd_micros": nil}
	roomVoteKeys     = map[string][]string{"value": nil}
	roomDecisionKeys = map[string][]string{"status": nil}
	roomRunKeys      = map[string][]string{"target": nil, "version": nil, "input": nil, "variables": nil, "model": nil, "pay": nil,
		"max_price_usd_micros": nil}
)

// roomPath is Lens's path for a room's sub-resource, from the request's {id} and, when cid is true, its {cid}.
func roomPath(w http.ResponseWriter, r *http.Request, rest string, cid bool) (string, bool) {
	id, ok := pathID(w, "room id", r.PathValue("id"))
	if !ok {
		return "", false
	}
	p := "/v1/rooms/" + url.PathEscape(id)
	if cid {
		c, ok := pathID(w, "contribution id", r.PathValue("cid"))
		if !ok {
			return "", false
		}
		p += "/contributions/" + url.PathEscape(c)
	}
	return p + rest, true
}

// handleRoomMessages — GET a page of the room's messages; POST {body} posts one.
func (a *app) handleRoomMessages(w http.ResponseWriter, r *http.Request, t tenant) {
	path, ok := roomPath(w, r, "/messages", false)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		q := url.Values{}
		for _, k := range []string{"before", "after", "limit"} {
			if v := r.URL.Query().Get(k); v != "" {
				q.Set(k, v)
			}
		}
		if len(q) > 0 {
			path += "?" + q.Encode()
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
	case http.MethodPost:
		body, ok := roomBody(w, r, 64<<10, roomMessageKeys)
		if !ok {
			return
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodPost, path, body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleRoomEvents — GET /api/rooms/{id}/events?after=: Lens's event stream, flushed to the browser as each event comes.
// Lens ends each stream after a while and the browser's EventSource reconnects with Last-Event-ID, which is passed on.
func (a *app) handleRoomEvents(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	path, ok := roomPath(w, r, "/events", false)
	if !ok {
		return
	}
	if after := r.URL.Query().Get("after"); after != "" {
		path += "?after=" + url.QueryEscape(after)
	}
	up, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.cfg.lensBaseURL+path, nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "lens upstream request"})
		return
	}
	up.Header.Set("Authorization", "Bearer "+t.token) // server-side only
	up.Header.Set("Accept", "text/event-stream")
	if id := r.Header.Get("Last-Event-ID"); id != "" {
		up.Header.Set("Last-Event-ID", id)
	}
	resp, err := a.streamClient.Do(up)
	if err != nil {
		if r.Context().Err() == nil {
			writeUpstreamFailure(w, "lens", err)
		}
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		var refusal struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(raw, &refusal) != nil || refusal.Error == "" {
			refusal.Error = "Lens refused this"
		}
		if resp.StatusCode < 400 || resp.StatusCode >= 500 {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not answer just now"})
			return
		}
		writeJSON(w, resp.StatusCode, map[string]string{"error": refusal.Error})
		return
	}
	// The server's write deadline would cut a stream Lens keeps open; Lens ends it itself.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	relayFlushing(w, resp.Body)
}

// handleRoomContributions — GET the room's contributions; POST proposes one.
func (a *app) handleRoomContributions(w http.ResponseWriter, r *http.Request, t tenant) {
	path, ok := roomPath(w, r, "/contributions", false)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
	case http.MethodPost:
		body, ok := roomBody(w, r, 256<<10, roomContributionKeys)
		if !ok {
			return
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodPost, path, body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleRoomContribution — GET one contribution; PATCH {status} accepts or rejects it.
func (a *app) handleRoomContribution(w http.ResponseWriter, r *http.Request, t tenant) {
	path, ok := roomPath(w, r, "", true)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
	case http.MethodPatch:
		body, ok := roomBody(w, r, 1<<10, roomDecisionKeys)
		if !ok {
			return
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodPatch, path, body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPatch)
	}
}

// handleRoomFork — POST /api/rooms/{id}/contributions/{cid}/fork.
func (a *app) handleRoomFork(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	path, ok := roomPath(w, r, "/fork", true)
	if !ok {
		return
	}
	body, ok := roomBody(w, r, 256<<10, roomForkKeys)
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, path, body, "")
}

// handleRoomVote — PUT /api/rooms/{id}/contributions/{cid}/vote {value}.
func (a *app) handleRoomVote(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w, http.MethodPut)
		return
	}
	path, ok := roomPath(w, r, "/vote", true)
	if !ok {
		return
	}
	body, ok := roomBody(w, r, 1<<10, roomVoteKeys)
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPut, path, body, "")
}

// handleRoomRun — POST /api/rooms/{id}/runs: a member runs a contribution or a listing, on the room or on themself. It
// may call models for minutes, as a marketplace use does, so it carries the use's bound rather than the shared client's.
func (a *app) handleRoomRun(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	path, ok := roomPath(w, r, "/runs", false)
	if !ok {
		return
	}
	body, ok := roomBody(w, r, 256<<10, roomRunKeys)
	if !ok {
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(marketUseTimeout + 10*time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), marketUseTimeout)
	defer cancel()
	a.marketRelay(w, r.WithContext(ctx), marketUseClient, t.token, http.MethodPost, path, body,
		"Paid listings cannot be used on this deployment yet: it has no marketplace bill to put them on.")
}

// B32.55 — room settings. Lens's members, terms, invites and prizes (B32.28, B32.29, B32.35), relayed the same way, on
// the session's workspace token:
//
//	PATCH  /api/rooms/{id}/members/{ws}           {role, may_spend, remove}: the owner or an editor changes a member
//	PUT    /api/rooms/{id}/terms                  {split_rule, remix_share_bps, default_price_usd_micros, spend_policy}:
//	                                              the owner sets the room's next terms version
//	GET    /api/rooms/{id}/invites                the room's invites, never a link's token
//	POST   /api/rooms/{id}/invites                {max_uses, expires_at}: an invite link, its token shown this once
//	DELETE /api/rooms/{id}/invites/{iid}          revokes it; the link then answers 404
//	GET    /api/rooms/{id}/prizes                 the room's prizes: open, awarded and closed
//	POST   /api/rooms/{id}/prizes                 {title, criteria, amount_usd_micros, deadline}: the owner posts one
//	POST   /api/rooms/{id}/prizes/{pid}/award     {contribution_id}: the owner awards it, a purchase on the owner's bill
//	GET    /api/room-invites/{token}              what a live invite link opens: the room, its terms, what is left of it
//	POST   /api/room-invites/{token}/join         {terms_version}: join through the link, accepting the terms
//
// The room wallet's budget and rules are Agent Wallets' own routes (/api/agents/{id}/rules) on the wallet's agent, and
// its approvals reach the owner's /api/agents/approvals. Lens decides who may do each — the owner, or an editor for
// members and invites — and a refusal reaches the screen with Lens's sentence.

var (
	roomMemberKeys = map[string][]string{"role": nil, "may_spend": nil, "remove": nil}
	roomTermsKeys  = map[string][]string{"split_rule": nil, "remix_share_bps": nil, "default_price_usd_micros": nil, "spend_policy": nil}
	roomInviteKeys = map[string][]string{"max_uses": nil, "expires_at": nil}
	roomPrizeKeys  = map[string][]string{"title": nil, "criteria": nil, "amount_usd_micros": nil, "deadline": nil}
	roomAwardKeys  = map[string][]string{"contribution_id": nil}
)

// roomSub is Lens's path for /v1/rooms/{id}/<kind>/{<param>}<rest>, from the request's {id} and its <param>.
func roomSub(w http.ResponseWriter, r *http.Request, kind, param, what, rest string) (string, bool) {
	path, ok := roomPath(w, r, "/"+kind, false)
	if !ok {
		return "", false
	}
	sub, ok := pathID(w, what, r.PathValue(param))
	if !ok {
		return "", false
	}
	return path + "/" + url.PathEscape(sub) + rest, true
}

// handleRoomMember — PATCH /api/rooms/{id}/members/{ws}.
func (a *app) handleRoomMember(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPatch {
		methodNotAllowed(w, http.MethodPatch)
		return
	}
	path, ok := roomSub(w, r, "members", "ws", "workspace id", "")
	if !ok {
		return
	}
	body, ok := roomBody(w, r, 1<<10, roomMemberKeys)
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPatch, path, body, "")
}

// handleRoomTerms — PUT /api/rooms/{id}/terms.
func (a *app) handleRoomTerms(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPut {
		methodNotAllowed(w, http.MethodPut)
		return
	}
	path, ok := roomPath(w, r, "/terms", false)
	if !ok {
		return
	}
	body, ok := roomBody(w, r, 4<<10, roomTermsKeys)
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPut, path, body, "")
}

// handleRoomInvites — GET the room's invites; POST makes an invite link.
func (a *app) handleRoomInvites(w http.ResponseWriter, r *http.Request, t tenant) {
	path, ok := roomPath(w, r, "/invites", false)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
	case http.MethodPost:
		body, ok := roomBody(w, r, 1<<10, roomInviteKeys)
		if !ok {
			return
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodPost, path, body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleRoomInvite — DELETE /api/rooms/{id}/invites/{iid} revokes an invite.
func (a *app) handleRoomInvite(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w, http.MethodDelete)
		return
	}
	path, ok := roomSub(w, r, "invites", "iid", "invite id", "")
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodDelete, path, nil, "")
}

// handleRoomPrizes — GET the room's prizes; POST posts one.
func (a *app) handleRoomPrizes(w http.ResponseWriter, r *http.Request, t tenant) {
	path, ok := roomPath(w, r, "/prizes", false)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.marketRelay(w, r, a.client, t.token, http.MethodGet, path, nil, "")
	case http.MethodPost:
		body, ok := roomBody(w, r, 64<<10, roomPrizeKeys)
		if !ok {
			return
		}
		a.marketRelay(w, r, a.client, t.token, http.MethodPost, path, body, "")
	default:
		methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
	}
}

// handleRoomPrizeAward — POST /api/rooms/{id}/prizes/{pid}/award {contribution_id}: a purchase of the winning
// contribution on the owner's marketplace bill, so it says so when this deployment has no bill to put it on.
func (a *app) handleRoomPrizeAward(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	path, ok := roomSub(w, r, "prizes", "pid", "prize id", "/award")
	if !ok {
		return
	}
	body, ok := roomBody(w, r, 1<<10, roomAwardKeys)
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, path, body,
		"Prizes cannot be awarded on this deployment yet: it has no marketplace bill to put them on.")
}

// handleRoomInvitePreview — GET /api/room-invites/{token}: what a live link opens; 404 once it is revoked, expired or
// used up.
func (a *app) handleRoomInvitePreview(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	token, ok := pathID(w, "invite", r.PathValue("token"))
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodGet, "/v1/room-invites/"+url.PathEscape(token), nil, "")
}

// handleRoomInviteJoin — POST /api/room-invites/{token}/join {terms_version}.
func (a *app) handleRoomInviteJoin(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	token, ok := pathID(w, "invite", r.PathValue("token"))
	if !ok {
		return
	}
	body, ok := roomBody(w, r, 4<<10, roomJoinKeys)
	if !ok {
		return
	}
	a.marketRelay(w, r, a.client, t.token, http.MethodPost, "/v1/room-invites/"+url.PathEscape(token)+"/join", body, "")
}
