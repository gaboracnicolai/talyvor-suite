import { getConfig } from '@testing-library/react'
import { expect, it } from 'vitest'

// B26.31 — test-setup.ts gives every findBy/waitFor 3s before it gives up, so a wait on a loaded
// machine does not fail a test that passes alone.
it('every async query waits 3s by default, not Testing Library’s 1s', () => {
  expect(getConfig().asyncUtilTimeout).toBe(3_000)
})
