package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
)

// The LENS → LXC conversion: the exit that earned LENS did not have.
//
// ── WHAT WAS MISSING ────────────────────────────────────────────────────────
//
// Lens has had POST /v1/workspaces/{wsID}/lxc/convert and economy.ConvertLENStoLXC for a while.
// The BFF had no conversion code and the UI had none, so a workspace could EARN LENS from a pooled
// royalty and had no way to spend it: a balance with no exit. That matters more the moment the
// royalty actually pays, which is what the pool-royalty work was building toward.
//
// ── THREE FACTS THE SCREEN MUST HAVE BEFORE THE CLICK, ALL READ FROM SOURCE ─
//
//  1. THE RATE. economy.RateEngine.CurrentRate reads conversion_rate_history, falling back to
//     economy.Phase1FloorRate (1.0). It is LENS-per-LXC, and it CHANGES — so it is quoted from the
//     deployment rather than written into the bundle, the same reason the top-up amounts are.
//  2. THE MINIMUM. economy.MinConversionLXC = 100_000 µLXC (0.1 LXC). Below it the upstream
//     returns ErrConversionTooSmall, and a screen that lets you type 1 µLXC only to be refused has
//     wasted the round trip.
//  3. ⚠ IT IS ONE-WAY. There is NO LXC→LENS conversion anywhere in Lens — the reverse function
//     does not exist, not merely a flag that is off. LENS spent here cannot come back, so the
//     screen says so BEFORE the button, not in a toast afterwards.
//
// ── THE ROUNDING, AND WHY IT CANNOT CREATE VALUE ────────────────────────────
//
// The caller names the LXC it wants; Lens charges lensCost = MulCeil(lxcAmount, rate) and mints
// exactly lxcAmount. The LENS debit rounds UP (a charge to the holder, the sub-unit retained by
// the protocol) and the LXC credit is exact. So a conversion is never value-creating in either
// direction, and the BFF deliberately recomputes nothing: quoting a cost here that disagreed with
// what Lens charges would be a second source of truth for one number.

// convertQuote is what the screen needs to render the form honestly. Assembled here rather than
// passed through, because it is three facts from two upstream shapes plus one constant.
type convertQuote struct {
	LENSPerLXC     float64 `json:"lens_per_lxc"`
	USDPerLXC      float64 `json:"usd_per_lxc"`
	MinLXCMicros   int64   `json:"min_lxc_ulxc"`
	Reversible     bool    `json:"reversible"`
	ReversibleNote string  `json:"reversible_note"`
}

// minConversionULXC mirrors economy.MinConversionLXC. Duplicated deliberately and named so:
// the BFF cannot import Lens's internal package, and a screen that discovers the minimum by being
// refused is a worse experience than one that knows it.
//
// ⚠ WHAT PINS IT, STATED AFTER MEASURING RATHER THAN CLAIMED. This comment used to name a test as
// pinning the value "against the number Lens actually enforces". No such test existed, and NOTHING
// in this repo compares this constant to Lens — the BFF cannot import that package and CI does not
// check talyvor-lens out, so a cross-repo pin is not available here to write honestly.
//
// What DOES hold the value is incidental and worth knowing precisely, because it decides what a
// reader may rely on. The conversion tests post literal amounts either side of this boundary, so
// the constant cannot move without reding them — MEASURED by moving it: to 1 reds
// TestConvert_BelowMinimumRefusedBeforeDialing, and by a SINGLE micro-unit (100_001) reds
// TestConvert_AddressesTheSessionWorkspaceOnly and TestConvert_InsufficientLENSReachesTheScreen.
// So an ACCIDENTAL edit here is caught. DRIFT IN LENS IS NOT: if economy.MinConversionLXC changes,
// every test here stays green and this deployment quotes a minimum the upstream no longer
// enforces — the screen would then either refuse a conversion Lens would take, or promise one it
// would refuse after the round trip this constant exists to save.
//
// The one change that would close it lives in the other repo, exactly as with the top-up
// allow-list: serve the minimum on a public Lens route and read it here instead of copying it.
// Verified read-only against talyvor-lens `a04310a`: internal/economy/dualtoken.go declares
// MinConversionLXC = 100_000, so the copy is correct as of that commit — and that sentence is a
// dated observation, not a guarantee, which is the whole point of writing it this way.
const minConversionULXC int64 = 100_000

// handleConvertQuote — GET /api/lens/convert-quote. Reads the LIVE rate from Lens so the screen
// quotes what the deployment will actually charge, never a number baked into the bundle.
func (a *app) handleConvertQuote(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet,
		a.cfg.lensBaseURL+"/v1/economy/conversion-rate", nil)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "lens unreachable"})
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode != http.StatusOK {
		// The rate route is capability-gated upstream; a 404 there means the economy is off on
		// this deployment, which is a different thing from a broken conversion.
		writeJSON(w, resp.StatusCode, map[string]any{
			"error": "conversion rate unavailable on this deployment"})
		return
	}
	var up struct {
		Rate       float64 `json:"rate"`
		USDPerLXC  float64 `json:"usd_per_lxc"`
		LENSPerLXC float64 `json:"lens_per_lxc"`
	}
	if err := json.Unmarshal(raw, &up); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "unexpected upstream shape"})
		return
	}
	writeJSON(w, http.StatusOK, convertQuote{
		LENSPerLXC:   up.LENSPerLXC,
		USDPerLXC:    up.USDPerLXC,
		MinLXCMicros: minConversionULXC,
		Reversible:   false,
		ReversibleNote: "LENS converts to LXC and not back — there is no LXC→LENS conversion in " +
			"Lens. Converted LENS is spendable on inference and cannot be returned to a LENS balance.",
	})
}

// handleConvert — POST /api/lens/convert. Converts the SESSION's workspace's LENS into LXC.
//
// ⚠ THE WORKSPACE IS NEVER READ FROM THE REQUEST. The upstream path is lensWorkspacePath(t, …),
// exactly as the key routes and the checkout do: the only workspace this can ever address is the
// one on the session. The body carries one number and is sanitised by RECONSTRUCTION — decoded,
// re-encoded, and only that field forwarded — so a client cannot smuggle a workspace, a rate, or
// a LENS amount past this handler.
func (a *app) handleConvert(w http.ResponseWriter, r *http.Request, t tenant) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var in struct {
		LXCAmountULXC int64 `json:"lxc_amount_ulxc"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	// Refused HERE, before any dial — the same reason the top-up amount is: the upstream would
	// reject it anyway, and the caller learns it a round trip sooner with the minimum quoted.
	if in.LXCAmountULXC < minConversionULXC {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":        "below the minimum conversion",
			"min_lxc_ulxc": minConversionULXC,
		})
		return
	}

	body, err := json.Marshal(map[string]int64{"lxc_amount_ulxc": in.LXCAmountULXC})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "encode"})
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost,
		a.cfg.lensBaseURL+lensWorkspacePath(t, "/lxc/convert"), bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "lens upstream request"})
		return
	}
	req.Header.Set("Authorization", "Bearer "+t.token) // the SESSION's workspace token, server-side only
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "lens unreachable"})
		return
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	// Streamed verbatim on success: the upstream's ConvertResult already carries both new
	// balances, and re-deriving them here would be a second source of truth for the outcome of a
	// transaction this side did not run. A 402 (insufficient LENS) reaches the screen unchanged
	// so it can say WHICH thing was short.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(raw)
}
