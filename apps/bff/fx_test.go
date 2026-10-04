package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The ECB's daily file, trimmed to three currencies but in its real shape and namespaces.
const ecbDailySample = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
	<Cube>
		<Cube time='2026-10-02'>
			<Cube currency='USD' rate='1.1672'/>
			<Cube currency='JPY' rate='172.31'/>
			<Cube currency='GBP' rate='0.8354'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`

// B28.22: /api/fx serves the day's USD and GBP per euro from the ECB file, and reads it once per hour.
func TestFXServesECBRates(t *testing.T) {
	reads := 0
	ecb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reads++
		_, _ = io.WriteString(w, ecbDailySample)
	}))
	defer ecb.Close()
	a := newTestApp(t, nil)
	a.fxSource = ecb.URL

	for range 2 {
		rec := httptest.NewRecorder()
		a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/fx", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /api/fx = %d %s", rec.Code, rec.Body)
		}
		var got fxRates
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got != (fxRates{RateDate: "2026-10-02", USDPerEUR: 1.1672, GBPPerEUR: 0.8354}) {
			t.Fatalf("rates = %+v", got)
		}
	}
	if reads != 1 {
		t.Fatalf("the ECB file was read %d times for two requests; want once", reads)
	}
}

// A file the BFF cannot read is a 503, never a rate — the screen then shows dollars alone.
func TestFXUnreadableIs503(t *testing.T) {
	ecb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `<Cube><Cube time='2026-10-02'><Cube currency='JPY' rate='172.31'/></Cube></Cube>`)
	}))
	defer ecb.Close()
	a := newTestApp(t, nil)
	a.fxSource = ecb.URL
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/fx", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /api/fx with no USD or GBP rate = %d %s; want 503", rec.Code, rec.Body)
	}
}
