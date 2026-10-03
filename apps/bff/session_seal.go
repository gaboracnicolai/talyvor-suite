package main

// session_seal.go — B17.40: a deploy of the app no longer signs everyone out.
//
// The session map is in memory (auth.go, ttlMap), so every restart of this process — and the
// deploy loop restarts it on every merge to main — signed out every browser at once. The e2e run
// of 2026-10-03 measured it: the BFF was redeployed three minutes into the run and every user
// then mid-journey was refused 401 ("This session is no longer signed in") or shown the sign-in
// page, on screens that had nothing wrong with them.
//
// THE FIX: the session id IS the session, sealed. The cookie carries an AES-256-GCM sealed copy of
// the session as it was created; the map stays the source of truth while the process lives. When
// an id is not in the map, the seal is opened and the session restored under the same id — but
// only one this process could not have seen end:
//
//   - ISSUED BEFORE THIS PROCESS STARTED. A seal issued by THIS process and missing from the map
//     was ended here (sign-out, a new sign-in in the same browser, expiry); restoring it would
//     undo that.
//   - NOT ENDED SINCE. A restored session that then signs out is remembered as ended until it
//     would have expired anyway, so the same cookie cannot restore it twice.
//   - NOT EXPIRED. The seal carries the session's own expiry.
//
// ⚠ WHAT IT CANNOT DO: a session signed out in one process and presented again (a copy of the
// cookie) after a restart is restored — the sign-out lived only in the memory that the restart
// cleared. That is the same exposure as a copied cookie before sign-out, bounded by the session's
// own expiry, and it is the price of keeping no store on disk.
//
// THE KEY is derived from LENS_PROVISION_SECRET, which the BFF already requires to start and
// keeps across restarts; nothing new to configure. Only the fields a request needs are sealed.
// What changes during a session is re-derived after a restore: an expired Lens token is
// re-provisioned (tenant.go), an empty Track workspace is re-asked (track_tenant.go), and the
// pooling question is not put again.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// sealPrefix marks a sealed session id; a random id (no sealer) never starts with it.
const sealPrefix = "s1."

type sessionSealer struct {
	aead     cipher.AEAD
	bootedAt time.Time
	maxLife  time.Duration // how long an ended id is remembered: no session outlives it

	mu    sync.Mutex
	ended map[string]time.Time
}

// newSessionSealer returns nil when there is no secret to derive a key from; sessions are then
// in memory only, as before.
func newSessionSealer(secret string, maxLife time.Duration) *sessionSealer {
	if secret == "" {
		return nil
	}
	if maxLife <= 0 {
		maxLife = 24 * time.Hour
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("talyvor-bff session seal v1"))
	block, err := aes.NewCipher(mac.Sum(nil))
	if err != nil {
		return nil
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil
	}
	return &sessionSealer{aead: aead, bootedAt: time.Now(), maxLife: maxLife, ended: map[string]time.Time{}}
}

// sealedSession is what the cookie carries.
type sealedSession struct {
	Issued      int64  `json:"iat"`
	Expires     int64  `json:"exp"`
	Sub         string `json:"sub"`
	Email       string `json:"em,omitempty"`
	WorkspaceID string `json:"ws"`
	LensToken   string `json:"tok"`
	TokenExp    int64  `json:"tke,omitempty"`
	TrackWS     string `json:"tws,omitempty"`
	Poolable    bool   `json:"pool,omitempty"`
	Synthetic   bool   `json:"syn,omitempty"`
}

// seal returns a new session id carrying s.
func (z *sessionSealer) seal(s session) (string, error) {
	p := sealedSession{
		Issued: time.Now().UnixNano(), Expires: s.expires.UnixNano(),
		Sub: s.sub, Email: s.email, WorkspaceID: s.workspaceID, LensToken: s.lensToken,
		TrackWS: s.trackWorkspaceID, Poolable: s.cachePoolable, Synthetic: s.synthetic,
	}
	if !s.lensTokenExp.IsZero() {
		p.TokenExp = s.lensTokenExp.UnixNano()
	}
	plain, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, z.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return sealPrefix + base64.RawURLEncoding.EncodeToString(z.aead.Seal(nonce, nonce, plain, []byte(sealPrefix))), nil
}

// open returns the session sealed in sid, if this process may restore it.
func (z *sessionSealer) open(sid string) (session, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(sid, sealPrefix))
	if !strings.HasPrefix(sid, sealPrefix) || err != nil || len(raw) < z.aead.NonceSize() {
		return session{}, false
	}
	n := z.aead.NonceSize()
	plain, err := z.aead.Open(nil, raw[:n], raw[n:], []byte(sealPrefix))
	if err != nil {
		return session{}, false
	}
	var p sealedSession
	if json.Unmarshal(plain, &p) != nil || p.Sub == "" || p.WorkspaceID == "" || p.LensToken == "" {
		return session{}, false
	}
	now := time.Now()
	if !time.Unix(0, p.Issued).Before(z.bootedAt) || !now.Before(time.Unix(0, p.Expires)) {
		return session{}, false
	}
	z.mu.Lock()
	_, ended := z.ended[sid]
	z.mu.Unlock()
	if ended {
		return session{}, false
	}
	s := session{
		sub: p.Sub, email: p.Email, expires: time.Unix(0, p.Expires),
		workspaceID: p.WorkspaceID, lensToken: p.LensToken,
		trackWorkspaceID: p.TrackWS, cachePoolable: p.Poolable, synthetic: p.Synthetic,
	}
	if p.TokenExp != 0 {
		s.lensTokenExp = time.Unix(0, p.TokenExp)
	}
	return s, true
}

// end remembers that sid was ended in this process, so its seal cannot bring it back.
func (z *sessionSealer) end(sid string) {
	if !strings.HasPrefix(sid, sealPrefix) {
		return
	}
	z.mu.Lock()
	defer z.mu.Unlock()
	now := time.Now()
	for k, until := range z.ended {
		if now.After(until) {
			delete(z.ended, k)
		}
	}
	z.ended[sid] = now.Add(z.maxLife)
}
