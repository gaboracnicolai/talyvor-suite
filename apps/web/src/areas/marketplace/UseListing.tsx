import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, Pill, focusRing } from '@talyvor/ui'
import { formatULXC } from '../lens/agentBankApi'
import { type Listing, type ListingUse, marketApi, refusalText, variablesIn, variablesNamedIn } from './marketApi'
import { Note, selectClass, useRunnableModels } from './parts'

// UseListing.tsx — B20.3: using a listing. Lens runs it as this workspace (B20.2): the models it calls
// are billed as usual, and a paid listing's price goes on the workspace's monthly marketplace bill —
// never on its credits. The seller's own use, and a use by a workspace linked to the seller, cost
// nothing. The listing page mounts this per listing (keyed by its id), so nothing typed for one
// listing survives into the next.

const CHARGED: Record<ListingUse['charge'], (u: ListingUse) => React.ReactNode> = {
  billed: (u) => (
    <>
      <span className="font-figure">{formatULXC(u.price_ulxc)}</span> is on your marketplace bill for this month.
    </>
  ),
  free: () => 'This listing is free.',
  own: () => 'Your own listing: nothing was charged.',
  linked: () => 'Your workspace and the seller’s are linked, so nothing was charged and the seller earns nothing.',
}

function UseResult({ u }: { u: ListingUse }) {
  const cases = u.cases ?? []
  return (
    <Card>
      <CardHeader>What it answered</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3" data-testid="market-use-result">
        {u.kind === 'evaluation' ? (
          <>
            <p className="text-body text-ink">
              <span className="font-figure">{cases.filter((c) => c.passed).length}</span> of{' '}
              <span className="font-figure">{cases.length}</span> cases passed on {u.model}.
            </p>
            {cases.map((c, i) => (
              <div key={i} className="flex flex-col gap-1 border-t border-rule pt-2">
                <div className="flex items-center gap-2">
                  <Pill status={c.passed ? 'settled' : 'slashed'}>{c.passed ? 'Passed' : 'Failed'}</Pill>
                  <span className="text-body text-ink">{c.input}</span>
                </div>
                <p className="text-caption text-muted">Expected: {c.expected}</p>
                <p className="whitespace-pre-wrap text-body text-ink">{c.output}</p>
              </div>
            ))}
          </>
        ) : (
          <p className="whitespace-pre-wrap text-body text-ink">{u.output}</p>
        )}
        <p className="text-caption text-muted">
          {u.model} · {CHARGED[u.charge](u)}
        </p>
      </div>
    </Card>
  )
}

export function UseListing({ listing, own }: { listing: Listing; own: boolean }) {
  const { models, runnable } = useRunnableModels()
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  // B20.8: Lens says what a use of the latest version needs — its input, a prompt's variables, the model
  // it runs on — to everyone who may use it. A Lens that does not say leaves the owner reading the
  // template and anyone else learning the variables from Lens's refusal of a use without them, which
  // runs nothing and charges nothing.
  const latest = listing.versions?.find((v) => v.version === listing.latest_version)
  const needs = latest?.needs
  const template = latest?.artifact?.template
  const [vars, setVars] = useState<string[]>(() =>
    needs ? (needs.variables ?? []) : typeof template === 'string' ? variablesIn(template) : [],
  )
  const [values, setValues] = useState<Record<string, string>>({})
  const use = useMutation({
    mutationFn: () => marketApi.use(listing.id, { model, input, variables: values }),
    onError: (err) => {
      const named = variablesNamedIn(err)
      if (named.length > 0) setVars((v) => [...new Set([...v, ...named])])
    },
  })
  if (listing.kind === 'pipeline') {
    return <p className="text-body text-muted">Pipelines can be published and found here, but not used yet.</p>
  }
  const needsInput = needs ? needs.input : listing.kind === 'agent' || listing.kind === 'skill'
  // With no model of its own, the person must name one: Lens refuses a use that runs on nothing.
  const needsModel = needs !== undefined && needs.model === '' && model === ''
  const paid = listing.price_per_use_ulxc > 0 && !own
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted">
        {own ? (
          'This is your own listing: using it charges nothing. The models it calls are billed as usual.'
        ) : paid ? (
          <>
            Each use costs <span className="font-figure">{formatULXC(listing.price_per_use_ulxc)}</span>, billed monthly
            on your card — not taken from your credits. The models it calls are billed to you as usual.
          </>
        ) : (
          'Free to use. The models it calls are billed to you as usual.'
        )}
      </p>
      <form
        className="flex max-w-2xl flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!use.isPending) use.mutate()
        }}
      >
        {needsInput ? (
          <label className="flex flex-col gap-1 text-caption text-muted">
            Your message
            <textarea
              className={`min-h-28 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
        ) : null}
        {listing.kind === 'evaluation' && needs?.cases ? (
          <p className="text-caption text-muted">
            Runs its <span className="font-figure">{needs.cases}</span> cases on the model below and shows which pass.
          </p>
        ) : null}
        {listing.kind === 'prompt' && !needs && !(vars.length > 0) ? (
          <p className="text-caption text-muted">
            If this prompt needs values filled in, Lens names them the first time you use it — nothing runs or is
            charged until they are there.
          </p>
        ) : null}
        {vars.map((name) => (
          <label key={name} className="flex flex-col gap-1 text-caption text-muted">
            {name}
            <Input value={values[name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} />
          </label>
        ))}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-caption text-muted">
            Model
            <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">
                {needs?.model ? `Its own: ${needs.model}` : needs ? 'Choose a model' : 'The listing’s own model'}
              </option>
              {runnable.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="primary" disabled={use.isPending || needsModel || (needsInput && input.trim() === '')}>
            {use.isPending ? (
              'Running…'
            ) : listing.kind === 'evaluation' ? (
              'Run the evaluation'
            ) : paid ? (
              <>
                Use it · <span className="font-figure">{formatULXC(listing.price_per_use_ulxc)}</span>
              </>
            ) : (
              'Use it'
            )}
          </Button>
        </div>
        {models.isError ? <p className="text-caption text-muted">The model list could not be read.</p> : null}
        {use.isError ? <Note ok={false}>{refusalText(use.error)}</Note> : null}
      </form>
      {use.isSuccess ? <UseResult u={use.data} /> : null}
    </div>
  )
}
