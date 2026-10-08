package main

import (
	"net/http"
	"strings"
	"testing"
)

// B32.61 — the Discover screen's search reaches Lens with the filters Lens reads and nothing else, a kind Lens does not
// list is refused before Lens is asked, and a collection is read by its id.
func TestMarketDiscoverySearchRelaysOnlyLensFilters(t *testing.T) {
	a, f := newFakeLensMarket(t)
	doJSON(a, http.MethodGet, "/api/marketplace/search?capability=extract&max_price_per_use=50000&kind=prompt&verified_only=true&sort=new&page=2&workspace_id=ws_other", "")
	if rec := doJSON(a, http.MethodGet, "/api/marketplace/search?kind=anything", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("a search of an unknown kind = %d, want 400", rec.Code)
	}
	doJSON(a, http.MethodGet, "/api/marketplace/collections/col_1", "")
	if len(f.got) != 2 {
		t.Fatalf("Lens received %d requests, want 2: %q", len(f.got), f.got)
	}
	if want := "GET /v1/marketplace/search?capability=extract&kind=prompt&max_price_per_use=50000&page=2&sort=new&verified_only=true "; !strings.HasPrefix(f.got[0], want) {
		t.Fatalf("Lens received %q, want %q", f.got[0], want)
	}
	if !strings.HasPrefix(f.got[1], "GET /v1/marketplace/collections/col_1 ") {
		t.Fatalf("Lens received %q, want the collection col_1", f.got[1])
	}
}
