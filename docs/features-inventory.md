# Talyvor — every feature, where it works, how to see it working

B11.1. Read from the code of all five repositories and from the production box on 25 Sep 2026:
lens `e89a054`, suite `49127b4`, track `7ad05ce`, docs `5994a3b`, code `427a0b9`. Production flags
were read with `docker compose exec <svc> printenv` (names and set/empty only — no values).

**Status** is one of:

- **live** — on in production, and a screen in the Talyvor app shows it working.
- **live but no screen** — on in production (or on by default), and nothing in the app lets a
  customer use it or see it working. Reachable only by API, header or another tool.
- **locked** — present in the code, off in production. The row says why and what unlocks it.
- **retired** — removed on purpose; must not be offered to a customer.

"The app" means the Talyvor console, `apps/web` in this repository. Track and Docs have their own
older front ends in their repositories; they are not deployed, so a feature that only they expose
counts as having no screen.

---

## Straight answers to the questions that started this

**Tare — where does it work, and where can a customer test it?** It works on requests sent through
the Lens gateway (`/v1/proxy/*`), streamed and not, once a workspace turns it on in
**Workspace → Features** (off by default; `opt_in` means only requests carrying
`X-Talyvor-Tare: true`). It shrinks the *newest message* — JSON tool output, Go/TypeScript bodies,
logs — and leaves the rest byte-identical so provider prompt caching still hits. A short typed
question has almost nothing to reduce. **There is nowhere to test it and nowhere to see the saving:**
Lens records savings per request and serves them at `GET /v1/workspaces/{ws}/tare/savings`, and
nothing in the app reads that. B11.2 puts the figure on the Features row; B11.3/B11.4 build the
Try-it page.

