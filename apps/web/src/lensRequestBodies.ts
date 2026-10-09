/**
 * THE SIX REQUEST BODIES THIS BFF BUILDS FOR talyvor-lens, AND THE POPULATION THEY COME OUT OF.
 *
 * This module is the shared half of two guards: `lensRequestBodyRegister.test.ts` holds every
 * body here to a `cannot` entry in `deploy/decision-expiry.sh`, and `aiRequestBodyRegister.test.ts`
 * next door subtracts this table from its own marshal census so the bodies it does NOT cover stay
 * counted rather than dropped. Both numbers used to be literals in a comment; they are derived here.
 *
 * ⚠ WHY THIS FAMILY IS DIFFERENT FROM THE DOCS ONE NEXT DOOR. Every body in `aiRequestBodyRegister`
 * is a NAMED Go struct, so its keys are findable by name. These six are anonymous maps and structs
 * — `json.Marshal(map[string]int64{"usd_cents": …})` and friends — which is exactly why the sibling
 * census puts them in its `anonymous` bucket and cannot name them. An anonymous literal is not a
 * lesser claim about another repository; it is the same claim with nowhere to hang a test.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const BFF_DIR = resolve(ROOT, "apps/bff");

export interface LensBody {
  /** the lens route this body is POSTed/PUT to, as the register spells it */
  route: string;
  /** repo-relative path of the file that BUILDS the body */
  file: string;
  /**
   * How the keys are written at the marshal site. `map-literal` is a one-line
   * `map[string]T{"k": v}`; `anon-struct` is a struct literal (or a decoded `var in struct`)
   * whose json tags are the keys.
   */
  kind: "map-literal" | "anon-struct";
  /**
   * The line the parse anchors on. It must occur EXACTLY ONCE in the file — asserted, because an
   * anchor that matches twice silently parses the wrong one and an anchor that matches zero times
   * parses nothing, which a set comparison would read as agreement.
   */
  anchor: string;
  /**
   * For `anon-struct` only: the enclosing func, so the struct is located inside it rather than by
   * the first `var in struct {` in the file. `keys.go` and `tenant.go` both hold more than one.
   */
  fn?: string;
  /** the talyvor-lens file the settle command greps */
  upstreamFile: string;
  /**
   * The FIXED-STRING anchor the settle command hands to `grep -F`. It is a column rather than a
   * derived value because it is the half a deployer actually runs — if it drifts from the route
   * above, the entry settles a different question, and that is what this table is for.
   */
  upstreamAnchor: string;
  /** the name the register entry and the UPSTREAM-BINDS-ONLY declaration both use */
  subject: string;
}

/**
 * ⚠ THE ORDER IS THE ORDER OF THE MEASURED VERDICT TABLE (see lensRequestBodyRegister.test.ts's
 * header): loud first, silent second. It is not alphabetical on purpose — the three routes whose
 * rename is SILENT are the reason this file exists.
 */
