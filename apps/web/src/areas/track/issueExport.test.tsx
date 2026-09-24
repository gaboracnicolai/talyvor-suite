import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IssueList } from './IssueList'
import { CSV_COLUMNS, fetchAllIssues, issuesCSV, totalAICost } from './issueExport'
import type { TrackIssue } from './types'

// B4.4 — "download a CSV of issues whose AI-cost column matches what the API reports for the same
// issues". Driven at the wire.

function issue(n: number, cost: number): TrackIssue {
  return {
    id: `iss-${n}`, workspace_id: 'w', team_id: 'team-1', number: n, identifier: `ENG-${n}`,
    title: `Issue ${n}`, description: '', status: 'todo', priority: 2, creator_id: 'u',
    lens_feature: '', ai_cost_usd: cost, ai_tokens: n * 10,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
  } as TrackIssue
}

/** 253 issues across two BFF pages, with costs that do not round prettily. */
const ALL = Array.from({ length: 253 }, (_, i) => issue(i + 1, [0.4213, 0.0071, 0, 1.2345678][i % 4] as number))

function mockIssues() {
  const asked: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    asked.push(url)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/api/track/issues?')) {
      const q = new URL(url, 'http://x').searchParams
      const limit = Number(q.get('limit') ?? 50)
      const offset = Number(q.get('offset') ?? 0)
      return json(ALL.slice(offset, offset + limit))
    }
    if (url === '/api/track/teams') return json([{ id: 'team-1', identifier: 'ENG', name: 'Engineering' }])
    return json([])
  })
  return asked
}

afterEach(() => vi.restoreAllMocks())

describe('issue export', () => {
  it('reads EVERY matching issue, and the CSV’s AI-cost column sums to the API’s own total', async () => {
    const asked = mockIssues()
    const { issues, truncated } = await fetchAllIssues(new URLSearchParams('status=todo'))
    expect(issues).toHaveLength(253)
    expect(truncated).toBe(false)
    expect(asked.filter((u) => u.startsWith('/api/track/issues?'))).toEqual([
      '/api/track/issues?status=todo&limit=250&offset=0',
      '/api/track/issues?status=todo&limit=250&offset=250',
    ])

    const csv = issuesCSV(issues, { assignee: () => '', team: () => 'ENG', project: () => '' })
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    const col = CSV_COLUMNS.indexOf('ai_cost_usd')
    const fromFile = lines.slice(1).map((l) => Number(l.split(',')[col]))
    // The file carries the API's numbers verbatim, so its sum IS the API's sum.
    expect(fromFile).toEqual(ALL.map((i) => i.ai_cost_usd))
    expect(fromFile.reduce((a, b) => a + b, 0)).toBe(totalAICost(ALL))
  })

  it('keeps a title a title: quoted when it must be, never read as a spreadsheet formula', () => {
    const tricky = { ...issue(1, 0.1), title: '=HYPERLINK("http://x","click"), then more' }
    const row = issuesCSV([tricky], { assignee: () => '', team: () => 'ENG', project: () => '' }).split('\r\n')[1]
    expect(row).toContain(`"'=HYPERLINK(""http://x"",""click""), then more"`)
  })

  it('exports the view from the issue list, and says how many and what they cost', async () => {
    mockIssues()
    let saved = ''
    URL.createObjectURL = vi.fn((b: Blob) => {
      // jsdom's Blob has no .text(); FileReader is how it reads one.
      const fr = new FileReader()
      fr.onload = () => (saved = String(fr.result))
      fr.readAsText(b)
      return 'blob:x'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <IssueList />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'CSV' }))
    await waitFor(() => {
      const status = screen.getAllByRole('status').find((el) => el.textContent?.startsWith('Exported'))
      expect(status?.textContent).toMatch(/^Exported 253 issue\(s\) · AI cost \$\d+\.\d{2} in total\.$/)
    })
    await waitFor(() => expect(saved.split('\r\n').filter(Boolean)).toHaveLength(254))
  })
})