**Document conversion — where does a customer upload a document and get the converted version?**
Nowhere, today. Conversion (Lens's `distill` policy) runs only on a document *attached to a model
request* through the gateway — streamed or buffered — and the app has no way to attach anything:
the chat has no file input. The switch is in **Workspace → Settings** and **Features**; Settings
shows how many conversions ran (a count, not a saving). Getting the converted file back is possible
only through the operator-only `/v1/admin/distill/preview`. B10.3 (chat attachments) and B11.3
(Try-it upload) are what make it usable.

**Chat** is built (`/chat`) and **refused in production**: Lens runs without
`LENS_SESSION_KEYS_ENABLED`, so the credential the chat needs cannot be minted (B10.1; the fix is
written into B10.7).

---

## 1. Lens — the gateway, billing and economy

Paths are Lens's. `M` = `cmd/lens/main.go`, `C` = `internal/config/config.go`,
`P` = `internal/proxy/proxy.go`. "lens.env" means the variable is not in `docker-compose.yaml`'s
`environment:` list and can only be set in the box's `lens.env`.

| Feature | What it does for the customer | Control and default | Where it takes effect | How a customer sees it working | Status | If locked: why, and what unlocks it |
|---|---|---|---|---|---|---|
| Model gateway | One key reaches OpenAI, Anthropic, Google, Bedrock, Mistral, Groq and vLLM. | API key with `proxy` scope (M:2160); provider keys per provider | `/v1/proxy/{provider}/*` (M:2161-2200) | Lens → Spend & routing (`/spend`), Overview | live | — |
| Helicone drop-in | Existing Helicone clients work unchanged (`Helicone-Auth`, `-Property-*` translated). | none, always on | `/oai/*`, `/anthropic/*` (M:2207-2208) | Same spend screens | live | — |
| Chat credential (session keys) | Lets the browser chat use a short-lived `tlv_sk_` key instead of a workspace key. | `LENS_SESSION_KEYS_ENABLED`, default **false** (C:2047); lens.env | `POST /v1/auth/session-keys` (M:762) | `/chat` answers | **locked** | Unset in production ⇒ route never registered ⇒ every chat send is refused. Unlock: B10.7 — forward it in `docker-compose.yaml` with default `true`. |
| API keys | Create, list and revoke scoped workspace keys. Rotation (begin/complete/abandon) exists too. | none | All authed routes | Lens → API keys (`/keys`); rotation has no screen | live | — |
| Setup snippets | Copy-paste configuration for tools, with a key made for it. | `LENS_PUBLIC_BASE_URL` on the BFF | — | Lens → Setup (`/setup`) | live | — |
| Sign-up and provisioning | Signing in for the first time creates a Lens workspace, a Track workspace and Docs membership. | `LENS_PROVISION_SECRET` (set); BFF `OIDC_ALLOWED_EMAILS` (`*` = open sign-up) | `POST /v1/provision` at login | `/signup`, `/signin` | live | — |
| Prepaid credit (LXC) on API-key traffic | Each API-key call reserves credit before and settles after; out of credit ⇒ 402. | `LENS_LXC_AGENT_ALLOCATION_ENABLED`, `LENS_LXC_RESERVATION_ENABLED`, default true (C:1674, 1680) | API-key requests (P:919-944) | Overview balances, Lens → Ledger, Billing | live | — |
| Credit gating for browser/session traffic | Blocks session-key and JWT calls the balance cannot cover. | `LENS_LXC_SHADOW_SPEND_ENABLED` + `LENS_LXC_GATING_ENABLED`, default false (C:1191-1192); lens.env | Non-key requests (P:901) | — | **locked** | Off ⇒ a chat answer is served and **charged 0** (measured in B9.1). Unlock: set both, a pricing decision. |
| Buy credit (Stripe top-up) | Pay by card for any amount; credit lands on the ledger. | `LENS_BILLING_ENABLED` (on in production) + Stripe keys (set) | `…/billing/checkout`, Stripe webhook | Billing → Plan & top up (`/billing`), Pricing (`/pricing`) | live | — |
| Subscription and monthly allowance | A plan with a monthly LXC allowance; cancel/resume. | `LENS_BILLING_SUBSCRIPTION_PRICE_ID`, `LENS_SUBSCRIPTION_ALLOWANCE_ULXC` — both **empty** in production | Allowance gate (P:908); `…/billing/subscribe`, `/subscription`, `/allowance` | `/billing` plan panel | **locked** | No price ID and no allowance set. Unlock: Nicolai sets both in `.env` (a price decision). |
| Admin credit grant | Operator grants comped credit. | `LENS_ADMIN_LXC_GRANT_ENABLED`, empty in production | `/v1/admin/lxc/grant` | — | **locked** | Operator switch; unlock by setting it. |
| Token economy — LENS wallet, earnings, convert LENS → LXC | Earn LENS (royalties), see what is held, convert to credit. | `LENS_ECONOMY_ENABLED` (on in production) | `…/tokens/*`, `…/earnings`, `…/lxc/convert` | Overview (balances, Convert), Lens → Earnings, Ledger | live | — |
| Marketplace and staking | List/buy patterns; stake LENS. | Economy on | `/v1/marketplace/*`, `…/tokens/stake` (M:3759-3850) | — | live but no screen | — |
| Pattern mining and annotation mints | Earn LENS for contributed patterns/annotations. | `LENS_PATTERN_MINING_ENABLED`, `LENS_ANNOTATION_MINTING_ENABLED`, empty in production | pattern opt-in returns 503 (M:3705) | — | **locked** | Unlock: set the flags. |
| Answer sharing (cross-tenant pool) and royalty | A question another consenting workspace already paid for is answered at 30% off list; the contributor earns half the charge as LENS. | Workspace `cache_poolable` (default true for new workspaces); global `LENS_CACHE_POOLABLE_ENABLED` + `LENS_POOL_ROYALTY_MINTING_ENABLED` (on); attestation gate (M:596) | Private-cache misses where both workspaces opted in (P:1103-1130); `X-Talyvor-Pool-*` headers | Switch: Workspace → Settings and first-login consent. Evidence: Lens → Earnings, cache hits on Overview/Spend | live | B9.1 measured it on in production (attested at 0.92, 8/8 workspaces opted in, 6 pooled serves ever). A chat (session-key) serve is charged 0 and mints 0. |
| Exact cache (+ warmer) | An identical repeat prompt is answered free from cache. | none; TTL `LENS_MAX_CACHE_TTL` 24h | Chat-completion requests, per workspace (P:757, 1086); not cached with PII | Cache card on Spend, cache hits on Overview | live | — |
| Semantic cache | A near-identical prompt is answered from cache. | `LENS_SEMANTIC_THRESHOLD` 0.98 | Same | Same card (`cache_hit_semantic`) | live | — |
| Anthropic prompt-cache auto-pin | Recurring system prompts get Anthropic `cache_control` automatically. | none (P:966-976) | Anthropic requests | Nothing shows it | live but no screen | — |
| Document conversion (distill) | Converts an attached document to compact Markdown before the model reads it, so fewer tokens are billed. | `distill_policy` `disabled` / `opt_in` / `always`: new workspaces get `always` (internal/workspace/distill_policy.go:34), older rows `disabled`; `opt_in` needs `X-Talyvor-Distill: true` | Only requests carrying an attached document (P:786-806); `X-Talyvor-Distill: applied` | Switch: Settings and Features. Settings shows a conversion **count**, no saving. No upload anywhere | live but no screen | Usable only by API. B10.3 (chat attachments) and B11.3 (Try-it) give it a screen. |
| Shared document conversions (`distill_poolable`) | Reuses another consenting workspace's conversion of the same document. | Workspace `PUT …/distill-poolable` (M:4312), default false. Global `LENS_DISTILL_POOLABLE_ENABLED` is **empty in production, which means on** — empty keeps the code default true (C:2074-2084); forced off only when the economy is off | Distill cache lookups where both sides opted in | Features shows the state with no switch; attribution is admin-only | live but no screen | The workspace switch has no control in the app (B11.2 wires it). |
| Tare | Shrinks the newest message (JSON tool output, Go/TS code bodies, logs) and keeps the prompt-cache prefix intact. | `tare_policy` `disabled` / `opt_in` / `always`, default disabled; `opt_in` needs `X-Talyvor-Tare: true` | Gateway requests, streamed and buffered (P:817-829); `X-Talyvor-Tare: applied`; per-request `tare_*` fields on the token-event row | Switch on Features. Savings at `GET …/tare/savings` (M:4178) — **nothing in the app reads it** | live but no screen | The switch works; the evidence has no screen (B11.2) and there is no Try-it (B11.3/B11.4). |
| Prompt rewriter (`compression_policy`) | Rewrote prompts to save tokens. | `PUT …/compression`, default disabled | Buffered requests only | Features still shows a row for it | **retired** | Saved nothing, altered prompts, replaced by Tare. B11.2 removes the row. |
| Cost-optimised routing | Lets Lens swap a named model for a cheaper one that fits. | `PUT …/cost-optimize-routing`, default false | Delegated requests; `X-Talyvor-Routed`, `-Route-Reason` | Switch on Features; spend by model on Spend | live | — |
| Auto-routing | Model `auto` (or `X-Talyvor-Auto-Route`) lets Lens choose. | per request | P:586 | Spend by model; `…/routing/recommendation` has no screen | live | — |
| Routing intelligence / routing brain | Model choice learned from pooled outcomes. | `LENS_ROUTING_INTELLIGENCE_ENABLED`, `…_TIER_COHORTS_ENABLED`, `LENS_ROUTING_BRAIN_ENABLED`, default false; lens.env | Auto-routed requests | — | **locked** | Unlock: set the flags (plus `LENS_PATTERN_CAPTURE_ENABLED`, empty in production). |
| Model catalog, vision redirect | Publishes priced models; image/audio requests go to a capable model. | `LENS_MODEL_CATALOG_OVERRIDES` | `/v1/catalog/models`; `X-Talyvor-Vision-Redirect` | Chat's model picker, `/pricing` | live | — |
| Input guardrails — prompt injection, personal data, topics, words | Blocks injection attempts; keeps personal data out of logs and cache. | Default policy on (internal/guardrails/engine.go:160-169); per-workspace `…/guardrails` | Every request, before the cache (P:1002-1050); `X-Talyvor-Guardrail-Blocked`, `-PII-Detected` | Features shows injection and PII on/off; no screen to change a policy or to test (`…/guardrails/test` exists) | live but no screen | — |
| Output guardrails | Redacts or blocks personal data and bad shapes in answers. | `LENS_GUARDRAILS_ENABLED`, default false (C:1200); lens.env | Non-streamed answers (P:1532-1560) | — | **locked** | Unlock: set it in `lens.env`. |
| Request logging / privacy | Keep full prompts, metadata only, or nothing. | `PUT …/logging`, default `metadata` | Every request; `X-Talyvor-Logging` | Features shows the level; changing it has no screen | live but no screen | — |
| Spend analytics | Cost and tokens by model, feature, team, request, API key. | Headers `X-Talyvor-Team/-Feature/-Sprint`, `-Request-ID` | All traffic unless logging is `none` | Spend shows by model, by feature and the month; by team / request / key have no screen | live | — |
| Git and work-item attribution | Cost per branch, PR, commit, author, repository, issue. | Headers `X-Talyvor-Branch/-PR/-Commit/-Author/-Repository/-Issue` | Every request; `X-Talyvor-Attributed` | `…/attribution/*` (M:4008-4048) — no screen; per-issue cost on Track is locked (see Track) | live but no screen | — |
| Agent sessions | Groups a multi-turn agent run and returns its running cost. | `X-Talyvor-Session`, `X-Talyvor-Agent` | Response `X-Talyvor-Session-Cost` | `/v1/sessions` — no screen | live but no screen | — |
| Budgets | Alert, or refuse with 402, when a workspace/team/sprint budget is spent. | `…/budgets` CRUD, modes off / alert / hard_block | Checked before every request (P:890) | Features says "Set in Lens — not shown here yet" | live but no screen | — |
| Forecast and cost anomalies | Month-end projection; flags cost spikes hourly. | none | Background (M:811) | `…/forecast`, `…/anomalies` — no screen | live but no screen | — |
| Spend alerts into Track | Lens pushes a spend alert to the issue's assignee in Track. | `LENS_TRACK_WEBHOOK_URL` — **empty** in production (Track's side is set) | Background | Track notifications (no screen either) | **locked** | Unlock: set `LENS_TRACK_WEBHOOK_URL` + `_SECRET` in `.env`. |
| ROI report | Savings-and-spend report for a manager. | per-engineer section `LENS_ROI_INCLUDE_ENGINEER_BREAKDOWN`, default false | `…/roi/report` | — | live but no screen | Per-engineer section locked (flag). |
| Tenant config bundle (spend cap, RPM/TPM, retention) | Meant to cap spend and rate per workspace. | `PUT …/config` | **Stored, never enforced** — nothing on the request path reads it (FOUND.md) | — | live but no screen | A cap set here does not protect anyone. |
| Workspace access policy | Restricts a workspace to chosen models/providers and a per-request token ceiling. | Only at admin registration `POST /v1/workspaces` | Every request (403 on violation) | — | live but no screen | — |
| Rate limits | Protects the gateway from bursts (100 rps / 1000 rpm). | Fixed; global RPM/TPM off | All routes; rate-limit headers | — | live but no screen | — |
| Reliability — retries, fallbacks, circuit breakers, key pool | Survives provider errors and per-key limits. | `LENS_RETRY_*`, `LENS_CB_*`; admin key pool | All requests; `X-Talyvor-Attempts`, `-Fallback-*` | — | live but no screen | — |
| Named, versioned prompts | Edit a prompt without redeploying; roll back. | `/v1/prompts` CRUD; system message `lens:prompt:<name>` | Every request (P:984-990) | — | live but no screen | — |
| Quality scoring and feedback | Scores each answer; keeps poor answers out of cache. | none | `X-Talyvor-Quality-Score` | `POST /v1/feedback`, `…/quality/stats` — no screen | live but no screen | — |
| Evals | Regression runs on datasets, scheduled or on demand. | `/v1/eval/*` | Runs on the operator's keys | — | live but no screen | — |
| A/B experiments | Create and analyse model experiments. | `…/experiments` | **Never assigns live traffic** (FOUND.md) | — | live but no screen | API only, and not connected to traffic. |
| Batch (half-price, async) | Queue non-urgent Claude calls at batch prices. | `LENS_BATCH_ENABLED`, default false; no settle hook | Routes absent (cmd/lens/batch_routes.go:43) | — | **locked** | Needs a billing settle hook, then the flag. ⚠ The `X-Talyvor-Batch` header path is ungated and unbilled (FOUND.md). |
| Local model offload | Simple prompts answered free by a local model. | `LENS_OLLAMA_URL`, `LENS_LOCAL_ENDPOINTS` | Only the workspace named `default` (internal/localrouter/router.go:146) | — | **locked** | Not reachable by a customer workspace; needs per-workspace routing. |
| Registered-node routing | Serves requests on registered compute nodes. | `LENS_NODE_AUTOROUTE_ENABLED`, default false; lens.env | `X-Talyvor-Node-Served` | — | **locked** | Unlock: set the flag. |
| Output verification, provenance, bonds | Verdicts and attribution for generated output; bonds. | `LENS_K4_VERIFIER_ENABLED`, `LENS_H5_*_ENABLED`, default false; lens.env | `X-Talyvor-Output-Id` | Overview asks `/api/bonds` and shows nothing when off | **locked** | Unlock: set the flags. |
| Audit export | Download audit records or push them to a SIEM. | on demand; scheduled push `LENS_AUDIT_EXPORT_URL` and pruning `LENS_AUDIT_RETENTION` off | `/v1/audit/export`, `/v1/audit/webhook` | Features' "Audit trail" links to the Ledger, not to the export | live but no screen | Scheduled push/pruning locked (unset). |
| MCP server (Lens) | Agents query spend, cache, sessions and routing over MCP. | none | `/mcp`, `/mcp/sse` | Setup has no MCP snippet | live but no screen | — |
| Status page, OpenAPI; dashboard | Public status and API spec; built-in dashboard. | `LENS_DASHBOARD_ENABLED`, default false | `/status`, `/openapi.json`; `/dashboard` | — | live but no screen | Dashboard locked (flag). |

