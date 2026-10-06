import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Pill, inlineLink } from '@talyvor/ui'

import { BOOK_KEY } from '../lens/AgentBank'
import { type Escrow, type MoneyRequest, agentBankApi, refusalText } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { Lxc } from '../lens/money'
import { ESCROWS_KEY } from '../lens/WalletHoldings'
import { REQUESTS_KEY, TestMoneyOnly } from '../lens/WalletMoney'
import { Card } from '../lens/walletBrand'
import { PENDING_POLL_MS } from '../lens/WalletScreens'
import { isSessionExpired } from '../../lib/productState'

// B28.355 — money waiting on a person, in the conversation. Another agent — of this workspace or any other company —
// asking one of the workspace's agents for credits is a card here, accepted (paid at once, from the asked agent) or
// declined; credits one of the workspace's agents holds in escrow are a card too, confirmed delivered here so the
// payee is paid. Lens decides each one, exactly as on Agent Wallets' Requests and Escrow cards, and its refusal is
// shown in its own words. A dispute needs a reason and stays on Agent Wallets.

interface Outcome {
  ok: boolean
  text: React.ReactNode
}

type Open = { kind: 'request'; r: MoneyRequest } | { kind: 'escrow'; e: Escrow }

const PREVIEW = 'Preview — test money only'

