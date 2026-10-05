import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportHTML } from './ExportHTML'

// B29.30 — Export as HTML asks the BFF for the page's HTML export and saves it under the filename
// Docs gave it; a refused export says so instead of saving an error as a page.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ExportHTML', () => {
  it('downloads the page Docs rendered, under Docs’ filename', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('<!doctype html><h1>Runbook</h1>', {
        status: 200,
        headers: { 'Content-Type': 'text/html', 'Content-Disposition': 'attachment; filename="runbook.html"' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const blobs: Blob[] = []
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), 'blob:export'))
    URL.revokeObjectURL = vi.fn()
    const saved: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })

    render(<ExportHTML spaceId="sp eng" pageId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Export as HTML' }))

    await waitFor(() => expect(saved).toEqual(['runbook.html']))
    expect(fetchMock).toHaveBeenCalledWith('/api/docs/spaces/sp%20eng/pages/p1/export?format=html', expect.anything())
    const text = await new Promise<string>((done) => {
      const r = new FileReader()
      r.onload = () => done(String(r.result))
      r.readAsText(blobs[0])
    })
    expect(text).toBe('<!doctype html><h1>Runbook</h1>')
    expect(blobs[0].type).toBe('text/html')
  })

  it('says the export failed rather than saving the error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"page not found"}', { status: 404 })))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')

    render(<ExportHTML spaceId="s1" pageId="gone" />)
    fireEvent.click(screen.getByRole('button', { name: 'Export as HTML' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t export this page')
    expect(click).not.toHaveBeenCalled()
  })
})
