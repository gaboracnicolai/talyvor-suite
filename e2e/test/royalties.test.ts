import { describe, expect, it } from 'vitest'
import { type RoyaltiesSeen, royaltiesVerdict } from '../src/royalties.ts'

const app = 'http://localhost:8797'

// What the app shows today (apps/web/src/areas/lens/Sharing.tsx, Earnings.tsx, TopUp.tsx, Overview.tsx, App.tsx).
const today: RoyaltiesSeen = {
  sharing: {
    header: 'Shared answers (saves on repeated questions)',
    body:
      ' Shared answers save on repeated questions. When another company has already asked a near-identical question, this workspace can be served their answer instead of paying a model for a new one — and an answer produced here may be served to them the same way. ' +
      'If sharing is on Repeated questions are served instantly from shared answers, without paying a model. The content of your answers leaves this workspace. When another company is served one of your answers, you earn a small royalty, shown on Royalties. ' +
      'If sharing is off You pay full price for repeated questions. You are never served another company’s answers. New answers produced here are not shared, and earn no royalty.',
    link: `${app}/statements/royalties`,
  },
  royalties: {
    framing: 'Sharing answers exists to save on repeated questions: an answer another company already paid for is served to you without paying a model. When one of yours is served to them, this workspace earns a small royalty in LENS — a side effect of sharing, not what it is for. Shared answers in Settings',
    text: 'ROYALTIES What your shared answers earned … CONVERT TO LXC This workspace has not earned any LENS. LENS is earned, not bought — nothing in this product sells it.',
  },
  lens: 'none',
  earnings: `${app}/statements/royalties`,
  nav: [
    { name: 'Home', href: '/', x: 24 },
    { name: 'Agent Wallets', href: '/agents', x: 24 },
    { name: 'Statements', href: '/statements', x: 24 },
    { name: 'Royalties', href: '/statements/royalties', x: 44 },
    { name: 'Chat', href: '/chat', x: 24 },
    { name: 'Billing', href: '/billing', x: 24 },
    { name: 'Ledger', href: '/ledger', x: 24 },
  ],
  billing: { text: 'Your agents spend from their own wallets, each with a budget and rules. Fund your agents', fund: `${app}/agents` },
  overview: { text: 'LENS Lifetime earned … Convert to LXC the rate and the conversion are on Royalties Open Royalties', converts: false },
}

// The same screens before B28.10 (3bd1690^): earning first, Earnings in Billing, the conversion on Overview.
const before: RoyaltiesSeen = {
  sharing: {
    header: 'Sharing answers with other companies',
    body:
      ' Talyvor can reuse answers across companies. A response produced for this workspace may be served to another company asking a near-identical question, and this workspace may be served from theirs. ' +
      'If sharing is on Your answers earn you LENS each time another company reuses one. You are served instantly, and without paying a model, from theirs. The content of your answers leaves this workspace. ' +
      'If sharing is off Nothing new produced here is shared. You are never served another company’s answers. New answers earn nothing from reuse, and you pay full price for repeated questions.',
    link: `${app}/settings`,
  },
  royalties: { framing: '', text: 'Earnings What your shared answers earned' },
  lens: 'none',
  earnings: `${app}/earnings`,
  nav: [
    { name: 'Agent Wallets', href: '/agents', x: 24 },
    { name: 'Statements', href: '/statements', x: 24 },
    { name: 'Chat', href: '/chat', x: 24 },
    { name: 'Ledger', href: '/ledger', x: 24 },
    { name: 'Earnings', href: '/earnings', x: 24 },
  ],
  billing: { text: 'Add credit', fund: `${app}/billing` },
  overview: { text: 'Convert to LXC LENS is earned, not bought — nothing in this product sells it.', converts: true },
}

describe('B28.10 — sharing is a saving first, and Royalties is under Statements', () => {
  it('passes the screens as the app draws them today', () => {
    expect(royaltiesVerdict(today)).toEqual({ pass: true, detail: expect.stringContaining('Royalties sits under Statements') })
  })

  it('fails the screens as they were before B28.10, naming each thing taken away', () => {
    const v = royaltiesVerdict(before)
    expect(v.pass).toBe(false)
    for (const said of [
      'not "Shared answers (saves on repeated questions)"',
      'before what it saves',
      'does not call what an answer earns a royalty',
      "Royalties link went to /settings",
      'does not open by calling a royalty a side effect',
      'does not carry the LENS→LXC conversion',
      '/earnings landed on /earnings',
      "row under Statements is \"Chat\"",
      'still lists "Earnings"',
      'not Agent Wallets',
      'Overview still says "LENS is earned, not bought"',
      'Overview still offers the conversion itself',
    ]) expect(v.detail).toContain(said)
  })

  it('fails a royalty listed before the saving on the "on" side, and Royalties drawn flush with Statements', () => {
    const on = today.sharing.body.replace(
      'If sharing is on Repeated questions',
      'If sharing is on You earn a small royalty when another company is served one of your answers. Repeated questions',
    )
    expect(royaltiesVerdict({ ...today, sharing: { ...today.sharing, body: on } }).detail).toContain('royalty is not the last thing')
    const flush = today.nav.map((l) => (l.name === 'Royalties' ? { ...l, x: 24 } : l))
    expect(royaltiesVerdict({ ...today, nav: flush }).detail).toContain('Royalties is not indented under Statements')
  })

  it('asks Royalties for the conversion this workspace’s LENS calls for', () => {
    expect(royaltiesVerdict({ ...today, lens: 'spendable' }).detail).toContain('does not say "Convert to LXC…"')
    expect(royaltiesVerdict({ ...today, lens: 'held' }).detail).toContain('does not say "Only spendable LENS converts"')
  })
})
