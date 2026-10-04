// B27.31 — what /documentation says, kept apart from how it is drawn so the test can walk every
// claim. Each claim names ONE thing a person can do today and links to the screen or route that
// does it; Documentation.test.tsx resolves every internal link against the routes the app
// actually mounts, so a screen that is removed or renamed fails the build instead of leaving a
// link here to "Nothing at this address".
//
// ONLY WHAT SHIPS. Each claim was read off the screen it links to (or the help page that screen
// links to), not off a roadmap. Talyvor Code is described as the Marketplace extension and the
// CLI, the two surfaces a user installs today; the JetBrains plugin is not on a marketplace and is
// not listed. Lens's routes are in lens-routes.json, extracted from Lens's source and checked by
// scripts/lens-routes.mjs in CI.

export const DOCUMENTATION_PATH = '/documentation'

/** The hosted gateway. Answered /healthz, /status and /openapi.json on 2026-10-04. */
export const LENS_ORIGIN = 'https://lens.talyvor.com'

export const CODE_MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=talyvor.talyvor-code'
export const CODE_INSTALL_URL = 'https://raw.githubusercontent.com/gaboracnicolai/talyvor-code/main/install.sh'

export interface Claim {
  /** One sentence: what a person can do. */
  text: string
  /** Where they do it — an in-app path, or an absolute URL for something outside the app. */
  href: string
  /** The link's own words. */
  label: string
}

export interface Capability {
  id: string
  name: string
  role: string
  lede: string
  claims: Claim[]
}

// B28.15 — wallet-first: getting started is giving one agent a wallet and watching it spend, and
// Agent Wallets is the first capability (lens-routes.json lists its routes first too).
export const START: Claim[] = [
  { text: 'Create a workspace with an account you already have.', href: '/signup', label: 'Sign up' },
  {
    text: 'Create an agent. It gets a wallet of its own, empty until you fund it.',
    href: '/agents',
    label: 'Agent Wallets — Create agent',
  },
  {
    text: 'Fund its wallet from the workspace’s balance. The agent can spend only what its wallet holds.',
    href: '/agents',
    label: 'Agent Wallets — Fund',
  },
  {
    text: 'Issue the agent its own key: a proxy key that spends only this agent’s balance, under its rules. It is shown once.',
    href: '/agents',
    label: 'Agent Wallets — Issue a key',
  },
  {
    text: 'Give the agent that key and the base URL Setup prints for Claude Code, Cursor, Continue or the OpenAI SDK.',
    href: '/setup',
    label: 'Setup',
  },
  {
    text: 'Watch its statement: every request the agent makes is a line with what it cost and the balance left.',
    href: '/agents',
    label: 'Agent Wallets — Statement',
  },
]

