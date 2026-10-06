import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, focusRing, inlineLink } from '@talyvor/ui'

import { BOOK_KEY, StatementDownload } from '../lens/AgentBank'
import { agentBankApi } from '../lens/agentBankApi'
import { Card } from '../lens/walletBrand'

// B28.98 — download a statement from Chat. `/statement Researcher` typed in the composer is not asked of the model: it
// opens a card that downloads the agent's statement for a period, as a CSV (or JSON) file, the same file Agent Wallets
// and Statements download; `/statement` alone downloads every agent's. Lens writes the file (GET /api/agents/statement).

/** A message that downloads a statement rather than asking the model. */
export const STATEMENT_COMMAND = /^\/statements?(?:\s|$)/i

/** The agent the command names: "" for every agent. */
export function parseStatement(command: string): string {
  const agent = command
    .replace(/^\/statements?\b/i, '')
    .trim()
    .replace(/^(?:for|of)\s+/i, '')
    .replace(/^agent\s+/i, '')
    .replace(/[’']s(?:\s+statement)?\.?$/i, '')
    .trim()
  return /^(?:all|every(?:\s+agent|one)?|all\s+agents|the\s+workspace)$/i.test(agent) ? '' : agent
}

const selectClass = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

export function StatementCard({ command, onClose }: { command: string; onClose: () => void }) {
  const [typed] = useState(() => parseStatement(command))
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = (book.data?.agents ?? []).filter((a) => a.archived_at === undefined)
  const named = typed === '' ? undefined : agents.find((a) => a.name.trim().toLowerCase() === typed.toLowerCase())
  // '' is every agent's statement.
  const [agentId, setAgentId] = useState<string | null>(null)
  const chosen = agentId ?? named?.id ?? ''
  const agent = agents.find((a) => a.id === chosen) ?? null
  // Typed a moment ago in the composer: the card comes into view, however long the conversation above it.
  const top = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    void top.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  return (
    <div ref={top}>
      <Card data-testid="chat-statement">
        <div className="flex flex-col gap-1 pt-3">
          <p className="px-4 text-caption text-muted">
            Download a statement <span className="break-all font-mono">{command}</span>
          </p>
          {book.isError ? (
            <p className="px-4 text-caption text-muted">Your agents could not be read just now.</p>
          ) : book.data !== undefined && agents.length === 0 ? (
            <p className="px-4 text-caption text-muted">
              The workspace has no agent yet. Launch one with <span className="font-mono">/agent</span>; its statement starts
              the first time its wallet is funded.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-1 px-4 pt-2">
                <select
                  aria-label="Whose statement"
                  className={`${selectClass} wide:max-w-48`}
                  value={chosen}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  <option value="">Every agent</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {typed !== '' && named === undefined && book.data !== undefined && agentId === null ? (
                  <p className="text-caption text-muted">No agent is called “{typed}” — this is every agent’s; pick one.</p>
                ) : null}
              </div>
              {/* The form Agent Wallets uses, so the file is the one it downloads. Send stays the view's one primary. */}
              <StatementDownload key={chosen} agent={agent} month="this" />
            </>
          )}
          <div className="flex w-full flex-col gap-2 px-4 pb-3 wide:flex-row wide:items-center">
            <Button type="button" className="h-12 w-full wide:h-8 wide:w-auto" onClick={onClose}>
              Close
            </Button>
            <Link className={`${inlineLink} text-caption`} to="/statements">
              See every statement
            </Link>
          </div>
        </div>
      </Card>
    </div>
  )
}
