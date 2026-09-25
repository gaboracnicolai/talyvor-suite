import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ChatHelp } from './ChatHelp'

describe('How to use Talyvor Chat (B10.3)', () => {
  it('holds the explanations the chat screen no longer carries', () => {
    render(
      <MemoryRouter>
        <ChatHelp />
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Asking',
      'Models',
      'Attaching documents',
      'What an answer costs',
      'Where conversations are kept',
    ])
    // The price line is the catalog's rate, never this conversation's bill (see Chat.tsx's header).
    expect(screen.getByText(/catalog rate, not this conversation/i)).toBeTruthy()
    // Where history is kept, in full.
    expect(screen.getByText(/In this browser only, for the account you are signed in with/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to the chat' }).getAttribute('href')).toBe('/chat')
  })
})