## 2. Chat — `/chat` in this app

| Feature | What it does for the customer | Control and default | Where it takes effect | How a customer sees it working | Status | If locked: why, and what unlocks it |
|---|---|---|---|---|---|---|
| Streamed chat with the deployment's models | Ask any OpenAI- or Anthropic-wire model in the catalog; answers stream in. | none | BFF `POST /api/ai/stream/{provider}/…` → Lens session key → `/v1/proxy/*` | `/chat` | **locked** | Every send is refused: Lens's session-key route is off (B10.1). Unlock: B10.7. |
| Price per answer | "≈ 0.062 LXC · GPT-4o · 1,240 in / 312 out tokens" under each answer. | none | Computed in the browser from provider token counts × catalog rate | `/chat` | locked (with chat) | — |
| Conversation history | Conversations kept per signed-in account, newest first; rename, delete. | none | This browser only (localStorage), never the server | `/chat` left column | locked (with chat) | — |
| Keyboard | Enter sends, Shift+Enter new line; Stop ends an answer. | none | Composer | `/chat` | locked (with chat) | — |
| Attachments (where document conversion would work) | — | — | — | — | not built | B10.3. |

## 3. Track — issues

Production: Track's AI is wired to Lens (`TRACK_LENS_URL`, `TRACK_LENS_MINT_KEY` set);
`TRACK_LENS_API_KEY` is **empty**. Screens are in this app under Track.

