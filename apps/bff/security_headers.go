package main

import "net/http"

// B28.247 — on every response, the app's pages included: no other site may frame it, an injected <base> or plugin
// cannot load, a form posts only here, and a link out sends no address from inside the app.
//
// ⚠ THE POLICY HAS NO script-src AND NO OTHER FETCH DIRECTIVE, ON PURPOSE. The chat canvas (Canvas.tsx) draws a
// model's HTML in a srcdoc frame, and a srcdoc frame inherits this policy: a script-src would stop the scripts the
// canvas exists to run, an img-src its pictures. Restricting scripts waits on the canvas having its own document.
const contentSecurityPolicy = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'"

func setSecurityHeaders(h http.Header) {
	h.Set("Content-Security-Policy", contentSecurityPolicy)
	h.Set("X-Frame-Options", "DENY")
	h.Set("Referrer-Policy", "same-origin")
}
