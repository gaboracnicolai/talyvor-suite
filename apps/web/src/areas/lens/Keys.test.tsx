import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Keys } from './Keys'
import { fixtureKeys, fixtureMint } from './fixtures'

// The /keys screen exists because of one real failure: the mint response has
// `key` and `prefix` ADJACENT in one JSON object, they look alike, and the
// wrong one got copied. The design must make that mistake structurally
// impossible: the credential is shown ONCE with one unmistakable copy action;
// the prefix is a quiet labeled identifier that plainly is not a credential.

const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  writeText.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Keys — list', () => {
  it('lists existing keys by name, prefix, scopes and created date', () => {
    render(<Keys />)
    for (const k of fixtureKeys) {
      expect(screen.getByText(k.name)).toBeInTheDocument()
      expect(screen.getByText(k.key_prefix)).toBeInTheDocument()
    }
    expect(screen.getByText(/proxy, earn/)).toBeInTheDocument()
  })

  it('renders exactly one fixture notice (sample data is never silent)', () => {
    render(<Keys />)
    expect(screen.getAllByText(/placeholder/i)).toHaveLength(1)
    expect(screen.getByText(/sample data/i)).toBeInTheDocument()
  })
})

describe('Keys — the one-time reveal', () => {
  it('does not show any credential before minting', () => {
    render(<Keys />)
    expect(screen.queryByText(fixtureMint.key)).not.toBeInTheDocument()
  })

  it('mints → shows the full key ONCE with the warning, and the prefix as a labeled non-credential', () => {
    render(<Keys />)
    fireEvent.click(screen.getByRole('button', { name: /create key/i }))

    // The credential, and the fact it will not reappear.
    expect(screen.getByText(fixtureMint.key)).toBeInTheDocument()
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument()

    // The prefix is present but explicitly labeled as NOT a credential.
    expect(screen.getByText(fixtureMint.prefix)).toBeInTheDocument()
    expect(screen.getByText(/not a credential/i)).toBeInTheDocument()
  })

  it('the copy action copies THE KEY — never the prefix — and confirms in text', async () => {
    render(<Keys />)
    fireEvent.click(screen.getByRole('button', { name: /create key/i }))
    fireEvent.click(screen.getByRole('button', { name: /copy key/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(fixtureMint.key)
    expect(writeText).not.toHaveBeenCalledWith(fixtureMint.prefix)
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument()
  })

  it('dismissing the reveal removes the key from the DOM permanently; the list gains the new row', () => {
    render(<Keys />)
    fireEvent.click(screen.getByRole('button', { name: /create key/i }))
    fireEvent.click(screen.getByRole('button', { name: /i stored it/i }))

    expect(screen.queryByText(fixtureMint.key)).not.toBeInTheDocument()
    // The new key now appears in the list — by its prefix, not its value.
    expect(screen.getByText(fixtureMint.prefix)).toBeInTheDocument()
    // And there is no way back to the credential.
    expect(screen.queryByRole('button', { name: /copy key/i })).not.toBeInTheDocument()
  })
})