| Feature | What it does for the customer | Control and default | Where it takes effect | How a customer sees it working | Status | If locked: why, and what unlocks it |
|---|---|---|---|---|---|---|
| Issues | Create, list, filter, edit; keyboard navigation (c, /, j/k, Enter, e). | none | Track `…/issues` | Track → Issues (`/track`), issue page | live | — |
| Comments | Comment on an issue. | none | `…/issues/{id}/comments` | Issue page | live | — |
| Export | Every issue the current view matches, as CSV or JSON. | none | In the browser, from the list | Track → Issues, Export | live | — |
| Teams | Teams with a key prefix (ENG-42). | none | `…/teams` | Team picker on Issues/Cycles | live | Creating a team has no screen. |
| Cycles | Start a cycle per team, add issues, see progress. | none | `…/teams/{t}/cycles` | Track → Cycles | live | Complete / burndown have no screen. |
| Projects | Create projects; set an issue's project; filter by project. | none | `…/projects` | Track → Projects, issue page | live | — |
| AI summary, find duplicates, triage suggestion | Summarises an issue, finds likely duplicates, suggests priority and labels. | `TRACK_LENS_URL` + `TRACK_LENS_MINT_KEY` (set) | `…/issues/{id}/summary`, `/find-duplicates`, `/triage` | Issue page | live | — |
| Issue search | Search from the issue list. | Lens variables | `…/issues/semantic-search` | Search box on Issues | live | The semantic index is never filled (ai/engine.go:651), so it always answers with full-text search. |
| AI cost per issue | What AI work on an issue cost, pulled from Lens every 15 minutes. | `TRACK_LENS_API_KEY` — **empty** in production (cmd/track/main.go:270) | Background pull; `…/issues/{id}/ai-costs` | Issue page region "What it has cost so far" — will always read "No AI spend recorded" | **locked** | Unlock: set `TRACK_LENS_API_KEY` to a Lens key with analytics scope. |
| Workflow statuses | Custom status columns per team. | none | `…/teams/{t}/statuses` | — | live but no screen | — |
| Labels | Workspace labels. | none | `…/labels` | — | live but no screen | — |
| Milestones and roadmap | Project milestones and a timeline. | none | `…/projects/{p}/milestones`, `…/roadmap` | — | live but no screen | — |
| Custom fields | Workspace-defined fields and required-field checks. | none | `…/custom-fields` | — | live but no screen | — |
| Relations and dependencies | Blocks/relates links, dependency graph. | none | `…/issues/{id}/relations` | — | live but no screen | — |
| Time tracking | Timer, manual entries, summaries. | none | `…/timer`, `…/time-entries` | — | live but no screen | — |
| Issue templates | Templates applied at create (defaults seeded). | none | `…/templates` | — | live but no screen | — |
| RICE/ICE prioritisation | Scores issues; prioritised backlog. | none | `…/issues/{id}/score`, `…/backlog/prioritized` | — | live but no screen | — |
| Analytics and CSV export | Velocity, burndown, distribution, resolution time, AI-cost trend, workload. | none | `…/analytics/*` | — | live but no screen | — |
| Member management | Owner adds members, changes roles, removes. | Owner only | `…/members` | Workspace → Members is read-only | live but no screen | — |
| Notifications inbox | Read and mark notifications. | none | `…/notifications` | — | live but no screen | Only Lens spend alerts create notifications, and those are locked. |
| Automation rules | Rules on issue/PR events: set fields, labels, create/close, Slack. | none | Runs on issue writes | — | live but no screen | The `scheduled` trigger is refused (automation/engine.go:80-84). |
| GitHub PR integration | "Fixes ENG-42" in a merged PR closes the issue. | `TRACK_GITHUB_WEBHOOK_SECRET`, `…_WORKSPACE_ID` — unset in production | `POST /v1/webhooks/github` | — | **locked** | Unlock: set both (serves one workspace only). |
| Guest access | Invite outside viewers/commenters for 7 days. | `TRACK_GUEST_SECRET` unset ⇒ links break on restart; `TRACK_INVITE_BASE_URL` defaults to localhost | `…/guests`, `/v1/invite/{token}` | — | live but no screen | No email is sent; unset secret makes links fragile. |
| Public feature boards | Public voting boards; turn a post into an issue. | per board | `…/boards`, `/v1/public/boards/…` | — | live but no screen | — |
| Import from Linear / Jira | CSV import, and background import jobs. | Live API import needs `TRACK_INTEGRATION_ENCRYPTION_KEY` (unset) | `/v1/import/*` | — | live but no screen | Import straight from the Linear/Jira API is locked (key unset). |
| Real-time updates | Live issue/comment events over WebSocket. | `TRACK_HA_ENABLED` false | `/v1/ws` | The app does not subscribe | live but no screen | Presence is a stub. |
| MCP server (Track) | 12 agent tools: issues, comments, sprint status, triage, AI costs. | Gateway auth | `/mcp` | — | live but no screen | — |

