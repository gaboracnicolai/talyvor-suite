package main

import (
	"io"
	"net/http"
)

// B28.454 — the chat canvas's own document. The canvas (apps/web/src/areas/chat/Canvas.tsx) draws a model's HTML and
// must run its scripts; drawn in a srcdoc frame it would inherit the app's policy, whose script-src runs no script the
// app did not write. So it is drawn here: a page with its own policy, sandboxed — no origin, so it cannot read the app,
// its storage or its cookies — and framed only by the app. It draws the HTML the app posts it, and only while its
// origin is opaque: served without this policy, it draws nothing.
const canvasPolicy = "sandbox allow-scripts; frame-ancestors 'self'"

// Once it can be sent the HTML, the page tells the app so with Canvas.tsx's CANVAS_READY.
const canvasPage = `<!doctype html>
<meta charset="utf-8">
<script>
addEventListener('message', function (e) {
  if (self.origin !== 'null' || e.source !== parent || e.origin !== location.origin || typeof e.data !== 'string') return
  document.open()
  document.write(e.data)
  document.close()
})
parent.postMessage('talyvor-canvas-ready', '*')
</script>
`

func serveCanvas(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w, http.MethodGet+", "+http.MethodHead)
		return
	}
	w.Header().Set("Content-Security-Policy", canvasPolicy)
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.Method == http.MethodGet {
		_, _ = io.WriteString(w, canvasPage)
	}
}
