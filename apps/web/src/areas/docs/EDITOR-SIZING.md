# The editor — investigation, not implementation

Read from **talyvor-docs @ `e0cf605`**: `internal/collab/` (ot.go, handler.go, access.go, saver.go),
`internal/editsession/`, `internal/model/model.go`, and the discarded frontend
(`frontend/src/hooks/useCollab.ts`, `useEditor.ts`, `components/editor/{Editor.tsx,schema.ts}`).
Per the area brief this is a sizing report; nothing editor-shaped ships in this PR.

## What the server actually does

**Storage.** `pages.content` is a string of **ProseMirror doc JSON**; `content_text` is the
plain-text projection for search (model.go: "Content is the canonical ProseMirror JSON"). The
server never parses or validates `content` — "servers ship without a ProseMirror runtime" (ot.go).
The schema contract lives entirely client-side, in the discarded frontend's `schema.ts`
(323 lines): nodes `paragraph · blockquote · horizontal_rule · heading · code_block(lowlight) ·
image · hard_break · ordered_list · bullet_list · list_item`, marks `link · em · strong ·
underline · strike · code · highlight`. No tables, no task lists.

**Wire protocol.** One WS per page: `GET /v1/collab/{pageID}/ws?client_id=&member_name=`
(gorilla/websocket, inside the gatewayauth boundary). JSON text frames:

- client → server: `{type:"change", change:{id, version, ops[], snapshot}}` ·
  `{type:"cursor", cursor:{from,to}}` · `{type:"ping"}`
- server → client: `init {version, presence[]}` · `change {change, version}` · `ack {id, version}` ·
  `cursor {client_id, cursor}` · `presence {event: joined|left, client}` ·
  `change_rejected {reason}` · `pong`

**The tier gate (#36).** `ResolveSession(ctx, pageID)` runs BEFORE the upgrade and yields
`(inScope, actor, canEdit)`: out-of-workspace → 404 with no socket; the caller's member id comes
from the verified gateway context (never a query param); `canEdit` is resolved ONCE at connect and
gates every `change` frame — a viewer stays connected for presence/cursors but gets
`change_rejected`, fail-closed if no resolver is wired. A second guard (pagelock/doc_status)
rejects changes the same non-disconnecting way.

**The critical finding — the OT machinery is dead wire-weight.** The engine implements positional
OT (insert/delete/retain/replace at flat integer positions, transform against the last 100
changes)… and the shipped client **never uses it**: `Editor.tsx` sends
`{ops: [], snapshot: <entire PM doc JSON>}` on every change (its own comment: "We send the full
snapshot rather than ops — the server treats the snapshot as the authoritative replicated state;
the ops array is a forward-compat hook"). Remote side applies `change.snapshot` wholesale. The
server can't derive documents from ops anyway (no PM runtime) — it stores whatever snapshot
arrived last; an `AutoSaver` flushes engine snapshots to Postgres every 5s. So the deployed
"collaboration" is **whole-document last-writer-wins at keystroke-debounce granularity, plus
presence and cursors**. Two people typing concurrently clobber each other's in-flight edits;
`version` is a monotonic counter used for acks, not convergence. The server's own model.go says the
real plan is "Phase 2's collaborative editor will move to a per-block CRDT model".

**Single-writer already exists server-side (Option A).** `internal/editsession`:
`POST …/editsession` (acquire) · `POST …/editsession/heartbeat` · `POST …/editsession/takeover` ·
`DELETE …/editsession` (release) · `GET …/editsession` (View-tier read). Plus soft locks
(`internal/pagelock`) and the approval `doc_status` freeze. A single-user editor composes with
these today, no server work.

## Answers

**Q1 — is the wire protocol client-implementable?** Yes, trivially — 3 inbound + 7 outbound JSON
frame shapes over a plain WebSocket; the discarded client's protocol layer (`useCollab.ts`) is
~220 lines and carries zero ProseMirror imports. The protocol is NOT coupled to the editor
library. The coupling sits in the **stored content format**: whatever renders or edits must speak
the `schema.ts` node/mark set above. One real infrastructure prerequisite: the WS lives behind
gatewayauth and a browser cannot send `X-Gateway-Auth` on a WebSocket — the BFF must terminate the
browser socket and dial upstream with the secret (small, but a shared-file/BFF PR).

**Q2 — which editor?** **ProseMirror-family, argued from the data:** every stored page is PM doc
JSON in a client-owned schema; the server will neither convert nor validate. Raw ProseMirror
(what the discarded frontend used — `prosemirror-model/state/view/…`) ports `schema.ts` verbatim:
zero translation risk, smallest dependency set, and the old editor code is a working reference.
TipTap is acceptable sugar (it IS ProseMirror; StarterKit ≈ this node set) at the cost of mapping
its extension names onto the stored schema exactly — worth it only if we want its UI ecosystem.
**Lexical (or Slate, etc.) is disqualified by the data**: different document model, so every read
and write crosses a lossy converter both ways, forever, for zero server-side benefit. If a CRDT
future arrives (the server's own stated Phase-2 direction), y-prosemirror keeps the same editor
and swaps the sync layer — choosing PM now does not paint us into a corner.

**Q3 — smallest useful first step, and the arcs to real collaboration.**

- **Arc 0 (this PR, done): read-only rendering.** The stored format is JSON; reading needs no
  editor at all. `pm.tsx` (~200 lines, zero deps) renders the full stored schema with loud
  degradation on unknown nodes. Goes live the moment BFF Tier 1 lands.
- **Arc 1: single-user editing, no collaboration — the smallest honest editor.** PM with the
  ported schema, save via `PATCH …/pages/{pageID}` (`content` + `content_text`), wrapped in the
  existing editsession acquire/heartbeat/release + takeover UI. Needs BFF write routes (breaks the
  read-only posture — a deliberate decision, not a code problem) and ~1 PR of editor UI. This is
  most of the user value: Docs is a wiki, and the server is already built for one writer at a time.
- **Arc 2: presence + live refresh (cheap, honest).** Speak the WS protocol read-only: presence
  avatars, cursors, and re-render on incoming snapshots. Needs the BFF WS proxy. No convergence
  claims — it renders what the server already does.
- **Arc 3: "collaborative" as currently shipped (snapshot LWW).** Send snapshots on edit like the
  discarded client. Two-editor clobber risk is real but bounded by editsession/locks if Arc 1's
  discipline stays on. Small client delta over Arc 2 — the honest label is "live co-presence with
  last-writer-wins", not "collaborative editing".
- **Arc 4: real concurrent editing — a server project, not a client one.** Either implement true
  OT end-to-end (client maps PM steps ↔ positional ops, all clients apply transformed ops; the
  server's naive position-shift transform has no test corpus against PM's coordinate space, and
  the server still can't verify convergence it never computes) — or follow the server's own plan
  and move to per-block CRDT (Yjs + y-prosemirror + a persistence/awareness endpoint in Go). Both
  obsolete the `ops:[]` protocol rather than extend it. Size: multiple PRs across two repos, plus
  migration of stored content into whatever the CRDT persists. This is the arc to cost before
  promising "Google-Docs-style" anything.

**Recommendation.** Land BFF Tier 1 → this area reads live. Then Arc 1 (single-user PM editor +
editsession) as the first editor PR; it is small, matches what the server actually supports, and
every later arc builds on its schema port. Treat Arc 4 as its own budgeted project.