## 4. Docs — spaces and pages

Production: Docs's AI is wired to Lens (`DOCS_LENS_URL`, `DOCS_LENS_API_KEY` set) and its members
sync from Track (`DOCS_TRACK_URL`, `DOCS_TRACK_MEMBER_SYNC_SECRET` set); `DOCS_TRACK_API_KEY` is unset.

| Feature | What it does for the customer | Control and default | Where it takes effect | How a customer sees it working | Status | If locked: why, and what unlocks it |
|---|---|---|---|---|---|---|
| Spaces | Create and list spaces. | per-space `private` | `/v1/spaces` | Docs → All spaces (`/docs`); sidebar lists the first five | live | Edit/delete a space has no screen. |
| Pages and editor | Nested pages in a rich editor (headings, lists, quote, code, Cmd-S). | none | `/v1/spaces/{s}/pages` | Page view in Docs | live | — |
| AI writing | Write with AI; Shorten, Lengthen, Fix grammar, Summarize, Translate on a selection; suggest a title. | Lens variables (set); 30/min | `…/ai/{write,transform,translate,suggest-title}` | Page editor | live | — |
| Ask Docs | Question answered from the workspace's pages, with citations. | Lens variables (set) | `…/ai/ask` | Ask AI on `/docs` and on a page | live | — |
| Search | Full-text plus semantic search. | Lens variables | `…/search` | Search on `/docs` | live | Pages saved before semantic indexing was on are never back-filled (page/store.go:445). |
| AI cost on a page | What AI on this page and its linked issues cost. | Needs Lens (set) and Track links | `…/version-cost` | "AI on this page $0.04" in the editor toolbar | live | The linked-issues part depends on Track's AI cost, which is locked. |
| Changelog | Generate a changelog page from Track issues; entries; RSS. | Needs Track | `…/changelog/*` | Generate on a page | live | The RSS feed needs a login, so a feed reader cannot use it. |
| Membership sync from Track | Docs learns members from Track at login and every 2 minutes. | `DOCS_TRACK_MEMBER_SYNC_SECRET` (set) | Background + `…/member-sync` | Everyone who can open Docs | live | — |
| Version history | Every save is a version: list, diff, restore. | none | `…/versions` | — | live but no screen | — |
| Real-time co-editing | Several people edit one page with cursors. | same-origin | `/v1/collab/{p}/ws` | The app's editor does not connect to it | live but no screen | — |
| Page locks and edit sessions | Soft lock; one writer at a time with takeover. | none | `…/lock`, `…/edit-session` | — | live but no screen | — |
| Approval workflow | Request review, approve, publish. | none | `…/approval` | — | live but no screen | — |
| Comments | Threaded comments with resolve. | none | `…/comments` | — | live but no screen | — |
| Permissions | View/comment/edit/admin on spaces and pages. | none | `…/permissions` | — | live but no screen | — |
| Public share links | A public link, optional expiry and password. | admin | `…/share`, `/v1/public/s/{token}` | — | live but no screen | A "comment" level is accepted but no public comment route exists. |
| Custom domains | Serve a read-only public space on your own hostname. | up to 5 | `…/custom-domains` | — | live but no screen | No certificates are issued. |
| Export | Markdown, HTML, PDF or DOCX. | none | `…/export?format=` | — | live but no screen | — |
| Import from Confluence / Notion | ZIP import into a space. | 200 MiB cap | `/v1/import/*` | — | live but no screen | — |
| Template library | 20 built-in templates plus your own. | none | `…/template-library` | — | live but no screen | — |
| Inline databases | Table, list, kanban, gallery views. | none | `/v1/pages/{p}/databases` | — | live but no screen | — |
| Freshness | "Still accurate" button, freshness badges, stale-pages list. | none | `…/verify`, `…/freshness` | — | live but no screen | The daily stale-page digest only writes a log line. |
| Readership analytics | Views per page, space and workspace. | none | `…/analytics` | — | live but no screen | — |
| Track issue embeds and links | Live Track issue cards inside a page; page↔issue links. | `DOCS_TRACK_API_KEY` — unset | `…/track/issues/{id}` | — | **locked** | Unlock: a Track credential Docs can present (Track only accepts gateway auth). |
| MCP server (Docs) | 10 agent tools: search, read/write pages, ask. | Gateway auth | `/mcp` | — | live but no screen | — |