export const LENS_BODIES: LensBody[] = [
  {
    route: "POST /v1/workspaces/{wsID}/billing/checkout",
    file: "apps/bff/billing.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]int64{"usd_cents": in.USDCents})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor:
      'bill.post(authed, "/v1/workspaces/{wsID}/billing/checkout", func',
    subject: "lensCheckoutBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/lxc/convert",
    file: "apps/bff/convert.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]int64{"lxc_amount_ulxc": in.LXCAmountULXC})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor:
      'econ.post(authed, "/v1/workspaces/{wsID}/lxc/convert", func',
    subject: "lensConvertBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/api-keys",
    file: "apps/bff/keys.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMintKey(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor: 'authed.Post("/v1/workspaces/{wsID}/api-keys", func',
    subject: "lensMintKeyBody",
  },
  {
    route: "POST /v1/provision",
    file: "apps/bff/tenant.go",
    kind: "anon-struct",
    fn: "func (a *app) provision(",
    anchor: "json.Marshal(struct {",
    upstreamFile: "cmd/lens/provision_handler.go",
    upstreamAnchor: "type provisionRequest struct",
    subject: "lensProvisionBody",
  },
  {
    route: "PUT /v1/workspaces/{wsID}/distill",
    file: "apps/bff/distill.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"distill_policy": policy})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor: 'authed.Put("/v1/workspaces/{wsID}/distill", func',
    subject: "lensDistillBody",
  },
  {
    route: "PUT /v1/workspaces/{wsID}/cache-poolable",
    file: "apps/bff/tenant.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]bool{"cache_poolable": poolable})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor: 'authed.Put("/v1/workspaces/{wsID}/cache-poolable", func',
    subject: "lensCachePoolableBody",
  },
  // B8.2 — the Features screen's two switches.
  {
    route: "PUT /v1/workspaces/{wsID}/tare",
    file: "apps/bff/features.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"tare_policy": *in.TarePolicy})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor: 'authed.Put("/v1/workspaces/{wsID}/tare", func',
    subject: "lensTareBody",
  },
  {
    route: "PUT /v1/workspaces/{wsID}/cost-optimize-routing",
    file: "apps/bff/features.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]bool{"cost_optimize_routing": *in.CostOptimizeRouting})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor:
      'authed.Put("/v1/workspaces/{wsID}/cost-optimize-routing", func',
    subject: "lensCostRoutingBody",
  },
  // B27.37 — the Tare prose model's opt-in, beside the Tare policy.
  {
    route: "PUT /v1/workspaces/{wsID}/tare-model",
    file: "apps/bff/features.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]bool{"enabled": *in.TareModel})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor: 'authed.Put("/v1/workspaces/{wsID}/tare-model", func',
    subject: "lensTareModelBody",
  },
  // B11.2 — the shared-document-conversions consent, a switch Lens had and nothing called.
  {
    route: "PUT /v1/workspaces/{wsID}/distill-poolable",
    file: "apps/bff/features.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]bool{"distill_poolable": *in.DistillPoolable})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor: 'authed.Put("/v1/workspaces/{wsID}/distill-poolable", func',
    subject: "lensDistillPoolableBody",
  },
  // B18.22 — request logging, and the workspace's spending limit (created, then changed).
  {
    route: "PUT /v1/workspaces/{wsID}/logging",
    file: "apps/bff/features.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]string{"logging_policy": *in.LoggingPolicy})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor: 'authed.Put("/v1/workspaces/{wsID}/logging", func',
    subject: "lensLoggingBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/budgets",
    file: "apps/bff/features.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]any{"scope": "workspace", "period": "monthly"',
    upstreamFile: "internal/budgets/budgets.go",
    upstreamAnchor: 'authed.Post("/v1/workspaces/{wsID}/budgets", func',
    subject: "lensBudgetCreateBody",
  },
  {
    route: "PATCH /v1/workspaces/{wsID}/budgets/{id}",
    file: "apps/bff/features.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]any{"period": b.Period',
    upstreamFile: "internal/budgets/budgets.go",
    upstreamAnchor: 'authed.Patch("/v1/workspaces/{wsID}/budgets/{id}", func',
    subject: "lensBudgetUpdateBody",
  },
  // B13.3 — the plan a subscriber picks on /plans.
  {
    route: "POST /v1/workspaces/{wsID}/billing/subscribe",
    file: "apps/bff/billing.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"plan": in.Plan})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor:
      'subs.post(authed, "/v1/workspaces/{wsID}/billing/subscribe", func',
    subject: "lensSubscribeBody",
  },
  // B18.20 — the plan a subscriber moves to on /plans.
  {
    route: "POST /v1/workspaces/{wsID}/billing/subscription/plan",
    file: "apps/bff/billing.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"plan": change.Plan})',
    upstreamFile: "cmd/lens/main.go",
    upstreamAnchor:
      'subs.post(authed, "/v1/workspaces/{wsID}/billing/subscription/plan", func',
    subject: "lensPlanChangeBody",
  },
  // B27.27 — a BYOK subscriber's own provider key, added or replaced on Settings.
  {
    route: "PUT /v1/workspaces/{wsID}/provider-keys/{provider}",
    file: "apps/bff/provider_keys.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"key": in.Key})',
    upstreamFile: "cmd/lens/provider_keys_routes.go",
    upstreamAnchor:
      "func newProviderKeyPutHandler(s *byok.Store) http.HandlerFunc {",
    subject: "lensProviderKeyBody",
  },
  // B21.4 — Features' Stored answers: deleting them, and asking Talyvor to delete everything.
  {
    route: "DELETE /v1/workspaces/{wsID}/stored-answers",
    file: "apps/bff/stored_answers.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]string{"scope": in.Scope, "confirm": in.Confirm})',
    upstreamFile: "internal/storedanswers/http.go",
    upstreamAnchor:
      "func DeleteHandler(store Deleter, wsm WorkspaceLookup) http.HandlerFunc {",
    subject: "lensStoredAnswersDeleteBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/deletion-requests",
    file: "apps/bff/stored_answers.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"note": "Asked from Features"})',
    upstreamFile: "internal/storedanswers/http.go",
    upstreamAnchor: "func FileRequestHandler(store Deleter) http.HandlerFunc {",
    subject: "lensDeletionRequestBody",
  },
  // B19.4 — the Agent Bank: creating an agent, issuing it a key, moving LXC, its rules, paying.
  {
    route: "POST /v1/workspaces/{wsID}/agents",
    file: "apps/bff/agent_bank.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"name": in.Name})',
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentCreateBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/keys",
    file: "apps/bff/agent_bank.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"name": keyName})',
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/keys", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentKeyBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/fund",
    file: "apps/bff/agent_bank.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]int64{"amount_ulxc": in.AmountULXC})',
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      "move := func(fn func(ctx context.Context, workspaceID, agentID string, amount int64) (int64, error)) http.HandlerFunc {",
    subject: "lensAgentMoveBody",
  },
  {
    route: "PUT /v1/workspaces/{wsID}/agents/{agentID}/rules",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentRules(",
    anchor: "var in struct {",
    upstreamFile: "internal/economy/agent_rules.go",
    upstreamAnchor: "type AgentRules struct {",
    subject: "lensAgentRulesBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/pay",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentPay(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/pay", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentPayBody",
  },
  // B19.24 — issuing an agent its test-mode card: the cardholder's name, email and billing address.
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/card",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentCard(",
    anchor: "var in struct {",
    upstreamFile: "internal/agentcard/agentcard.go",
    upstreamAnchor: "type Cardholder struct {",
    subject: "lensAgentCardBody",
  },
  // B19.20 — pausing every agent, and one, with the reason.
  {
    route: "POST /v1/workspaces/{wsID}/agents/pause-all",
    file: "apps/bff/agent_bank.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"reason": in.Reason})',
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/pause-all", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentPauseAllBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/pause",
    file: "apps/bff/agent_bank.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"reason": why.Reason})',
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/pause", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentPauseBody",
  },
  // B19.21 — a scheduled payment, and an automatic top-up.
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/schedules",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentSchedule(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/schedules", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentScheduleBody",
  },
  {
    route: "PUT /v1/workspaces/{wsID}/agents/{agentID}/topup",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentTopUp(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Put("/v1/workspaces/{wsID}/agents/{agentID}/topup", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentTopUpBody",
  },
  // B28.377 — a prompt scheduled from Chat, asked at its time on the agent's wallet. B28.125 builds the handler in
  // talyvor-lens beside the payment schedules; until it lands the settle command finds no anchor and fails, as it must.
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/prompt-schedules",
    file: "apps/bff/prompt_schedules.go",
    kind: "anon-struct",
    fn: "func (a *app) handlePromptSchedule(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/prompt-schedules", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensPromptScheduleBody",
  },
  // B28.127 — a chat shared as a link: the copy of its questions and answers Lens keeps until the link is turned off.
  // The talyvor-lens item after B28.127 mounts the handler; until it lands the settle command finds no anchor and fails,
  // as it must.
  {
    route: "POST /v1/workspaces/{wsID}/chat-shares",
    file: "apps/bff/chat_shares.go",
    kind: "anon-struct",
    fn: "func chatShareRequest(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/chat_shares_handler.go",
    upstreamAnchor: 'r.Post("/v1/workspaces/{wsID}/chat-shares", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensChatShareBody",
  },
  // B20.3 — the marketplace: publishing a listing, and using one.
  {
    route: "POST /v1/workspaces/{wsID}/marketplace/listings",
    file: "apps/bff/marketplace.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMarketListings(",
    anchor: "var in struct {",
    upstreamFile: "internal/market/market.go",
    upstreamAnchor: "type Draft struct {",
    subject: "lensMarketPublishBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/marketplace/listings/{listingID}/use",
    file: "apps/bff/marketplace.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMarketUse(",
    anchor: "var in struct {",
    upstreamFile: "internal/market/use.go",
    upstreamAnchor: "type UseRequest struct {",
    subject: "lensMarketUseBody",
  },
  // B20.11 — reporting a listing to Talyvor's review.
  {
    route: "POST /v1/marketplace/listings/{listingID}/reports",
    file: "apps/bff/marketplace.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMarketReport(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/market_handler.go",
    upstreamAnchor:
      'r.Post("/v1/marketplace/listings/{listingID}/reports", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensMarketReportBody",
  },
  // B32.59 — a licence renewed from the Licences page: the same offer licensed again.
  {
    route:
      "POST /v1/workspaces/{wsID}/marketplace/listings/{listingID}/licences",
    file: "apps/bff/marketplace.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMarketLicense(",
    anchor: "var in struct {",
    upstreamFile: "internal/market/licences.go",
    upstreamAnchor: "type LicenceRequest struct {",
    subject: "lensMarketLicenceBody",
  },
  // B32.58 — Remix this, and declaring a held copy's original as a parent: the remix licence accepted.
  {
    route: "POST /v1/workspaces/{wsID}/marketplace/listings/{listingID}/remix",
    file: "apps/bff/marketplace.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMarketRemix(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/market_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/marketplace/listings/{listingID}/remix", marketOwnerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensMarketRemixBody",
  },
  // B32.60 — a seller saves their tax details.
  {
    route: "PUT /v1/workspaces/{wsID}/marketplace/seller-tax",
    file: "apps/bff/marketplace.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMarketSellerTax(",
    anchor: "var in struct {",
    upstreamFile: "internal/sellertax/sellertax.go",
    upstreamAnchor: "type Input struct {",
    subject: "lensSellerTaxBody",
  },
  // B20.12 — the operator takes a listing down, with a reason.
  {
    route: "POST /v1/admin/marketplace/listings/{listingID}/takedown",
    file: "apps/bff/market_review.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMarketTakedown(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/market_handler.go",
    upstreamAnchor:
      "func newMarketTakedownHandler(store *market.Store, refunder market.Refunder) http.Handler {",
    subject: "lensMarketTakedownBody",
  },
  // B27.29 — every operator action is recorded in Lens's operator trail.
  {
    route: "POST /v1/admin/operator-audit/record",
    file: "apps/bff/operator_audit.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]string{"action": act.action, "target": act.target, "detail": act.detail})',
    upstreamFile: "cmd/lens/operator_audit_handler.go",
    upstreamAnchor:
      "func newOperatorAuditRecordHandler(store operatorAuditStore) http.Handler {",
    subject: "lensOperatorAuditRecordBody",
  },
  // B20.6 — a seller connects a Stripe account to be paid.
  {
    route: "POST /v1/workspaces/{wsID}/marketplace/payouts/connect",
    file: "apps/bff/marketplace.go",
    kind: "anon-struct",
    fn: "func (a *app) handleMarketPayoutsConnect(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/market_payout_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/marketplace/payouts/connect", marketOwnerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensMarketPayoutConnectBody",
  },
  // B19.10 — approvals with Face ID and pushes on the phone (Lens B19.16 keeps passkeys and subscriptions).
  {
    route: "POST /v1/workspaces/{wsID}/agents/passkeys",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handlePasskeys(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/passkeys", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensPasskeyRegisterBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/approvals/{approvalID}/approve",
    file: "apps/bff/agent_bank.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]*passkeyAssertion{"assertion": in.Assertion})',
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor: "decide := func(approve bool) http.HandlerFunc {",
    subject: "lensApprovalDecisionBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/push/subscriptions",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handlePushSubscriptions(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/push/subscriptions", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensPushSubscribeBody",
  },
  {
    route: "DELETE /v1/workspaces/{wsID}/agents/push/subscriptions",
    file: "apps/bff/agent_bank.go",
    kind: "map-literal",
    anchor: 'json.Marshal(map[string]string{"endpoint": in.Endpoint})',
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Delete("/v1/workspaces/{wsID}/agents/push/subscriptions", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensPushUnsubscribeBody",
  },
  // B22.10 — Agent Wallets' money between owners (Lens B22.3, B22.5).
  {
    route: "PUT /v1/workspaces/{wsID}/agents/{agentID}/handle",
    file: "apps/bff/wallet_money.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentHandle(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_transfers_handler.go",
    upstreamAnchor:
      'r.Put("/v1/workspaces/{wsID}/agents/{agentID}/handle", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentHandleBody",
  },
  // Sending and requesting decode one shared struct upstream: each settle command pins its tags and
  // that its own route decodes it.
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/send",
    file: "apps/bff/wallet_money.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentSend(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_transfers_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/send", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentSendBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/requests",
    file: "apps/bff/wallet_money.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentRequest(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_transfers_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/requests", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentRequestBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/loans",
    file: "apps/bff/wallet_money.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentLoan(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/company_loans_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/loans", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentLoanBody",
  },
  // B22.12 — Agent Wallets' escrow, pots, simulated orders and cash-out (Lens B22.6, B22.7, B22.8, B22.9).
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/escrows",
    file: "apps/bff/wallet_holdings.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentEscrow(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_escrows_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/escrows", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentEscrowBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/escrows/{escrowID}/dispute",
    file: "apps/bff/wallet_holdings.go",
    kind: "anon-struct",
    fn: "func (a *app) handleEscrowDispute(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_escrows_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/escrows/{escrowID}/dispute", payerAct(func(req *http.Request, wsID, escrowID string) (economy.Escrow, error) {',
    subject: "lensEscrowDisputeBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/pots",
    file: "apps/bff/wallet_holdings.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentPots(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_pots_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/pots", agentOrOwner(func(w http.ResponseWriter, req *http.Request, ws, agentID string) {',
    subject: "lensAgentPotBody",
  },
  // One marshal site serves …/in and …/out: Lens mounts both from one loop over the same decoder.
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/pots/{potID}/in",
    file: "apps/bff/wallet_holdings.go",
    kind: "anon-struct",
    fn: "func (a *app) handlePotMove(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_pots_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/pots/{potID}/"+dir, agentOrOwner(func(w http.ResponseWriter, req *http.Request, ws, agentID string) {',
    subject: "lensPotMoveBody",
  },
  {
    route: "PUT /v1/workspaces/{wsID}/agents/{agentID}/pots/{potID}/lock",
    file: "apps/bff/wallet_holdings.go",
    kind: "anon-struct",
    fn: "func (a *app) handlePotLock(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_pots_handler.go",
    upstreamAnchor:
      'r.Put("/v1/workspaces/{wsID}/agents/{agentID}/pots/{potID}/lock", agentOrOwner(func(w http.ResponseWriter, req *http.Request, ws, agentID string) {',
    subject: "lensPotLockBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/portfolios",
    file: "apps/bff/wallet_holdings.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentPortfolios(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/sim_trading_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/portfolios", agentOrOwner(func(w http.ResponseWriter, req *http.Request, ws, agentID string) {',
    subject: "lensPortfolioBody",
  },
  // Lens decodes the named economy.SimOrderInput; its settle command pins that struct's tags and that this
  // route decodes it. mode is never sent, so every order is simulated.
  {
    route:
      "POST /v1/workspaces/{wsID}/agents/{agentID}/portfolios/{pfID}/orders",
    file: "apps/bff/wallet_holdings.go",
    kind: "anon-struct",
    fn: "func (a *app) handlePortfolioOrder(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/sim_trading_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/portfolios/{pfID}/orders", agentOrOwner(func(w http.ResponseWriter, req *http.Request, ws, agentID string) {',
    subject: "lensSimOrderBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/cash-outs",
    file: "apps/bff/wallet_holdings.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentCashOut(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_cash_outs_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/cash-outs", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentCashOutBody",
  },
  // B28.21 — renaming and describing an agent.
  {
    route: "PATCH /v1/workspaces/{wsID}/agents/{agentID}",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgent(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Patch("/v1/workspaces/{wsID}/agents/{agentID}", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentUpdateBody",
  },
  // B28.30 — would the agent's rules let this request through? Lens judges it and moves nothing.
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/rules/simulate",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentRulesSimulate(",
    anchor: "var in struct {",
    upstreamFile: "internal/economy/agent_rule_simulator.go",
    upstreamAnchor: "type SimulatedRequest struct {",
    subject: "lensAgentRulesSimulateBody",
  },
  // B28.31 — put an agent's rules back exactly as they were at an earlier version.
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/rules/rollback",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentRulesRollback(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/rules/rollback", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentRulesRollbackBody",
  },
  // B28.32 — raise one of an agent's limits until a time.
  {
    route: "POST /v1/workspaces/{wsID}/agents/{agentID}/rules/boosts",
    file: "apps/bff/agent_bank.go",
    kind: "anon-struct",
    fn: "func (a *app) handleAgentRuleBoosts(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/agent_accounts_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/agents/{agentID}/rules/boosts", ownerOnly(func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensAgentRuleBoostBody",
  },
  // B28.349 — Chat lists and calls Lens's read-only wallet MCP tools (tools/list, tools/call) on its JSON-RPC route.
  {
    route: "POST /mcp",
    file: "apps/bff/chat_tools.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})',
    upstreamFile: "internal/mcp/server.go",
    upstreamAnchor: "type rpcRequest struct {",
    subject: "lensMCPBody",
  },
  // B23.12 — the chat's thumbs-down: Lens removes the stored answer the request was served.
  {
    route: "POST /v1/feedback",
    file: "apps/bff/feedback.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]string{"request_id": in.RequestID, "signal": in.Signal})',
    upstreamFile: "internal/proxy/answer_feedback.go",
    upstreamAnchor: "func AnswerFeedbackHandler(",
    subject: "lensFeedbackBody",
  },
  // B28.370 — Chat's prompt library saves a named prompt in the workspace.
  {
    route: "POST /v1/prompts",
    file: "apps/bff/chat_prompts.go",
    kind: "map-literal",
    anchor:
      'json.Marshal(map[string]string{"name": in.Name, "content": in.Content, "description": in.Description})',
    upstreamFile: "internal/prompts/manager.go",
    upstreamAnchor: "type Prompt struct {",
    subject: "lensPromptCreateBody",
  },
  // B32.63 — the operator loads a tax rates file (Lens B32.101 adds the route).
  {
    route: "POST /v1/admin/tax/rates/import",
    file: "apps/bff/operator_tax.go",
    kind: "anon-struct",
    fn: "func (a *app) handleTaxRatesImport(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/tax_admin_handler.go",
    upstreamAnchor: "func newTaxRatesImportHandler(store taxAdmin) http.Handler {",
    subject: "lensTaxRatesImportBody",
  },
  // B32.63 — the operator records one of Talyvor's tax registrations (Lens B32.101 adds the route).
  {
    route: "POST /v1/admin/tax/registrations",
    file: "apps/bff/operator_tax.go",
    kind: "anon-struct",
    fn: "func (a *app) handleTaxRegistrationAdd(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/tax_admin_handler.go",
    upstreamAnchor: "func newTaxRegistrationAddHandler(store taxAdmin) http.Handler {",
    subject: "lensTaxRegistrationBody",
  },
  // B32.63 — the operator runs the year's platform report (Lens B32.44).
  {
    route: "POST /v1/admin/platform-reports",
    file: "apps/bff/operator_tax.go",
    kind: "anon-struct",
    fn: "func (a *app) handlePlatformReportRun(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/platform_report_handler.go",
    upstreamAnchor: "func newPlatformReportExportHandler(g *platformreport.Generator) http.Handler {",
    subject: "lensPlatformReportBody",
  },
  // B30.116 — the owner's verification checks on the Verification screen (Lens B30.4). All three decode one
  // economy.VerificationRequest upstream: each settle command pins its tags and that its own route decodes it.
  {
    route: "POST /v1/workspaces/{wsID}/verification/contact",
    file: "apps/bff/verification.go",
    kind: "anon-struct",
    fn: "func (a *app) handleVerificationContact(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/verification_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/verification/contact", check(economy.LevelContact))',
    subject: "lensVerificationContactBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/verification/identity",
    file: "apps/bff/verification.go",
    kind: "anon-struct",
    fn: "func (a *app) handleVerificationIdentity(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/verification_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/verification/identity", check(economy.LevelIdentity))',
    subject: "lensVerificationIdentityBody",
  },
  {
    route: "POST /v1/workspaces/{wsID}/verification/company",
    file: "apps/bff/verification.go",
    kind: "anon-struct",
    fn: "func (a *app) handleVerificationCompany(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/verification_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/verification/company", check(economy.LevelCompany))',
    subject: "lensVerificationCompanyBody",
  },
  // B30.103 — accepting a capability's terms (Lens B30.9), and Talyvor's check of an agent's credential (Lens B30.5).
  {
    route: "POST /v1/workspaces/{wsID}/terms/{capability}/accept",
    file: "apps/bff/capability_terms.go",
    kind: "anon-struct",
    fn: "func (a *app) handleTermsAccept(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/capability_terms_handler.go",
    upstreamAnchor:
      'r.Post("/v1/workspaces/{wsID}/terms/{capability}/accept", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensTermsAcceptBody",
  },
  {
    route: "POST /v1/kya/verify",
    file: "apps/bff/kya.go",
    kind: "anon-struct",
    fn: "func (a *app) handleKYAVerify(",
    anchor: "var in struct {",
    upstreamFile: "cmd/lens/kya_handler.go",
    upstreamAnchor:
      'r.Post("/v1/kya/verify", func(w http.ResponseWriter, req *http.Request) {',
    subject: "lensKYAVerifyBody",
  },
];

/**
 * The anonymous marshal sites in apps/bff that are NOT in the table above, pinned by the file they
 * live in and what they actually are. All three are in `lens.go` and NONE of them sends a key set
 * to talyvor-lens — they are named here rather than counted, because "nine anonymous sites" was a
 * single number covering three different things and the number is what made them look alike.
 *
 * ⚠ ONE OF THEM ASSERTS NO KEY SET AT ALL, WHICH IS WHY NAMING BEAT COUNTING. `lens.go`'s
 * `json.Marshal(ws)` marshals a bare STRING — the workspace id — on its way into
 * `fields["workspace_id"]`. The cross-repo claim on that line is the map KEY assigned next to it,
 * not the marshal; the sibling census counted it as a body because it counts `json.Marshal(`.
 */
export const NON_LENS_ANON_SITES = [
  {
    file: "chat_tools.go",
    what: "withoutArguments (B28.374) re-marshals a Lens, Track or Docs MCP tool’s inputSchema after deleting the arguments the BFF sets from the session (workspace_id, team_id) — a RESPONSE projection for GET /api/chat/tools, so it sends no key set and is exempt rather than uncovered. The JSON-RPC body chat_tools.go does send is the lensMCPBody row, built once in mcpRequestID for all three products and for B28.122’s connectors (chat_connectors.go), which send the same envelope with an id of their own per request.",
  },
  {
    file: "track_projects.go",
    what: "trackProjects (B4.2) marshals trackProjectCreateBody for talyvor-track’s project Create — team_id, name, identifier and description, four of model.Project’s json tags, chosen here so the browser cannot set status, priority or dates. A Track key set, not a lens one. ASKED BY THE `TrackProject` MIRROR ENTRY: it pins model.Project’s whole json-tag set, and Track’s project Create decodes into model.Project.",
  },
  {
    file: "track_boards.go",
    what: "trackBoards (B27.30) marshals trackBoardCreateBody for talyvor-track’s issue-board link Create — project_id alone, trimmed here so a blank one means “every issue”. A Track key set, not a lens one. ASKED BY THE `TrackBoardLink` MIRROR ENTRY: it pins issueboard.Share’s whole json-tag set, and Track’s link Create decodes into issueboard.Share.",
  },
  {
    file: "track_cycles.go",
    what: "trackCycles (B4.1) marshals trackCycleCreateBody for talyvor-track’s cycle Create — name, start_date and end_date, three of model.Cycle’s json tags, chosen here so the browser cannot set status or number. A Track key set, not a lens one. ASKED BY THE `TrackCycle` MIRROR ENTRY: it pins model.Cycle’s whole json-tag set, and Track’s cycle Create decodes into model.Cycle, so the three keys sent here are three of the tags that entry holds.",
  },
  {
    file: "lens.go",
    what:
      "stripPageContentList re-marshals a talyvor-docs page LIST after deleting content/content_text — a RESPONSE projection, so its cross-repo claim is the two deleted key names, not a key set it sends. " +
      "ASKED, INCIDENTALLY, BY THE `DocsPage` MIRROR ENTRY: it pins model.Page’s whole json-tag set, which contains BOTH `content` and `content_text` (measured at docs f5f9257a), so a rename upstream reds it. " +
      "THE PREMISE THAT COVERAGE RESTS ON IS THAT THE PAGE LIST SERVES model.Page ROWS — if that route ever served a slimmer projection struct, the mirror would stay green while `delete` became a silent no-op and the full ProseMirror document shipped to every tree view. THAT PREMISE IS NOW PINNED IN ITS OWN RIGHT (deploy/decision-expiry.sh, \"page LIST still serves model.Page rows\"), AND IT SPANS TWO LAYERS RATHER THAN ONE: for two merges the entry read only `Store.List`'s return type, so a projection added in `page.Handler.List` — or that handler renamed, or its file DELETED — left the command exiting 0 on a false premise. Measured through the real stripPageContentList: a projected row went in at 120 bytes and came out at 120, both deletes matching nothing. The command now reads the handler's store call, the identifier it serves, and the store's return type in ONE comparison.",
  },
  {
    file: "lens.go",
    what: "docsSpaceCreateBody marshals the workspace id as a BARE STRING (json.Marshal(ws)) — no key set is asserted on this line at all, so there is nothing for the register to ask and this one is exempt rather than uncovered",
  },
  {
    file: "lens.go",
    what:
      "docsSpaceCreateBody re-marshals the browser’s own object with workspace_id pinned — the claim is the talyvor-docs key `workspace_id`, and the rest of the object is authored by the browser. " +
      "ASKED BY THE `DocsSpace` MIRROR ENTRY, WHICH WAS NOT WRITTEN FOR IT: that entry pins model.Space’s tag set, and Docs’ space Create DECODES INTO model.Space — so the response mirror happens to cover a request key on an AUTHZ path. " +
      'THAT PREMISE IS NOW PINNED IN ITS OWN RIGHT (deploy/decision-expiry.sh, "space CREATE binds model.Space"), because a create handler that bound its own request struct would move the authz key with the mirror still green — and every key that is not `workspace_id` is forwarded VERBATIM, so the browser’s value under a new name is already on the wire.',
  },
  {
    file: "features.go",
    what: "handleFeatureGuardrails (B18.22) re-marshals talyvor-lens’s OWN guardrail policy, read from GET /v1/workspaces/{ws}/guardrails, with one flag changed — because Lens’s POST replaces the whole policy. The key set is whatever Lens answered, echoed back, so there is no key set of this repo’s to ask about and this site is exempt; the two flag names it sets, enable_injection and enable_pii, are the ones readFeatures already reads off the same policy.",
  },
  {
    file: "agent_task.go",
    what: "runTask (B28.359) marshals a task handed to an agent from Chat as a model request — OpenAI’s chat-completions shape, or Anthropic’s messages shape with max_tokens — and sends it on the agent’s key to Lens’s /v1/proxy/{provider}/…, which passes it to the provider exactly as it passes Chat’s own streamed requests (chatApi.ts requestBody builds the same shapes in the browser). The keys are the provider’s published request schema, not a key set any talyvor-lens route binds, so there is nothing for the register to ask talyvor-lens about and this site is exempt.",
  },
  {
    file: "session_seal.go",
    what: "sessionSealer.seal (B17.40) marshals sealedSession, the session sealed into its own cookie id so a restart does not sign anyone out. It is encrypted and only this BFF ever reads it back — no request body, sent to no repository, so there is no key set to ask about and this site is exempt.",
  },
] as const;

const cache = new Map<string, string>();
export function source(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const text = readFileSync(resolve(ROOT, file), "utf8");
  cache.set(file, text);
  return text;
}

/**
 * The keys a one-line `map[string]T{"k": v, …}` literal sends.
 *
 * Returns null when the anchor does not occur EXACTLY ONCE, so a moved or duplicated marshal is a
 * red rather than an empty set that compares equal to another empty set.
 */
function mapLiteralKeys(b: LensBody): string[] | null {
  const lines = source(b.file).split("\n");
  const hits = lines.filter((l) => l.includes(b.anchor));
  if (hits.length !== 1) return null;
  const keys = [...hits[0].matchAll(/"([a-z_][a-z0-9_]*)":/g)].map((m) => m[1]);
  return keys.length > 0 ? keys : null;
}

/**
 * The json keys an anonymous struct literal sends, located INSIDE its enclosing func.
 *
 * The block ends at the first line whose trimmed form starts with `}` — which is `}` for a
 * `var in struct {` and `}{Identity: …}` for a literal that is immediately constructed. The tag
 * class stops at the comma, so `json:"expires_at,omitempty"` yields `expires_at`.
 *
 * ⚠ `omitempty` IS NOT SUBTRACTED, AND THAT IS DELIBERATE. `tenant.go` declares
 * `display_name,omitempty` and never assigns it, so that key is never on the wire — but the struct
 * tag is still this repository ASSERTING that talyvor-lens binds a key by that name. A rename
 * upstream falsifies the assertion whether or not a value was ever sent, and the day someone
 * populates the field is not the day the guard should start looking.
 */
function anonStructKeys(b: LensBody): string[] | null {
  const lines = source(b.file).split("\n");
  // ⚠ THE SENTINEL IS WRITTEN AS AN ESCAPE AND MUST STAY ONE. It used to be the RAW NUL
  // byte, and a single 0x00 makes a whole file opaque to grep: `grep -c export lensRequestBodies.ts`
  // printed NOTHING and exited 1, and `grep -rn anonymousMarshalSites apps/web/src` returned this
  // module's three CALLERS and not the line that DEFINES it. Measured across the tree at
  // `81b9e52b`: plain grep found `export` in 141 files under apps/web/src and `git grep` found it
  // in 142 — this file, missing from every plain-grep census, silently, with rc=0. `git grep`
  // reads it fine, which is why nobody noticed: this repository's documented commands use it.
  // The VALUE below is unchanged — U+0000 either way — only the byte on disk is.
  const NEVER_MATCHES = "\u0000";
  const fnHits = lines
    .map((l, i) => [l, i] as const)
    .filter(([l]) => l.includes(b.fn ?? NEVER_MATCHES));
  if (fnHits.length !== 1) return null;
  const from = fnHits[0][1];
  const rel = lines.slice(from).findIndex((l) => l.includes(b.anchor));
  if (rel === -1) return null;
  const out: string[] = [];
  for (let i = from + rel + 1; i < lines.length; i += 1) {
    if (lines[i].trim().startsWith("}")) return out.length > 0 ? out : null;
    const m = /`json:"([a-z_][a-z0-9_]*)/.exec(lines[i]);
    if (m) out.push(m[1]);
  }
  return null;
}

/** The key set this repository sends on that route, parsed from the source that sends it. */
export function sentKeys(b: LensBody): string[] | null {
  return b.kind === "map-literal" ? mapLiteralKeys(b) : anonStructKeys(b);
}

/**
 * Keys talyvor-lens binds that this repo deliberately does NOT send, declared in the file that
 * builds the body. Same convention the sibling guard uses: `none` is spelled out, and an absent
 * declaration is a red rather than an empty set.
 *
 * ⚠ SAME-LINE ONLY, for the reason the sibling records: a Go `//` comment has no terminator, so a
 * class that admits the newline runs into the next line and swallows it.
 */
export function bindsOnly(b: LensBody): string[] | null {
  const re = new RegExp(
    `UPSTREAM-BINDS-ONLY ${b.subject}:([a-z0-9_,* \\t]*)`,
    "g",
  );
  const hits = [...source(b.file).matchAll(re)];
  if (hits.length !== 1) return null;
  const names = hits[0][1]
    .replace(/\*/g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (names.length === 1 && names[0] === "none") return [];
  if (names.length === 0 || names.some((n) => !/^[a-z_][a-z0-9_]*$/.test(n)))
    return null;
  return names;
}

/**
 * The double-quoted arguments of every `cannot` call in the register: DECISION, PREMISE, COMMAND.
 * Unescaped by bash's own rule for a double-quoted string — a backslash escapes only `$`, a
 * backtick, `"` and `\`, and before anything else it stays a literal backslash, which is what keeps
 * a grep pattern's `\*` a `\*`.
 *
 * ⚠ THIS LIVED IN `aiRequestBodyRegister.test.ts` AND WAS MOVED HERE RATHER THAN COPIED. Two
 * guards now read the same register, and two parsers for one file is exactly how the halves of a
 * claim start disagreeing quietly — the register would answer one guard's question and not the
 * other's, and each would report a pass.
 */
export function cannotCalls(shell: string): string[][] {
  const joined = shell.replace(/\\\n\s*/g, " ");
  const out: string[][] = [];
  for (const line of joined.split("\n")) {
    if (!line.startsWith("cannot ")) continue;
    const args: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] !== '"') {
        i += 1;
        continue;
      }
      i += 1;
      let buf = "";
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\") {
          if (!'$`"\\'.includes(line[i + 1] ?? "")) buf += line[i];
          i += 1;
          if (i < line.length) {
            buf += line[i];
            i += 1;
          }
          continue;
        }
        buf += line[i];
        i += 1;
      }
      i += 1;
      args.push(buf);
    }
    if (args.length >= 3) out.push(args);
  }
  return out;
}

/**
 * Every `json.Marshal(` in the BFF's non-test Go whose argument is NOT a named struct literal
 * declared in the package — the sibling census's `anonymous` bucket, recomputed here so the two
 * guards partition ONE population instead of each counting its own.
 */
export function anonymousMarshalSites(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(BFF_DIR).sort()) {
    if (!f.endsWith(".go") || f.endsWith("_test.go")) continue;
    const text = readFileSync(resolve(BFF_DIR, f), "utf8");
    for (const m of text.matchAll(/json\.Marshal\(/g)) {
      const rest = text.slice(m.index + m[0].length).split("\n")[0];
      const hit = /^([A-Za-z_][A-Za-z0-9_]*)\{/.exec(rest);
      if (hit && hit[1] !== "struct") continue;
      out.push(`${f}:${text.slice(0, m.index).split("\n").length}`);
    }
  }
  return out;
}
