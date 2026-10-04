import { Link } from 'react-router-dom'
import { focusRing, inlineLink } from '@talyvor/ui'
import { priorityLabel, statusLabel } from './format'
import { ISSUE_LINK_ATTR, ISSUE_REF_ATTR } from './issueKeys'
import { ISSUE_STATUSES, type IssuePriority, type IssueStatus } from './types'

// B27.30 — the issue board: one column per status, in the workflow's order. The same columns draw
// the signed-in board (/track/board, each card a link the keyboard can reach) and the read-only
// public one (/board/:token, plain text — a stranger has nothing to open).

export interface BoardCard {
  identifier: string
  title: string
  status: IssueStatus
  priority: IssuePriority
  /** Set on the signed-in board only: the card opens the issue, and j/k/a/s/x reach it. */
  issueId?: string
}

/** Track's statuses are a closed six-value enum; a value outside it is not a column, so it is not drawn. */
function isStatus(s: string): s is IssueStatus {
  return (ISSUE_STATUSES as readonly string[]).includes(s)
}

export function BoardColumns({ cards }: { cards: BoardCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 wide:grid-cols-3">
      {ISSUE_STATUSES.map((status) => {
        const inColumn = cards.filter((c) => isStatus(c.status) && c.status === status)
        return (
          <section
            key={status}
            aria-label={statusLabel(status)}
            className="flex min-w-0 flex-col rounded-card border border-rule bg-surface"
          >
            <h3 className="flex items-baseline justify-between gap-2 border-b border-rule px-3 py-2 text-body text-ink">
              {statusLabel(status)}
              <span className="font-figure text-caption text-faint">{inColumn.length}</span>
            </h3>
            {/* An empty COLUMN is a status no issue is in. It is never a failed read: Board and
                PublicBoard answer a refused read themselves and only draw columns for a board that loaded. */}
            {inColumn.length > 0 ? (
              <ul className="flex flex-col">
                {inColumn.map((c) => (
                  <li key={c.identifier} className="border-b border-rule px-3 py-2 last:border-b-0">
                    <span className="block font-mono text-caption text-muted">{c.identifier}</span>
                    {c.issueId ? (
                      <Link
                        className={`text-body text-ink ${inlineLink} ${focusRing}`}
                        to={`/track/issues/${c.issueId}`}
                        {...{ [ISSUE_LINK_ATTR]: c.issueId, [ISSUE_REF_ATTR]: c.identifier }}
                      >
                        {c.title}
                      </Link>
                    ) : (
                      <span className="text-body text-ink">{c.title}</span>
                    )}
                    {c.priority !== 0 ? (
                      <span className="mt-1 block text-caption text-faint">{priorityLabel(c.priority)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-caption text-faint">Nothing here.</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
