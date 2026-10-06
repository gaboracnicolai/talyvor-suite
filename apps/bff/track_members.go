package main

// B32.72 — /api/members: GET reads the roster (trackWorkspaceProxy), POST adds a member.
//
// The add goes to Track's owner-gated POST /v1/workspaces/{ws}/members on the SESSION's Track
// workspace — the body carries {email, role} and nothing in it can name a workspace. Track's answer
// is relayed unchanged: 201 the member, 402 Lens's seat refusal ({error, code, plan, limit, allows}),
// 409 MEMBER_EXISTS, 403 OWNER_REQUIRED, 503 SEATS_UNCHECKED. The Origin gate in ServeHTTP covers it
// like every write.
//
// X-Lens-Workspace is the session's Lens workspace — the one a /plans subscription is on — so Track
// can ask Lens about the plan that pays for the seat (B32.73). It is set here from the session and
// never copied from the browser: forwardProductWith builds a fresh request.

import "net/http"

// maxMemberBody bounds the add body: an email and a role.
const maxMemberBody = 4 << 10

func (a *app) trackMembers() http.HandlerFunc {
	list := a.trackWorkspaceProxy("/members", nil, nil)
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			list(w, r)
			return
		}
		ws, ok := a.trackWorkspaceFor(w, r)
		if !ok {
			return
		}
		extra := http.Header{"Content-Type": {"application/json"}}
		if s, ok := a.auth.sessionFrom(r); ok && s.workspaceID != "" {
			extra.Set("X-Lens-Workspace", s.workspaceID)
		}
		a.forwardProductWith(w, r, "track", a.cfg.trackBaseURL, a.cfg.trackGatewaySecret,
			trackWorkspacePath(ws, "/members"), "", http.MethodPost,
			http.MaxBytesReader(w, r.Body, maxMemberBody), nil, extra)
	})
}
