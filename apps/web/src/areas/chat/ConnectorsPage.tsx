import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Input, inlineLink } from '@talyvor/ui'

import { useAuthMeReader } from '../../lib/authMe'
import { type Connector, type Connectors, TEST_TOOLS_NAME, fetchConnectorTools, loadConnectors, saveConnectors, testToolsURL } from './connectors'

// B28.122 — connectors: the person's own MCP servers, added here by address and linked from Chat's rail. Chat offers
// every connector's tools to the model beside Talyvor's own (Chat.tsx run()), and lists each call it made under the
// answer with what it cost. A connector is checked before it is added: one whose tools cannot be read is not kept.

/** One connector on the page: its address, and its tools as it lists them just now. */
function ConnectorCard({ connector, onRemove }: { connector: Connector; onRemove: () => void }) {
  const tools = useQuery({ queryKey: ['chat-connector', connector.id], queryFn: () => fetchConnectorTools(connector), retry: false, staleTime: 60_000 })
  return (
    <li className="flex flex-col gap-2 rounded-card border border-rule bg-raised p-4" data-testid="connector-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 break-words text-body font-medium text-ink">{connector.name}</p>
        <Button onClick={onRemove}>Remove</Button>
      </div>
      <p className="min-w-0 break-all font-figure text-caption text-muted">{connector.url}</p>
      {tools.isPending ? (
        <p className="text-caption text-muted">Reading its tools…</p>
      ) : tools.isError ? (
        <p className="text-caption text-ink" role="alert">
          {tools.error.message} Chat offers none of its tools until it answers.
        </p>
      ) : tools.data.tools.length === 0 ? (
        <p className="text-caption text-muted">It lists no tools.</p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="connector-tools">
          {tools.data.tools.map((t) => (
            <li key={t.name} className="min-w-0 text-caption text-muted">
              <span className="font-figure text-ink">{t.name}</span>
              {t.description !== '' ? <> — {t.description}</> : null}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function ConnectorsPage() {
  // Scoped to who is signed in, exactly as Chat.tsx scopes the conversations; until that is known there is nowhere
  // to keep them.
  const me = useAuthMeReader()
  const scope = me.data?.user?.sub ?? me.data?.workspace_id ?? (me.data?.mode === 'disabled' ? 'local' : null)
  const [stored, setStored] = useState<Connectors>({ list: [], error: null })
  const list = stored.list
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    if (scope !== null) setStored(loadConnectors(scope))
  }, [scope])

  const keep = (next: Connector[], done: string) => {
    if (scope === null) return false
    if (!saveConnectors(scope, next)) {
      setSaid('This browser refused to save it, so Chat will not offer it.')
      return false
    }
    setStored({ list: next, error: null })
    setSaid(done)
    return true
  }

  /** Reads the connector's tools first: one that cannot list them is not added, and the page says why. */
  const add = async (given: { name: string; url: string; token: string }) => {
    setChecking(true)
    setSaid(null)
    const address = given.url.trim()
    const secret = given.token.trim()
    try {
      const listed = await fetchConnectorTools({ url: address, ...(secret !== '' ? { token: secret } : {}) })
      const now = Date.now()
      const called = given.name.trim() || listed.server || new URL(address).host
      const added: Connector = { id: `c-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: called, url: address, ...(secret !== '' ? { token: secret } : {}), added_at: now }
      const count = listed.tools.length
      if (keep([...list, added], `Added ${called}: Chat offers its ${count === 1 ? 'tool' : `${count} tools`} in every chat.`)) {
        setName('')
        setUrl('')
        setToken('')
      }
    } catch (e) {
      setSaid(`Not added. ${e instanceof Error ? e.message : 'The connector could not be read.'}`)
    } finally {
      setChecking(false)
    }
  }

  const testURL = testToolsURL()
  const hasTestTools = list.some((c) => c.url === testURL)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      {/* The page's name is the console banner's <h1> (CONSOLE_ROUTES' title), so no second one here. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-body text-muted">
          Your own MCP servers. Chat offers their tools to the model beside Talyvor’s own, in every chat, and asks you
          before every call: what the model sends goes to that server. Under each answer, every call is listed with what
          it cost.
        </p>
        <Link className={`text-body text-ink ${inlineLink}`} to="/chat">
          Back to Chat
        </Link>
      </div>

      {me.isPending ? (
        <p className="text-body text-muted">Reading who is signed in…</p>
      ) : scope === null ? (
        <p className="text-body text-ink" role="alert">
          Who is signed in could not be read, so there is nowhere to keep connectors.
        </p>
      ) : (
        <>
          {stored.error !== null ? (
            <p className="text-body text-ink" role="alert">
              {stored.error} Adding one here replaces them.
            </p>
          ) : list.length === 0 ? (
            <p className="text-body text-muted">No connectors yet. Add one below, or try {TEST_TOOLS_NAME} first.</p>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="connectors">
              {list.map((c) => (
                <ConnectorCard key={c.id} connector={c} onRemove={() => keep(list.filter((o) => o.id !== c.id), `Removed ${c.name}. Chat no longer offers its tools.`)} />
              ))}
            </ul>
          )}

          {!hasTestTools ? (
            <section className="flex flex-col gap-2 rounded-card border border-rule bg-raised p-4" aria-labelledby="connectors-test">
              <h2 id="connectors-test" className="text-body font-medium text-ink">
                {TEST_TOOLS_NAME}
              </h2>
              <p className="text-caption text-muted">
                A connector to try this with. Its one tool, fingerprint, gives the first 12 hex digits of a text’s SHA-256 —
                something no model can work out by itself. Ask Chat for the fingerprint of a word, allow the call, and see
                what it cost.
              </p>
              <div>
                <Button disabled={checking} onClick={() => void add({ name: TEST_TOOLS_NAME, url: testURL, token: '' })}>
                  Add {TEST_TOOLS_NAME}
                </Button>
              </div>
            </section>
          ) : null}

          <form
            className="flex flex-col gap-3 rounded-card border border-rule bg-raised p-4"
            aria-labelledby="connectors-new"
            onSubmit={(e) => {
              e.preventDefault()
              void add({ name, url, token })
            }}
          >
            <h2 id="connectors-new" className="font-figure text-eyebrow uppercase text-label">
              Add a connector
            </h2>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">Address</span>
              <Input className="font-figure" type="url" placeholder="https://mcp.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">Name (optional — the server’s own name if left empty)</span>
              <Input placeholder="Weather" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-muted">Token (optional — sent to this server only, as a bearer token)</span>
              <Input className="font-figure" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" disabled={checking || url.trim() === ''}>
                {checking ? 'Checking…' : 'Add connector'}
              </Button>
            </div>
            <p className="text-caption text-muted">Kept in this browser only, with your conversations.</p>
          </form>
          {said !== null ? (
            <p className="text-body text-ink" role="status" data-testid="connectors-said">
              {said}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
