import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lensOpenAPI, lensPage } from '../selftest/stub-openapi.ts'
import { type Doc, type Driven, OPENAPI_FUND_ULXC, describedProblems, drivenProblems, referenceOf } from '../src/openapiWallets.ts'

// The wallet half of the document Lens serves at /openapi.json, recorded from it (selftest/lens-openapi.json).
const recorded = (): Doc => JSON.parse(readFileSync(new URL('../selftest/lens-openapi.json', import.meta.url), 'utf8')) as Doc
const base = 'https://lens.talyvor.com'

// Lens's page at / as it is served (internal/dashboard/status_page.go), the rows around the API reference.
const root = `<p class="sub">Agent Wallets and the gateway that enforces them</p>
    <a class="row" href="https://app.talyvor.com">
      <div>
        <div class="label">Wallet console</div>
      </div>
    </a>
    <a class="row" href="/openapi.json">
      <div>
        <div class="label">API reference</div>
        <div class="hint">OpenAPI — the agent wallet routes first</div>
      </div>
    </a>`
const status = '<div class="subtitle">Agent Wallets and the gateway that enforces them · <span class="num">vc5c877e</span> · uptime <span class="num">0.05 hours</span></div>'

// What Lens answers an agent created and funded 1 LXC by the document's operations.
const driven: Driven = {
  agentID: 'agt_1',
  fund: { agent_id: 'agt_1', balance_ulxc: OPENAPI_FUND_ULXC },
  rules: { max_per_request_ulxc: 0, allowed_models: [], max_commitment_ulxc: null },
  approvals: { approvals: [] },
  statement: { agent_id: 'agt_1', lines: [{ entry_id: 'e1', kind: 'fund', amount_ulxc: OPENAPI_FUND_ULXC, counterparty: 'workspace', balance_after_ulxc: OPENAPI_FUND_ULXC, at: '2026-10-09T02:00:00Z' }] },
  book: { workspace_balance_ulxc: 50_000_000, agents: [{ id: 'agt_1', name: 'OpenAPI reader 0', balance_ulxc: OPENAPI_FUND_ULXC }] },
}

describe('openapi-wallets (B28.12)', () => {
  it("passes on Lens's pages, its recorded API reference and a funded agent's answers", () => {
    expect(referenceOf(root, base)).toBe('/openapi.json')
    const doc = recorded()
    expect(describedProblems({ root, status, reference: referenceOf(root, base), doc })).toEqual([])
    expect(drivenProblems(doc, driven)).toEqual([])
  })

  it('FAILs on Lens as it was before B28.12, naming the line, the link, the tag and the operations', () => {
    const page = lensPage('/', true)
    const wrong = describedProblems({ root: page, status: lensPage('/status', true), reference: referenceOf(page, 'http://127.0.0.1:9911'), doc: lensOpenAPI(true) as Doc })
    expect(wrong).toEqual([
      `Lens's page at / does not say "Agent Wallets and the gateway that enforces them"`,
      `/status does not say "Agent Wallets and the gateway that enforces them"`,
      "Lens's page at / links its API reference at nowhere, not /openapi.json",
      'the API reference opens "Production AI proxy/gateway. Multi-provider routing with cost tracking, quality ", not "Agent Wallets and the gateway that enforces them"',
      "the API reference's first tag is none, not Agent Wallets",
      expect.stringMatching(/^the API reference lists no GET \/v1\/workspaces\/\{wsID\}\/agents, POST .*, GET \/v1\/workspaces\/\{wsID\}\/agents\/\{agentID\}\/card$/),
    ])
    // The stub's own pages, unbroken, pass.
    const ok = lensPage('/', false)
    expect(describedProblems({ root: ok, status: lensPage('/status', false), reference: referenceOf(ok, 'http://127.0.0.1:9911'), doc: lensOpenAPI(false) as Doc })).toEqual([])
  })

  it('FAILs when a wallet operation names a schema the document does not hold', () => {
    const doc = recorded()
    delete doc.components?.schemas?.AgentStatementLine
    expect(describedProblems({ root, status, reference: '/openapi.json', doc })).toEqual([
      'the wallet operations name schemas the document does not hold: #/components/schemas/AgentStatementLine',
    ])
  })

  it("FAILs when the statement is not the funding's one documented row", () => {
    const doc = recorded()
    const line = { entry_id: 'e1', kind: 'fund', amount_ulxc: OPENAPI_FUND_ULXC, counterparty: 'workspace', balance_after_ulxc: OPENAPI_FUND_ULXC, at: '2026-10-09T02:00:00Z' }
    expect(drivenProblems(doc, { ...driven, statement: { lines: [{ ...line, kind: 'spend', amount_ulxc: -5, balance_after_ulxc: OPENAPI_FUND_ULXC - 5 }, line, line] } })).toEqual([
      `the agent's statement is not the one fund line of +${OPENAPI_FUND_ULXC} µLXC leaving ${OPENAPI_FUND_ULXC}: spend -5 → 999995; fund 1000000 → 1000000; fund 1000000 → 1000000`,
    ])
    expect(drivenProblems(doc, { ...driven, statement: { lines: [{ ...line, posted_by: 'x', kind: 'gift' }] } })).toEqual([
      'a statement line carries posted_by, which AgentStatementLine does not name',
      `a statement line's kind "gift" is not one AgentStatementLine allows (fund, withdraw, spend, hold, settle, release, pay, platform_fee)`,
      `the agent's statement is not the one fund line of +${OPENAPI_FUND_ULXC} µLXC leaving ${OPENAPI_FUND_ULXC}: gift 1000000 → 1000000`,
    ])
    expect(drivenProblems(doc, { ...driven, fund: { balance_ulxc: 0 }, book: { agents: [] } })).toEqual([
      `funding ${OPENAPI_FUND_ULXC} µLXC answered balance_ulxc 0`,
      "the workspace's agents do not list agt_1",
    ])
  })
})