## 5. Code — editor and command line

Not a screen in this app: it lives in the customer's editor or terminal.

**How it is installed today:** the **CLI** from GitHub Releases (v0.1.0, v0.2.0) via `install.sh`
with a checksum; the **VS Code extension** only as a locally built `.vsix` — it is **not on the
Marketplace** (B5.3 is BLOCKED on a publisher account and token); the **JetBrains plugin** from disk.

| Feature | What it does for the customer | Control and default | Where it takes effect | How a customer sees it working | Status | If locked: why, and what unlocks it |
|---|---|---|---|---|---|---|
| Inline completions | AI completions as you type. | `talyvor.enableCompletions` true; needs a Lens key | VS Code | The editor | live but no screen | Not published — a customer cannot install it from the Marketplace. Same for every VS Code row. |
| Chat panel, Explain, Fix error, Refactor, Generate tests | Editor AI actions. | none | VS Code; tests also CLI `test` | The editor | live but no screen | — |
| Agent mode | Multi-file task with approval per file; can start from the active issue. | `talyvor.agentIterative` false | VS Code | The editor | live but no screen | The iterative loop is off by default. |
| Active issue and attribution | Every AI call carries `X-Talyvor-Issue`, so its cost lands on the issue. | `talyvor.trackUrl`, `talyvor.activeIssue`; CLI reads the branch name | VS Code, CLI | Would show as AI cost on the Track issue — locked there | live but no screen | — |
| Cost status bar | Session cost in the status bar. | none | VS Code | The editor | live but no screen | Estimates every model at one model's price (talyvor-code, cost-tracker.ts, lines 32-52). |
| PR review | Reviews the branch diff; optionally posts to GitHub. | `talyvor.githubToken` / `GITHUB_TOKEN` | VS Code, CLI `review` | GitHub | live but no screen | — |
| Project rules, context, scopes, code index | Per-project rules and a local semantic index. | `.talyvor-rules`, `.talyvor-context`, `.talyvor-scopes` | VS Code, CLI | The editor | live but no screen | — |
| CLI ask / chat / run / commit / pr | Terminal assistant, agentic task, commit messages, PRs. | `TALYVOR_*` env vars | CLI | The terminal | live | Installed from GitHub Releases. |
| `talyvor exec` sidecar | Attributes Claude Code and aider spend to an issue. | CLI flags | CLI | Lens attribution (no screen) | live | — |
| Local MCP server | 10 tools for Claude Code and similar clients. | `127.0.0.1:7777`, `TALYVOR_MCP_TOKEN` | CLI `serve` | The MCP client | live | `search_codebase` only matches file paths. |
| Docs in the editor | Search and ask your Docs from the editor. | `talyvor.docsUrl` empty | VS Code, CLI `docs` | — | **locked** | Unlock: set the Docs URL. |
| Reports to Lens | Build verdicts, PR attribution, artifact commits sent to Lens. | `TALYVOR_REPORT_*`, `TALYVOR_COMMIT_ARTIFACT`, false | CLI | — | **locked** | Off by default; Lens's receiving side is locked too. |
| JetBrains plugin | Explain, tests, chat, shell command. | settings | IntelliJ family | The IDE | live but no screen | Display-only: cannot edit files; no completions, agent or Track. |
| Create Track issue from code; link doc to issue; spec watcher | — | — | VS Code | — | not built | Stubs: Track has no `/new` page; link only opens a search; the watcher never starts. |
| 5-minute cost sync to Track | Pushed estimated cost into Track. | — | — | — | **retired** | Removed; the extension README still describes it. |