export function MoneyCards() {
  const qc = useQueryClient()
  const poll = { refetchInterval: (q: { state: { status: string } }) => (q.state.status === 'error' ? false : PENDING_POLL_MS), refetchOnWindowFocus: true }
  const requests = useQuery({ queryKey: REQUESTS_KEY, queryFn: agentBankApi.moneyRequests, ...poll })
  const escrows = useQuery({ queryKey: ESCROWS_KEY, queryFn: agentBankApi.escrows, ...poll })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const agents = book.data?.agents ?? []
  const mine = new Set(agents.map((a) => a.id))
  // Answered here this session: the card stays, saying what happened.
  const [done, setDone] = useState<Record<string, { item: Open; outcome: Outcome }>>({})

  const open: Open[] = [
    ...(requests.data?.requests ?? []).filter((r) => r.status === 'pending' && mine.has(r.to_agent_id)).map((r): Open => ({ kind: 'request', r })),
    ...(escrows.data?.escrows ?? []).filter((e) => e.status === 'held' && mine.has(e.payer_agent_id)).map((e): Open => ({ kind: 'escrow', e })),
  ]
  const idOf = (o: Open) => (o.kind === 'request' ? o.r.id : o.e.id)
  const createdOf = (o: Open) => (o.kind === 'request' ? o.r.created_at : o.e.created_at)
  // Oldest first, so the newest sits nearest the composer; one answered here stays where it was.
  const shown = [...open, ...Object.values(done).map((d) => d.item).filter((d) => !open.some((o) => idOf(o) === idOf(d)))].sort((x, y) =>
    createdOf(x).localeCompare(createdOf(y)),
  )

  // An agent of another company is named by its wallet, as Send names who it is sending to.
  const outside = [...new Set(shown.flatMap((o) => (o.kind === 'request' ? [o.r.from_agent_id] : [o.e.payee_agent_id])))].filter((id) => !mine.has(id))
  const addresses = useQueries({
    queries: outside.map((id) => ({ queryKey: ['wallet-address', id], queryFn: () => agentBankApi.address(id), staleTime: Infinity, retry: false })),
  })
  const nameOf = (id: string) =>
    agents.find((a) => a.id === id)?.name ?? addresses[outside.indexOf(id)]?.data?.name ?? id
  const statement = (id: string) => (
    <Link className={inlineLink} to={`/agents?${new URLSearchParams({ agent: id }).toString()}`}>
      See it on {nameOf(id)}’s statement
    </Link>
  )

  const settled = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: REQUESTS_KEY }),
      qc.invalidateQueries({ queryKey: ESCROWS_KEY }),
      qc.invalidateQueries({ queryKey: BOOK_KEY }),
      qc.invalidateQueries({ queryKey: ['agent-statement'] }),
    ])

  const answer = useMutation({
    mutationFn: async ({ r, accept }: { r: MoneyRequest; accept: boolean }): Promise<Outcome> => {
      const got = await agentBankApi.answerRequest(r.id, accept)
      const [payer, asker] = [nameOf(r.to_agent_id), nameOf(r.from_agent_id)]
      if (got.status === 'declined') return { ok: true, text: <>Declined. Nothing was paid to {asker}.</> }
      return {
        ok: true,
        text: (
          <>
            Accepted. {payer} paid {asker} <Lxc ulxc={got.amount_ulxc} />. {statement(r.to_agent_id)}
          </>
        ),
      }
    },
    onSuccess: (outcome, { r }) => setDone((d) => ({ ...d, [r.id]: { item: { kind: 'request', r }, outcome } })),
    onError: (err, { r }) => setDone((d) => ({ ...d, [r.id]: { item: { kind: 'request', r }, outcome: { ok: false, text: <>Not paid. {refusalText(err)}</> } } })),
    onSettled: settled,
  })

  const confirm = useMutation({
    mutationFn: async (e: Escrow): Promise<Outcome> => {
      const got = await agentBankApi.confirmEscrow(e.id)
      return {
        ok: true,
        text: (
          <>
            Confirmed delivered. {nameOf(got.payee_agent_id)} is paid <Lxc ulxc={got.amount_ulxc} /> from escrow. {statement(e.payer_agent_id)}
          </>
        ),
      }
    },
    onSuccess: (outcome, e) => setDone((d) => ({ ...d, [e.id]: { item: { kind: 'escrow', e }, outcome } })),
    onError: (err, e) => setDone((d) => ({ ...d, [e.id]: { item: { kind: 'escrow', e }, outcome: { ok: false, text: <>Still held. {refusalText(err)}</> } } })),
    onSettled: settled,
  })

  if (requests.isError || escrows.isError) {
    // A refused read is not "nobody is asking": say so, and where the requests and escrows are.
    return (
      <p className="pb-6 text-caption text-muted">
        {isSessionExpired(requests.error ?? escrows.error)
          ? 'What other agents ask of yours can’t be read until you sign in again.'
          : 'What other agents ask of yours could not be read just now.'}{' '}
        <Link className={inlineLink} to="/agents">
          Open Agent Wallets
        </Link>
      </p>
    )
  }
  if (shown.length === 0) return null

  const crossesOwners = shown.some((o) => o.kind === 'request' && o.r.from_workspace_id !== o.r.to_workspace_id)
  const busy = answer.isPending || confirm.isPending
  // One-handed on a phone: full-width buttons under the sentence; side by side on a wide screen.
  const buttons = 'flex w-full flex-col gap-2 wide:flex-row wide:items-center'
  const button = 'h-12 w-full wide:h-8 wide:w-auto'

  return (
    <section aria-label="Money waiting for you" className="flex flex-col gap-3 pb-6">
      {crossesOwners ? <TestMoneyOnly capability="pay_another_owner" label={PREVIEW} /> : null}
      {shown.some((o) => o.kind === 'escrow') ? <TestMoneyOnly capability="escrow" label={PREVIEW} /> : null}
      {shown.map((o) => {
        const id = idOf(o)
        const waiting = open.some((x) => idOf(x) === id)
        const outcome = done[id]?.outcome
        const said = outcome ? (
          <p role={outcome.ok ? 'status' : 'alert'} className="text-caption text-ink">
            {outcome.text}
          </p>
        ) : null
        if (o.kind === 'request') {
          const { r } = o
          return (
            <Card key={id} data-testid="chat-money-request" data-request={r.id}>
              <div className="flex flex-col gap-2 px-4 py-3">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                  {waiting ? <Pill status="held">Asks you</Pill> : null}
                  <span>
                    Asked <span className="font-figure">{formatWhen(r.created_at)}</span>
                  </span>
                </p>
                <p className="text-body text-ink" data-testid="chat-money-asks">
                  {nameOf(r.from_agent_id)} asks {nameOf(r.to_agent_id)} for <Lxc ulxc={r.amount_ulxc} />
                  {r.memo ? ` — ${r.memo}` : ''}
                </p>
                {waiting ? (
                  <>
                    <p className="text-caption text-muted">Accept pays it from {nameOf(r.to_agent_id)}’s wallet at once.</p>
                    <div className={buttons}>
                      <Button className={button} disabled={busy} onClick={() => answer.mutate({ r, accept: true })}>
                        Accept
                      </Button>
                      <Button className={button} disabled={busy} onClick={() => answer.mutate({ r, accept: false })}>
                        Decline
                      </Button>
                    </div>
                  </>
                ) : null}
                {said}
              </div>
            </Card>
          )
        }
        const { e } = o
        return (
          <Card key={id} data-testid="chat-escrow" data-escrow={e.id}>
            <div className="flex flex-col gap-2 px-4 py-3">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                {waiting ? <Pill status="held">Held in escrow</Pill> : null}
                <span>
                  Paid in <span className="font-figure">{formatWhen(e.created_at)}</span>
                </span>
              </p>
              <p className="text-body text-ink" data-testid="chat-escrow-holds">
                {nameOf(e.payer_agent_id)} holds <Lxc ulxc={e.amount_ulxc} /> for {nameOf(e.payee_agent_id)}
                {e.memo ? ` — ${e.memo}` : ''}
              </p>
              {waiting ? (
                <>
                  <p className="text-caption text-muted">
                    Released to {nameOf(e.payee_agent_id)} <span className="font-figure">{formatWhen(e.release_at)}</span> unless
                    disputed. Confirm it was delivered to pay it now, or{' '}
                    <Link className={inlineLink} to="/agents">
                      dispute it on Agent Wallets
                    </Link>
                    .
                  </p>
                  <div className={buttons}>
                    <Button className={button} disabled={busy} onClick={() => confirm.mutate(e)}>
                      Confirm delivered
                    </Button>
                  </div>
                </>
              ) : null}
              {said}
            </div>
          </Card>
        )
      })}
    </section>
  )
}
