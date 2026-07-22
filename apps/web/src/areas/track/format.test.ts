import { describe, expect, it } from 'vitest'
import { formatUSD, formatWhen, priorityLabel, statusLabel } from './format'

describe('track formatters', () => {
  it('formatWhen renders the shared compact clock and passes garbage through', () => {
    expect(formatWhen('2026-07-19T14:52:59Z')).toMatch(/Jul 19/)
    expect(formatWhen('not-a-date')).toBe('not-a-date')
  })

  it('statusLabel covers the whole six-value enum from model.go', () => {
    expect(statusLabel('backlog')).toBe('Backlog')
    expect(statusLabel('todo')).toBe('Todo')
    expect(statusLabel('in_progress')).toBe('In progress')
    expect(statusLabel('in_review')).toBe('In review')
    expect(statusLabel('done')).toBe('Done')
    expect(statusLabel('cancelled')).toBe('Cancelled')
  })

  it('priorityLabel maps 0–4 per model.IssuePriority', () => {
    expect(priorityLabel(0)).toBe('None')
    expect(priorityLabel(1)).toBe('Urgent')
    expect(priorityLabel(2)).toBe('High')
    expect(priorityLabel(3)).toBe('Medium')
    expect(priorityLabel(4)).toBe('Low')
  })

  it('formatUSD renders plain dollars (ai_cost_usd is a float USD rollup, not µ-units)', () => {
    expect(formatUSD(0.42)).toBe('$0.42')
    expect(formatUSD(1130.5)).toBe('$1,130.50')
  })
})
