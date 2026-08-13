package main

import (
	"io"
	"net/http"
	"strings"
)

// maxDocsAskBody caps an ask-AI request. It is deliberately MUCH smaller than maxDocsBody: that
// cap exists for a ProseMirror document on its way to a page write, and a question is not a
// document. Docs validates the payload itself; this only bounds what is buffered on the way
// through, and bounds it at the size of the thing actually being sent.
const maxDocsAskBody = 8 << 10

// docsAskAI — POST /api/docs/ai/ask → POST /v1/workspaces/{ws}/ai/ask on the Docs upstream.
//
// ⚠ THIS IS THE FIRST BROWSER CONTROL FOR ANY AI FEATURE IN THIS PRODUCT. Docs ships eight of
// them (write, transform, translate, ask, suggest-title, plus search) and until now every one was
// reachable only by curl: no route here named `/ai/`, and no file under apps/web/src did either.
//
// ⚠ THE UPSTREAM PATH IS WORKSPACE-SCOPED AND THE WORKSPACE IS THE SESSION'S. Docs registers
// `/workspaces/{wsID}/ai/ask` (internal/ai/handler.go Mount) and authorizes {wsID} against the
// caller's membership before the question reaches the engine. The id is never read from the body
// — a workspace the browser could name is a workspace the browser could choose, which is the rule
// docsSpaceCreateBody exists for.
//
// ⚠ THE BODY GOES UP VERBATIM, including fields this file does not know. Docs owns the schema
// (`{"question": …}` today); re-encoding here would invent a second schema to drift from. The one
// thing this handler does that forwardProduct would not is read the body first, so an oversize
// request is refused as 413 rather than failing inside the forward and being reported as
// "docs upstream unreachable" — a false statement about a healthy upstream.
//
// ⚠ COST. This operation is metered by Lens and attributed to NO PAGE, by upstream design:
// Engine.AskDocs passes an empty page id ("an answer drawn from several pages belongs to none of
// them"), so nothing lands in page_ai_spend_events and no page's own_ai_cost_usd moves. Its cost
// is visible only in the workspace's Lens spend under the feature tag `docs-ai-ask`. Any screen
// that wants to show what an answer cost must say that, and must not read it off a page.
func (a *app) docsAskAI() http.HandlerFunc {
	return a.requireSession(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodPost)
			return
		}
		ws, ok := a.docsWorkspaceFor(w, r)
		if !ok {
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxDocsAskBody))
		if err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
				"error": "question too large"})
			return
		}
		a.forwardProduct(w, r, "docs", a.cfg.docsBaseURL, a.cfg.docsGatewaySecret,
			docsWorkspacePath(ws, "/ai/ask"), "", http.MethodPost,
			strings.NewReader(string(raw)), nil)
	})
}
