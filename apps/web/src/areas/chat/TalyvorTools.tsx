import { Link } from 'react-router-dom'

import { Button, inlineLink } from '@talyvor/ui'

import { Card } from '../lens/walletBrand'
import { type FiledIssue, ISSUE_TOOL, type ToolConfirm, filedIssueHref } from './chatApi'
import type { ConnectorCall } from './connectors'
import { formatAnswerCost, formatCharged } from './price'

// B28.374 — Talyvor's own tools in Chat. Beside Lens's wallet tool, the model is offered Track's and Docs' own MCP
// tools (apps/bff/chat_tools.go): it can search and read issues and pages, and "file this as a bug" files a Track
// issue. Reading needs nothing from the person; filing is put to them first, and only a yes files it.

/** What each tool did, in words, for the line under an answer. */
const DID: Record<string, string> = {
  wallet_agents_spend: 'Read your agents’ statements',
  get_spend_summary: 'Read your spend in Lens',
  get_cache_stats: 'Read your cache savings in Lens',
  create_issue: 'Filed an issue in Track',
  search_issues: 'Searched Track',
  list_issues: 'Listed issues in Track',
  get_issue: 'Read an issue in Track',
  search_docs: 'Searched Docs',
  get_page: 'Read a page in Docs',
}

const PRODUCT: Record<string, string> = { lens: 'Lens', track: 'Track', docs: 'Docs' }

/** An argument as text for the card, or undefined when the model sent none. */
function said(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() === '' ? undefined : v
  if (v === undefined || v === null) return undefined
  return JSON.stringify(v)
}

/** The model wants to make a call that changes something: what it would do, and the person's yes or no. */
export function ToolConfirmCard({ ask, onAnswer }: { ask: ToolConfirm; onAnswer: (yes: boolean) => void }) {
  // B28.122 — a connector's tool is named as the connector names it, on the connector the person added.
  const product = ask.tool.connector?.name ?? PRODUCT[ask.tool.product ?? ''] ?? 'Talyvor'
  const tool = ask.tool.connector?.tool ?? ask.call.name
  const filing = ask.tool.connector === undefined && ask.call.name === ISSUE_TOOL
  const title = said(ask.args.title)
  const description = said(ask.args.description)
  const others = Object.entries(ask.args).filter(([k]) => !filing || (k !== 'title' && k !== 'description'))
  return (
    <Card className="mb-4 px-4 py-3">
      <section aria-label={filing ? `File this in ${product}?` : `Let Chat use ${tool}?`} data-testid="tool-confirm">
        <p className="font-figure text-eyebrow uppercase text-label">{product}</p>
        <h3 className="mt-1 text-body font-semibold text-ink">{filing ? `File this in ${product}?` : `Let Chat use ${tool} in ${product}?`}</h3>
        {filing ? (
          <dl className="mt-2 flex flex-col gap-1 text-caption">
            <dt className="text-muted">Title</dt>
            <dd className="break-words text-ink" data-testid="tool-confirm-title">{title ?? 'No title'}</dd>
            {description !== undefined ? (
              <>
                <dt className="mt-1 text-muted">Description</dt>
                <dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-ink">{description}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {others.length > 0 ? (
          <dl className="mt-2 flex flex-col gap-1 text-caption">
            {others.map(([k, v]) => (
              <div key={k} className="flex min-w-0 flex-wrap gap-x-2">
                <dt className="text-muted">{k}</dt>
                <dd className="min-w-0 break-words font-figure text-ink">{said(v) ?? '—'}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => onAnswer(true)}>
            {filing ? 'File it' : 'Allow'}
          </Button>
          <Button onClick={() => onAnswer(false)}>{filing ? 'Don’t file' : 'Don’t allow'}</Button>
        </div>
      </section>
    </Card>
  )
}

/** Under an answer that filed Track issues: each one, linked to it in Track. */
export function FiledIssues({ issues }: { issues: FiledIssue[] }) {
  return (
    <Card className="mt-3 px-4 py-3">
      <nav aria-label="Issues this answer filed" data-testid="turn-filed">
        <p className="font-figure text-eyebrow uppercase text-label">Filed in Track</p>
        <ul className="mt-2 flex flex-col gap-1">
          {issues.map((i) => (
            <li key={i.id} className="min-w-0 text-caption text-muted">
              <Link className={inlineLink} to={filedIssueHref(i)} data-testid="turn-filed-issue">
                <span className="font-figure">{i.identifier}</span>
                {i.title !== '' ? <> · {i.title}</> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Card>
  )
}

/** Under an answer that used Talyvor's own tools: what it did with them. */
export function ToolsUsed({ names }: { names: string[] }) {
  return (
    <p className="mt-2 text-caption text-muted" data-testid="turn-tools-used">
      {names.map((n) => DID[n] ?? n).join(' · ')}
    </p>
  )
}

/** B28.122 — what one connector call cost: Lens's charge for the request that read its answer, or its estimate. */
function callCost(c: ConnectorCall, usdPerLXC: number | undefined): string {
  if (c.charged_ulxc !== undefined) return formatCharged(c.charged_ulxc)
  if (c.usd !== undefined) return formatAnswerCost(c.usd, usdPerLXC)
  return 'cost not known'
}

/** B28.122 — under an answer that used connectors' tools: each call, on which connector, and what it cost. */
export function ConnectorCalls({ calls, usdPerLXC }: { calls: ConnectorCall[]; usdPerLXC: number | undefined }) {
  return (
    <Card className="mt-3 px-4 py-3">
      <section aria-label="Connectors this answer used" data-testid="turn-connector-calls">
        <p className="font-figure text-eyebrow uppercase text-label">Connectors</p>
        <ul className="mt-2 flex flex-col gap-1">
          {calls.map((c, i) => (
            <li key={i} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-caption text-muted" data-testid="turn-connector-call">
              <span className="min-w-0 break-words">
                <span className="font-figure text-ink">{c.tool}</span> on {c.connector}
                {c.ok ? null : ' · did not answer'}
              </span>
              <span className="font-figure text-ink" data-testid="turn-connector-cost">
                {callCost(c, usdPerLXC)}
              </span>
              {c.shared !== undefined && c.shared > 1 ? <span>· one request read {c.shared} calls’ answers</span> : null}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-caption text-muted">Each call costs the request to the model that read its answer.</p>
      </section>
    </Card>
  )
}
