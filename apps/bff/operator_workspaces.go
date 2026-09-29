package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"
)

// operator_workspaces.go — B18.25: the operator screen's one read, behind requireOperator.
//
//	GET /api/admin/workspaces   one row per workspace: its name, spend this month and all time, requests,
//	                            the LENS it holds unsettled, and when it last made a request
//
// Four Lens reads on LENS_OPERATOR_READ_KEY, joined here by workspace id: the roster
// (/v1/admin/workspaces) for names, and B18.17's /v1/admin/workspaces/{spend,held,last-activity}. That
// key reaches Lens's cross-tenant GETs and nothing else — never a Lens admin key. Unset, this answers
// 501 saying which variable to set. Synthetic test workspaces are not in Lens's default audience, so
// they are not on the screen.

// operatorWorkspace is one row of the operator screen.
type operatorWorkspace struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	CreatedAt       *time.Time `json:"created_at"`
	CurrentMonthUSD float64    `json:"current_month_usd"`
	AllTimeUSD      float64    `json:"all_time_usd"`
	Requests        int64      `json:"requests"`
	HeldULENS       int64      `json:"held_ulens"`
	LastRequestAt   *time.Time `json:"last_request_at"`
}

// errLensRefusedKey is Lens answering 401 or 403 to the operator read key itself.
var errLensRefusedKey = errors.New("lens refused the operator read key")

// handleOperatorWorkspaces — GET /api/admin/workspaces.
func (a *app) handleOperatorWorkspaces(w http.ResponseWriter, r *http.Request, _ session) {
	if a.cfg.operatorReadKey == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "The operator screen is not connected: " +
			"set LENS_OPERATOR_READ_KEY in the web app's environment to the value Lens holds under the same name, and restart it."})
		return
	}
	var (
		roster []struct {
			ID        string     `json:"id"`
			Name      string     `json:"name"`
			CreatedAt *time.Time `json:"created_at"`
		}
		spend struct {
			Workspaces []struct {
				WorkspaceID     string  `json:"workspace_id"`
				CurrentMonthUSD float64 `json:"current_month_usd"`
				AllTimeUSD      float64 `json:"all_time_usd"`
				Requests        int64   `json:"requests"`
			} `json:"workspaces"`
		}
		held struct {
			Workspaces []struct {
				WorkspaceID string `json:"workspace_id"`
				HeldULENS   int64  `json:"held_ulens"`
			} `json:"workspaces"`
		}
		activity struct {
			Workspaces []struct {
				WorkspaceID   string     `json:"workspace_id"`
				LastRequestAt *time.Time `json:"last_request_at"`
			} `json:"workspaces"`
		}
	)
	paths := []string{
		"/v1/admin/workspaces",
		"/v1/admin/workspaces/spend",
		"/v1/admin/workspaces/held",
		"/v1/admin/workspaces/last-activity",
	}
	raws := make([][]byte, len(paths))
	errs := make([]error, len(paths))
	var wg sync.WaitGroup
	for i, path := range paths {
		wg.Add(1)
		go func(i int, path string) {
			defer wg.Done()
			raws[i], errs[i] = a.operatorRead(r.Context(), path)
		}(i, path)
	}
	wg.Wait()
	if errs[0] == nil {
		errs[0] = undecodable(json.Unmarshal(raws[0], &roster))
	}
	if errs[1] == nil {
		errs[1] = undecodable(json.Unmarshal(raws[1], &spend))
	}
	if errs[2] == nil {
		errs[2] = undecodable(json.Unmarshal(raws[2], &held))
	}
	if errs[3] == nil {
		errs[3] = undecodable(json.Unmarshal(raws[3], &activity))
	}
	for i, err := range errs {
		if err == nil {
			continue
		}
		log.Printf("bff: operator workspaces %s: %v", paths[i], err)
		switch {
		case errors.Is(err, errLensRefusedKey):
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens refused the web app's operator read key: " +
				"LENS_OPERATOR_READ_KEY here does not match the one Lens holds. Set both to the same value and restart them."})
		case errors.Is(err, errLensAnswered):
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Lens could not read every workspace just now. Try again."})
		default:
			writeUpstreamFailure(w, "lens", err)
		}
		return
	}

	byID := map[string]*operatorWorkspace{}
	row := func(id string) *operatorWorkspace {
		if ws, ok := byID[id]; ok {
			return ws
		}
		ws := new(operatorWorkspace)
		ws.ID = id
		byID[id] = ws
		return ws
	}
	for _, x := range roster {
		ws := row(x.ID)
		ws.Name, ws.CreatedAt = x.Name, x.CreatedAt
	}
	for _, x := range spend.Workspaces {
		ws := row(x.WorkspaceID)
		ws.CurrentMonthUSD, ws.AllTimeUSD, ws.Requests = x.CurrentMonthUSD, x.AllTimeUSD, x.Requests
	}
	for _, x := range held.Workspaces {
		row(x.WorkspaceID).HeldULENS = x.HeldULENS
	}
	for _, x := range activity.Workspaces {
		row(x.WorkspaceID).LastRequestAt = x.LastRequestAt
	}
	out := make([]operatorWorkspace, 0, len(byID))
	for _, ws := range byID {
		out = append(out, *ws)
	}
	// Most recently active first; a workspace that never made a request goes last.
	sort.Slice(out, func(i, j int) bool {
		li, lj := out[i].LastRequestAt, out[j].LastRequestAt
		switch {
		case li != nil && lj != nil && !li.Equal(*lj):
			return li.After(*lj)
		case (li == nil) != (lj == nil):
			return li != nil
		}
		return out[i].ID < out[j].ID
	})
	writeJSON(w, http.StatusOK, map[string]any{"workspaces": out})
}

// errLensAnswered is Lens answering the read with something other than 2xx JSON.
var errLensAnswered = errors.New("lens answered the operator read with an error")

// undecodable marks a Lens answer that was 2xx but not the JSON the operator screen reads.
func undecodable(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%w: %v", errLensAnswered, err)
}

// operatorRead GETs one of Lens's cross-tenant reads on the operator read key and answers its body.
func (a *app) operatorRead(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.cfg.lensBaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+a.cfg.operatorReadKey) // server-side only
	req.Header.Set("Accept", "application/json")
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return nil, fmt.Errorf("%w (%d)", errLensRefusedKey, resp.StatusCode)
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		return nil, fmt.Errorf("%w: %d", errLensAnswered, resp.StatusCode)
	}
	return raw, nil
}