export const CAPABILITIES: Capability[] = [
  {
    id: 'wallets',
    name: 'Agent Wallets',
    role: 'A wallet for each AI agent',
    lede: 'Each agent a workspace runs gets a wallet of its own on Lens’s double-entry ledger: the workspace funds it, the agent spends only what it holds, and its statement is every posting against it. Lens checks the rules before a provider is called or a payment moves.',
    claims: [
      { text: 'Create an agent, fund its wallet and take funds back.', href: '/agents', label: 'Agent Wallets' },
      {
        text: 'Issue the agent a key that spends only its own balance, under its rules.',
        href: '/agents',
        label: 'Agent Wallets',
      },
      {
        text: 'Set its spending rules; a payment past them waits in your approvals inbox, and a passkey can be required to approve it.',
        href: '/agents',
        label: 'Agent Wallets',
      },
      { text: 'Pause one agent, or stop every agent with one switch.', href: '/agents', label: 'Agent Wallets' },
      { text: 'Read and download each wallet’s statement.', href: '/agents', label: 'Agent Wallets' },
      {
        text: 'Agents pay each other, hold money in escrow, and lend between companies. Investing is simulated: no order reaches a market.',
        href: '/agents',
        label: 'Agent Wallets',
      },
      { text: 'Every wallet route Lens answers, with what each one does.', href: '#lens-wallets', label: 'Lens API — Agent Wallets' },
    ],
  },
  {
    id: 'chat',
    name: 'Chat',
    role: 'Conversations with any priced model',
    lede: 'A chat screen that sends every question through Lens, so each answer is metered, recorded and paid from the workspace balance like any other request.',
    claims: [
      {
        text: 'Ask a question and the answer streams in; Stop ends it and keeps what has arrived.',
        href: '/chat',
        label: 'Chat',
      },
      {
        text: 'Pick the model from every priced model the deployment serves, each with its price per million tokens.',
        href: '/chat/help',
        label: 'How to use Chat — Models',
      },
      {
        text: 'Attach PDF, Word, Excel, PowerPoint, CSV, HTML, JSON, XML, text or Markdown files up to 25 MB; Lens converts them to text first, so the model is billed for the words, not the file.',
        href: '/chat/help',
        label: 'How to use Chat — Attaching documents',
      },
      {
        text: 'Mark a wrong answer and the stored answer is removed, so it is never served again to you or anyone.',
        href: '/chat/help',
        label: 'How to use Chat — Asking',
      },
      {
        text: 'Turn document conversion on or off for the workspace.',
        href: '/settings',
        label: 'Settings',
      },
    ],
  },
  {
    id: 'docs',
    name: 'Docs',
    role: 'Team wiki',
    lede: 'Spaces and pages for a team, with AI help on the page you are writing and the cost of that help shown where you write.',
    claims: [
      { text: 'Create spaces and write pages in them; a save records a new version.', href: '/docs', label: 'All documents' },
      { text: 'Search every page in the workspace, or ask a question across them.', href: '/docs', label: 'All documents' },
      {
        text: 'On a page: summarise it, translate it, get a title suggested, read its changelog, or ask AI about a selection — and see what that AI work cost.',
        href: '/docs',
        label: 'Open a page from All documents',
      },
      {
        text: 'Pin pages to the sidebar; the last five you opened are listed under them.',
        href: '/docs',
        label: 'All documents',
      },
    ],
  },
  {
    id: 'track',
    name: 'Track',
    role: 'Issue tracker',
    lede: 'Issues, a board, cycles and projects, with the AI cost of each issue recorded against it.',
    claims: [
      {
        text: 'Work the issue list from the keyboard: c new, / search, j and k to move, e edit, s status, a assign, x close.',
        href: '/track',
        label: 'Issues',
      },
      {
        text: 'On an issue: summarise its thread, find likely duplicates, and get a triage suggestion — each metered through Lens.',
        href: '/track',
        label: 'Issues',
      },
      { text: 'Export every issue the current view matches, as CSV or JSON.', href: '/track', label: 'Issues' },
      {
        text: 'See every issue in a column for where it stands, and publish the board as a read-only link anyone can open without an account.',
        href: '/track/board',
        label: 'Board',
      },
      { text: 'Plan work in cycles.', href: '/track/cycles', label: 'Cycles' },
      { text: 'Group issues into projects and open a project’s issues.', href: '/track/projects', label: 'Projects' },
    ],
  },
  {
    id: 'marketplace',
    name: 'Marketplace',
    role: 'Agents, prompts, skills, evaluations and pipelines',
    lede: 'Use what other teams published and publish your own. A listing runs through Lens as your workspace, and a paid listing’s price goes on your monthly bill.',
    claims: [
      { text: 'Browse and search published listings, and open one to use it.', href: '/marketplace', label: 'Browse' },
      { text: 'Publish a listing, and new versions of it.', href: '/marketplace/publish', label: 'Publish' },
      {
        text: 'See what your listings earned, and connect a Stripe account to be paid.',
        href: '/marketplace/selling',
        label: 'Your listings & earnings',
      },
      { text: 'See what you owe for the listings you used.', href: '/marketplace/bill', label: 'Your bill' },
    ],
  },
  {
    id: 'code',
    name: 'Talyvor Code',
    role: 'Coding agent, from the Marketplace',
    lede: 'A VS Code extension and a command-line agent whose every model call goes through Lens, so coding work lands in the same ledger as everything else.',
    claims: [
      {
        text: 'Install the Talyvor Code extension from the Visual Studio Marketplace.',
        href: CODE_MARKETPLACE_URL,
        label: 'Talyvor Code on the Marketplace',
      },
      {
        text: 'In its settings, set talyvor.lensUrl to your gateway and talyvor.lensApiKey to a key minted here.',
        href: '/keys',
        label: 'API keys',
      },
      {
        text: 'Install the talyvor-code CLI with its installer, which refuses a binary whose SHA-256 does not match the release.',
        href: CODE_INSTALL_URL,
        label: 'install.sh',
      },
      {
        text: 'Or point Claude Code itself at Lens with the two variables Setup prints.',
        href: '/setup',
        label: 'Setup — Claude Code',
      },
    ],
  },
]

export interface Licence {
  repo: string
  what: string
  /** Exactly as the repository's LICENSE names it. */
  licence: string
  /** Anything the LICENSE carves out, in its own terms. */
  except?: string
}

// Read from each repository's LICENSE on 2026-10-04. All five are the Business Source License 1.1
// with Change Date 2030-07-26 and Change License "Apache License, Version 2.0". The suite's own row
// is checked against ../../LICENSE by Documentation.test.tsx.
export const CHANGE_DATE = '2030-07-26'
export const CHANGE_LICENCE = 'Apache License, Version 2.0'

export const LICENCES: Licence[] = [
  { repo: 'talyvor-suite', what: 'This app: the console, Chat, the screens for Docs, Track, Wallets and Marketplace', licence: 'Business Source License 1.1' },
  {
    repo: 'talyvor-lens',
    what: 'The gateway and its API',
    licence: 'Business Source License 1.1',
    except: 'the client SDKs in sdk/typescript/ and sdk/python/ are under the MIT License',
  },
  { repo: 'talyvor-track', what: 'The issue tracker service', licence: 'Business Source License 1.1' },
  { repo: 'talyvor-docs', what: 'The wiki service', licence: 'Business Source License 1.1' },
  { repo: 'talyvor-code', what: 'The VS Code extension and the CLI', licence: 'Business Source License 1.1' },
]

export const licenceUrl = (repo: string) => `https://github.com/gaboracnicolai/${repo}/blob/main/LICENSE`
