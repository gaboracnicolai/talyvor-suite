import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, Row, formatDay, inlineLink } from '@talyvor/ui'
import { isSessionExpired } from '../../lib/productState'
import { BYOK, BYOK_PROVIDERS } from './planApi'
import { formatCents } from './topupApi'
import { PROVIDER_KEYS_KEY, ProviderKeyError, providerKeysApi, type ProviderKey } from './providerKeysApi'

// ProviderKeys.tsx — B27.27, "Your provider keys" on Settings (Lens B27.26).
//
// A key is typed once into a password field, sent to Lens, and gone from the page: the field is cleared on
// save and what is drawn afterwards is Lens's answer — the provider and the last four characters. Adding
// and replacing are the same write (Lens's PUT replaces), so the row offers whichever reads true.

/** Lens's sentence for a refused save or removal, as the screen says it. */
function refusal(err: unknown, nothing: string): string {
  if (isSessionExpired(err)) return `${nothing} — sign in again.`
  if (err instanceof ProviderKeyError && err.sentence) {
    const s = err.sentence.replace(/^byok: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return `${nothing}. You can try again.`
}

function ProviderKeyRow({ provider, stored, canAdd }: { provider: string; stored?: ProviderKey; canAdd: boolean }) {
  const qc = useQueryClient()
  const name = BYOK_PROVIDERS[provider] ?? provider
  const [mode, setMode] = useState<'idle' | 'editing' | 'removing'>('idle')
  const [typed, setTyped] = useState('')
  const done = () => {
    setTyped('')
    setMode('idle')
    void qc.invalidateQueries({ queryKey: PROVIDER_KEYS_KEY })
  }
  const save = useMutation({
    mutationFn: () => providerKeysApi.save(provider, typed.trim()),
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: () => providerKeysApi.remove(provider),
    onSuccess: done,
  })
  const failed = save.isError
    ? refusal(save.error, 'The key was not saved')
    : remove.isError
      ? refusal(remove.error, 'The key was not removed')
      : null

  return (
    <Row
      stack
      label={name}
      hint={
        stored ? (
          <span data-testid={`provider-key-${provider}`}>
            <span className="font-figure">•••• {stored.last4}</span>, added {formatDay(stored.updated_at)}
          </span>
        ) : (
          'No key'
        )
      }
    >
      <div className="flex flex-col gap-2 wide:items-end">
        {mode === 'editing' ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (typed.trim()) save.mutate()
            }}
          >
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label={`${name} API key`}
              placeholder="Paste your key"
              className="w-56 font-mono"
              disabled={save.isPending}
            />
            <Button type="submit" variant="primary" disabled={!typed.trim() || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save key'}
            </Button>
            <Button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setTyped('')
                save.reset()
                setMode('idle')
              }}
            >
              Cancel
            </Button>
          </form>
        ) : mode === 'removing' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-ink">Requests to {name} then run on prepaid credits.</span>
            <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {remove.isPending ? 'Removing…' : `Remove ${name} key`}
            </Button>
            <Button disabled={remove.isPending} onClick={() => setMode('idle')}>
              Keep it
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {canAdd ? (
              <Button
                onClick={() => {
                  remove.reset()
                  setMode('editing')
                }}
              >
                {stored ? `Replace ${name} key` : `Add ${name} key`}
              </Button>
            ) : null}
            {stored ? (
              <Button
                onClick={() => {
                  save.reset()
                  setMode('removing')
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        )}
        {failed ? (
          <p role="alert" className="text-body text-ink">
            {failed}
          </p>
        ) : null}
      </div>
    </Row>
  )
}

/** Settings' card: the workspace's own provider keys, added, replaced and removed here. */
export function ProviderKeysCard() {
  const q = useQuery({
    queryKey: PROVIDER_KEYS_KEY,
    queryFn: providerKeysApi.list,
    retry: false,
  })
  const data = q.data?.enabled ? q.data.data : null
  const providers = data?.providers.length ? data.providers : Object.keys(BYOK_PROVIDERS)

  return (
    <Card raised>
      <CardHeader>Your provider keys</CardHeader>
      <div className="flex flex-col gap-3 border-b border-rule px-gutter py-4">
        <p className="text-body">
          On the BYOK plan, a request to a provider you hold a key for goes upstream on your key and Talyvor charges it
          no tokens — your provider bills you. A key is encrypted when it is stored and sent only to its own provider.
          It is never shown again: only its last four characters are.
        </p>
        {q.isPending ? (
          <p className="text-body text-muted">Reading your provider keys…</p>
        ) : q.isError ? (
          <p className="text-body text-muted">
            {isSessionExpired(q.error)
              ? 'Your provider keys can’t be read until you sign in again.'
              : 'Your provider keys couldn’t be read just now.'}
          </p>
        ) : !data ? (
          <p className="text-body text-ink">
            This deployment doesn’t hold provider keys, so BYOK isn’t available here.
          </p>
        ) : !data.byok ? (
          <p className="text-body text-ink" data-testid="provider-keys-plan">
            Your own keys come with BYOK, <span className="font-figure">{formatCents(BYOK.usd_cents)}</span> a month.{' '}
            <Link to="/plans" className={inlineLink}>
              See Plans
            </Link>
            .
          </p>
        ) : (
          <p className="text-body text-ink" data-testid="provider-keys-plan">
            You’re on BYOK. Add a key for each provider you want your requests sent on.
          </p>
        )}
      </div>
      {data
        ? providers.map((p) => (
            <ProviderKeyRow key={p} provider={p} stored={data.keys.find((k) => k.provider === p)} canAdd={data.byok} />
          ))
        : null}
    </Card>
  )
}
