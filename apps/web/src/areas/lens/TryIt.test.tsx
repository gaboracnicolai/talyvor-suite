import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B11.3 — the Try-it pages run Tare and document conversion through the BFF's preview routes and show
// what Lens did: the reduced content and its saving, "nothing to reduce" when Tare declines, and the
// converted document with a download.

const REDUCED = {
  reduced: '{"users":{"cols":["id","name"],"rows":[[1,"ada"],[2,"bob"]]}}',
  kind: 'json',
  refused: false,
  refusal_reasons: null,
  tokens_in_estimated: 120,
  tokens_out_estimated: 45,
  tokens_saved_estimated: 75,
  model: 'gpt-4o',
  saving_usd_estimated: 0.0001875,
}
const REFUSED = {
  reduced: 'What is SSO?',
  kind: '',
  refused: true,
  refusal_reasons: ['content is not valid JSON'],
  tokens_in_estimated: 3,
  tokens_out_estimated: 3,
  tokens_saved_estimated: 0,
  model: 'gpt-4o',
  saving_usd_estimated: 0,
}

function mockBff(posts: Array<{ url: string; body: unknown; type: string | null }>, tareAnswer: unknown) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    if (url === '/auth/me') return json({ mode: 'disabled', authenticated: false, user: null })
    if (url === '/api/models')
      return json([
        {
          id: 'gpt-4o',
          provider: 'openai',
          display_name: 'GPT-4o',
          input_per_1m: 2.5,
          output_per_1m: 10,
        },
      ])
    const type = new Headers(init?.headers).get('Content-Type')
    if (url === '/api/features/tare/preview') {
      posts.push({ url, body: JSON.parse(String(init?.body)), type })
      return json(tareAnswer)
    }
    if (url === '/api/features/conversion/preview') {
      posts.push({ url, body: init?.body, type })
      return json({
        markdown: '# Quarterly plan\n\nShip it.',
        format: 'html',
        needs_vision: false,
        savings: {
          input_bytes: 900,
          output_bytes: 26,
          input_tokens_raw: 225,
          input_tokens_distilled: 7,
          tokens_saved: 218,
        },
      })
    }
    return json({})
  })
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('Try Tare', () => {
  it('sends the paste to the preview and shows the reduced content and its estimated saving', async () => {
    const posts: Array<{ url: string; body: unknown; type: string | null }> = []
    mockBff(posts, REDUCED)
    window.history.pushState({}, '', '/features/try/tare')
    render(<App />)
    await waitFor(() => expect(screen.getByRole('option', { name: 'GPT-4o' })).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Content'), {
      target: {
        value: '{"users":[{"id":1,"name":"ada"},{"id":2,"name":"bob"}]}',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run Tare' }))

    const result = await screen.findByTestId('tare-reduced')
    expect(posts[0].body).toEqual({
      content: '{"users":[{"id":1,"name":"ada"},{"id":2,"name":"bob"}]}',
      kind: '',
      model: 'gpt-4o',
    })
    expect(result.textContent).toContain('About 120 tokens become 45 — 75 fewer (estimated)')
    expect(result.textContent).toContain('$0.00019 less per request on GPT-4o')
    expect(result.textContent).toContain(REDUCED.reduced)
  })

  it('says there is nothing to reduce, and why, instead of implying a saving', async () => {
    mockBff([], REFUSED)
    window.history.pushState({}, '', '/features/try/tare')
    render(<App />)
    fireEvent.change(await screen.findByLabelText('Content'), {
      target: { value: 'What is SSO?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run Tare' }))

    const refused = await screen.findByTestId('tare-refused')
    expect(screen.getByRole('heading', { name: 'Nothing to reduce' })).toBeTruthy()
    expect(refused.textContent).toContain('Tare would send this unchanged')
    expect(refused.textContent).toContain('content is not valid JSON')
    expect(refused.textContent).not.toContain('$')
  })
})

describe('Try document conversion', () => {
  it('uploads the document under its media type and shows the converted text with a download', async () => {
    const posts: Array<{ url: string; body: unknown; type: string | null }> = []
    mockBff(posts, REDUCED)
    window.history.pushState({}, '', '/features/try/conversion')
    render(<App />)
    const file = new File(['<h1>Quarterly plan</h1><p>Ship it.</p>'], 'plan.html', { type: 'text/html' })
    fireEvent.change(await screen.findByLabelText('Document'), {
      target: { files: [file] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))

    const result = await screen.findByTestId('conversion-result')
    expect(posts[0].type).toBe('text/html')
    expect(posts[0].body).toBe(file)
    expect(result.textContent).toContain('The HTML file is about 225 tokens; as text, about 7 — 218 fewer (estimated).')
    expect(result.textContent).toContain('# Quarterly plan')
    expect(screen.getByRole('button', { name: 'Download as Markdown' })).toBeTruthy()
  })
})