---

## Capabilities that exist only as an API, with no screen

Each is a finding: a customer cannot use or see these from the app.

- **Lens:** Tare savings; document conversion upload/preview; shared-conversions switch; budgets;
  forecast and anomalies; ROI report; attribution by branch/PR/commit; agent sessions; logging
  level (shown, not changeable); guardrail policy editing and testing; named prompts; evals;
  A/B experiments; quality feedback; audit export; routing recommendation; marketplace and
  staking; key rotation; spend by team/request/key; MCP server.
- **Track:** statuses, labels, milestones and roadmap, custom fields, relations, time tracking,
  templates, prioritisation, analytics and its export, member management, notifications,
  automation, guest access, feature boards, import, real-time updates, MCP server; team creation;
  completing a cycle.
- **Docs:** version history, co-editing, locks and edit sessions, approvals, comments,
  permissions, share links, custom domains, export, import, templates, inline databases,
  freshness, readership analytics, MCP server; editing or deleting a space.
- **Code:** everything in the VS Code extension, until it is published.

## Locked in production — the reason and what unlocks it

| Feature | Why it is off | What unlocks it |
|---|---|---|
| Chat | `LENS_SESSION_KEYS_ENABLED` unset ⇒ Lens 404s the credential mint | B10.7: forward it in Lens's `docker-compose.yaml` with default `true` |
| Credit gating for chat traffic | gating flags off ⇒ chat answers cost 0 | `LENS_LXC_SHADOW_SPEND_ENABLED` + `LENS_LXC_GATING_ENABLED` — a pricing decision |
| Subscription and allowance | price ID and allowance empty | Nicolai sets `LENS_BILLING_SUBSCRIPTION_PRICE_ID` and `LENS_SUBSCRIPTION_ALLOWANCE_ULXC` |
| Track AI cost per issue | `TRACK_LENS_API_KEY` empty | set it to a Lens key with analytics scope |
| Lens spend alerts into Track | `LENS_TRACK_WEBHOOK_URL` empty | set it with its secret |
| GitHub PR → issue | Track webhook secret and workspace unset | set both |
| Docs ↔ Track issue embeds | no Track credential Docs can present | a gateway-auth credential for Docs |
| Output guardrails, routing intelligence, node routing, provenance/bonds, dashboard, admin grant, pattern mining | flags default false, unset | set each flag (most only via `lens.env`) |
| Batch | no billing settle hook | wire the settle hook, then `LENS_BATCH_ENABLED` |
| Local model offload | only serves the workspace named `default` | per-workspace local routing |
| VS Code extension | not on the Marketplace | a publisher account and token (B5.3) |
