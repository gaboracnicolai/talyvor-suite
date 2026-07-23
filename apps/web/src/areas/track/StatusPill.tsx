import { Pill, type PillStatus } from '@talyvor/ui'
import { statusLabel } from './format'
import type { IssueStatus } from './types'

// Track's six-value issue status, rendered as a design-system Pill. This used to
// hand-roll the pill markup because ui.Pill had no neutral status — but #13 gave
// Pill exactly the two neutrals Track needs (idle, parked), so that rationale is
// gone and this collapses to a pure mapping IssueStatus → PillStatus. The hues
// now live in ONE place (ui.Pill); the label carries the exact status.
//
//   backlog → parked  (shelved, dimmest — not dead, that is slashed)
//   todo    → idle    (present but unstarted)
//   in_progress / in_review → held (in flight; the label disambiguates the two)
//   done    → settled (landed)
//   cancelled → slashed (dead)
//
// This mirrors Track's own workflow model (workflow/engine.go StatusCategory:
// backlog / unstarted / started / completed / cancelled) — hue = category,
// label = the exact status.
const TO_PILL: Record<IssueStatus, PillStatus> = {
  backlog: 'parked',
  todo: 'idle',
  in_progress: 'held',
  in_review: 'held',
  done: 'settled',
  cancelled: 'slashed',
}

export function StatusPill({ status }: { status: IssueStatus }) {
  return <Pill status={TO_PILL[status]}>{statusLabel(status)}</Pill>
}
