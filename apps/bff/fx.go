package main

import (
	"encoding/xml"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// fx.go — B28.22: GET /api/fx, the euro reference rates the wallet screens need to show an LXC amount in
// pounds or euros beside its dollars. Dollars alone need only Lens's peg (/api/lxc/topup-options); a
// pound figure needs one more fact, how many dollars and pounds a euro buys, and Lens serves that on no
// route. So the BFF reads the same source Lens prices card authorisations at (talyvor-lens
// internal/ecbrate): the European Central Bank's daily file.
//
//	{"rate_date":"2026-10-02","usd_per_eur":1.1672,"gbp_per_eur":0.8354}
//
// Display only: nothing is charged or moved at this rate. A failed read answers 503 and is never cached,
// so the screen shows dollars alone rather than a pound figure nothing backs.

// ecbDailyURL is the ECB's file of the latest reference rates (the URL talyvor-lens ecbrate.DailyURL reads).
const ecbDailyURL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"

// fxTTL — the ECB publishes once a working day, so an hour-old copy is the day's rate.
const fxTTL = time.Hour

type fxRates struct {
	RateDate  string  `json:"rate_date"`
	USDPerEUR float64 `json:"usd_per_eur"`
	GBPPerEUR float64 `json:"gbp_per_eur"`
}

type fxReads struct {
	mu  sync.Mutex
	val fxRates
	at  time.Time
}

func (a *app) handleFX(w http.ResponseWriter, r *http.Request, _ tenant) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	a.fx.mu.Lock()
	defer a.fx.mu.Unlock()
	if a.fx.at.IsZero() || time.Since(a.fx.at) >= fxTTL {
		rates, ok := a.readECB(r)
		if !ok {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "exchange rates could not be read just now"})
			return
		}
		a.fx.val, a.fx.at = rates, time.Now()
	}
	writeJSON(w, http.StatusOK, a.fx.val)
}

// readECB reads the daily file. Any failure — unreachable, non-200, malformed, or a rate that is not a
// positive number — is ok=false.
func (a *app) readECB(r *http.Request) (fxRates, bool) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, a.fxSource, nil)
	if err != nil {
		return fxRates{}, false
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return fxRates{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return fxRates{}, false
	}
	return parseECBDaily(io.LimitReader(resp.Body, 256<<10))
}

// parseECBDaily reads the eurofxref file: <Cube><Cube time="…"><Cube currency="USD" rate="…"/>….
func parseECBDaily(body io.Reader) (fxRates, bool) {
	var doc struct {
		Cube struct {
			Days []struct {
				Time  string `xml:"time,attr"`
				Rates []struct {
					Currency string `xml:"currency,attr"`
					Rate     string `xml:"rate,attr"`
				} `xml:"Cube"`
			} `xml:"Cube"`
		} `xml:"Cube"`
	}
	if err := xml.NewDecoder(body).Decode(&doc); err != nil || len(doc.Cube.Days) == 0 {
		return fxRates{}, false
	}
	day := doc.Cube.Days[0]
	var usd, gbp float64
	for _, c := range day.Rates {
		v, err := strconv.ParseFloat(c.Rate, 64)
		if err != nil || !(v > 0) {
			continue
		}
		switch c.Currency {
		case "USD":
			usd = v
		case "GBP":
			gbp = v
		}
	}
	if day.Time == "" || !(usd > 0) || !(gbp > 0) {
		return fxRates{}, false
	}
	return fxRates{RateDate: day.Time, USDPerEUR: usd, GBPPerEUR: gbp}, true
}
