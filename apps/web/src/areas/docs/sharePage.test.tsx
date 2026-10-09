import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharePage } from './SharePage'

// B28.447 — Share makes a view-only link through the BFF and shows the address a stranger opens; a person who is not
// an admin of the page is told so instead of being shown a link.

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SharePage', () => {
  it('shows the link Docs signed, under /docs/s/', async () => {
    const fetchMock = vi.fn(async () => new Response('{"link":{"token":"s1_abc.c2ln"},"share_url":"/s/s1_abc.c2ln"}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<SharePage spaceId="sp eng" pageId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    expect(await screen.findByRole('textbox', { name: 'Link to this page' })).toHaveValue(`${window.location.origin}/docs/s/s1_abc.c2ln`)
    expect(fetchMock).toHaveBeenCalledWith('/api/docs/spaces/sp%20eng/pages/p1/share', expect.objectContaining({ method: 'POST' }))
  })

  it('says only an admin can share when Docs refuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"forbidden"}', { status: 403 })))

    render(<SharePage spaceId="s1" pageId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin of this page can share it.')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
