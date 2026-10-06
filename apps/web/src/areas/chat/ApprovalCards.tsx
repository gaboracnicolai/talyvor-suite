import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button, Pill, inlineLink } from '@talyvor/ui'

import { APPROVALS_KEY, BOOK_KEY, PASSKEYS_KEY, deviceText } from '../lens/AgentBank'
import { type AgentApproval, AgentBankError, agentBankApi, refusalText } from '../lens/agentBankApi'
import { formatWhen } from '../lens/format'
import { Lxc } from '../lens/money'
import { passkeysSupported, registerThisDevice, signApproval } from '../lens/passkeys'
import { Card } from '../lens/walletBrand'
import { PENDING_POLL_MS } from '../lens/WalletScreens'
import { isSessionExpired } from '../../lib/productState'
import { statementLineHref } from './chatApi'

// B28.84 — what an agent is waiting on, where the person already is. Each approval Lens has pending is a card in the
// conversation, approved with Face ID: the passkey this workspace registered signs Lens's challenge for that one
// approval (B19.10), exactly as on Approvals. A payment to another agent of this workspace is then sent once against
// the approval, so approving the card settles it as one posting on the payer's statement, linked from the card.
// Anything else approved here — a request to a model, a payment to a listing or a company — goes through the next
// time the agent sends it, once.

interface Outcome {
  ok: boolean
  text: React.ReactNode
}

export function ApprovalCards() {
  const qc = useQueryClient()
  // The sidebar's badge polls the same list (B28.45), so a card appears here without a reload.
  const list = useQuery({
    queryKey: APPROVALS_KEY,
    queryFn: agentBankApi.approvals,
    refetchInterval: (q) => (q.state.status === 'error' ? false : PENDING_POLL_MS),
    refetchOnWindowFocus: true,
  })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const keys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: agentBankApi.passkeys })
  const signed = (keys.data?.passkeys ?? []).length > 0
  const agents = book.data?.agents ?? []
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? 'an agent'
  // Decided here this session: the card stays, saying what happened.
  const [done, setDone] = useState<Record<string, { a: AgentApproval; outcome: Outcome }>>({})
  const [device, setDevice] = useState<Outcome | null>(null)

  const register = useMutation({
    mutationFn: () => registerThisDevice(navigator.userAgent.includes('iPhone') ? 'iPhone' : 'This device'),
    onSuccess: () => setDevice({ ok: true, text: 'This device now signs approvals. Face ID asks each time you approve or deny.' }),
    onError: (err) => setDevice({ ok: false, text: deviceText(err, 'No passkey was made.') }),
    onSettled: () => qc.invalidateQueries({ queryKey: PASSKEYS_KEY }),
  })

  const decide = useMutation({
    mutationFn: async ({ a, decision }: { a: AgentApproval; decision: 'approve' | 'deny' }): Promise<Outcome> => {
      await agentBankApi.decide(a.id, decision, signed ? await signApproval(a.id) : undefined)
      const who = nameOf(a.agent_id)
      if (decision === 'deny') return { ok: true, text: <>Denied. {who}’s {a.payee ? 'payment' : 'request'} will be refused.</> }
      const payee = a.payee
      if (payee?.kind !== 'agent' || !agents.some((x) => x.id === payee.id)) {
        return { ok: true, text: <>Approved. {who}’s next identical request goes through, once.</> }
      }
      // The payment itself, sent once: Lens lets it through against this approval and posts it.
      try {
        const paid = await agentBankApi.pay(a.agent_id, payee.id, a.amount_ulxc, a.memo ?? '')
        return {
          ok: true,
          text: (
            <>
              Approved and paid <Lxc ulxc={paid.amount_ulxc} /> from {who} to {nameOf(paid.to_agent_id)}.{' '}
              <Link className={inlineLink} to={statementLineHref({ agent_id: paid.from_agent_id, entry_id: paid.entry_id })}>
                See it on {who}’s statement
              </Link>
            </>
          ),
        }
      } catch (err) {
        if (!(err instanceof AgentBankError)) throw err
        return { ok: false, text: <>Approved, but the payment was refused: {refusalText(err)} It goes through when {who} sends it again.</> }
      }
    },
    onSuccess: (outcome, { a }) => setDone((d) => ({ ...d, [a.id]: { a, outcome } })),
    onError: (err, { a }) => setDone((d) => ({ ...d, [a.id]: { a, outcome: { ok: false, text: deviceText(err, 'Nothing changed. You can try again.') } } })),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: APPROVALS_KEY }),
        qc.invalidateQueries({ queryKey: BOOK_KEY }),
        qc.invalidateQueries({ queryKey: ['agent-statement'] }),
      ]),
  })

  const pending = (list.data?.approvals ?? []).filter((a) => a.status === 'pending')
  // Oldest first, so the newest sits nearest the composer; one decided here stays where it was.
  const shown = [...pending, ...Object.values(done).map((d) => d.a).filter((a) => !pending.some((p) => p.id === a.id))]
    .sort((x, y) => x.created_at.localeCompare(y.created_at))
  if (list.isError) {
    // A refused read is not "nothing is waiting": say so, and where the approvals are.
    return (
      <p className="pb-6 text-caption text-muted">
        {isSessionExpired(list.error)
          ? 'What your agents are waiting on can’t be read until you sign in again.'
          : 'What your agents are waiting on could not be read just now.'}{' '}
        <Link className={inlineLink} to="/approvals">
          Open Approvals
        </Link>
      </p>
    )
  }
  if (shown.length === 0) return null

  return (
    <section aria-label="Waiting for your approval" className="flex flex-col gap-3 pb-6">
      {shown.map((a) => {
        const open = pending.some((p) => p.id === a.id)
        const outcome = done[a.id]?.outcome
        return (
          <Card key={a.id} data-testid="chat-approval">
            <div className="flex flex-col gap-2 px-4 py-3">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                {open ? <Pill status="held">Waiting for you</Pill> : null}
                <span>
                  Asked <span className="font-figure">{formatWhen(a.created_at)}</span>
                </span>
              </p>
              <p className="text-body text-ink" data-testid="chat-approval-asks">
                {a.payee ? (
                  <>
                    {nameOf(a.agent_id)} wants to pay {a.payee.name || a.payee.id} <Lxc ulxc={a.amount_ulxc} />
                    {a.memo ? ` — ${a.memo}` : ''}
                  </>
                ) : (
                  <>
                    {nameOf(a.agent_id)} wants to spend <Lxc ulxc={a.amount_ulxc} /> on{' '}
                    {a.reason || (a.model ? `a request to ${a.model}` : 'a payment')}
                  </>
                )}
              </p>
              {a.payee && a.reason ? <p className="text-caption text-muted">{a.reason}</p> : null}
              {open ? (
                // One-handed on a phone: two full-width buttons under the sentence; side by side on a wide screen.
                <div className="flex w-full flex-col gap-2 wide:flex-row wide:items-center">
                  <Button
                    className="h-12 w-full wide:h-8 wide:w-auto"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ a, decision: 'approve' })}
                  >
                    {signed ? 'Approve with Face ID' : 'Approve'}
                  </Button>
                  <Button
                    className="h-12 w-full wide:h-8 wide:w-auto"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ a, decision: 'deny' })}
                  >
                    Deny
                  </Button>
                </div>
              ) : null}
              {open && !signed && keys.isSuccess && passkeysSupported() ? (
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                  <span>Approvals are not signed yet.</span>
                  <button type="button" className={inlineLink} disabled={register.isPending} onClick={() => register.mutate()}>
                    Approve with Face ID from now on
                  </button>
                </p>
              ) : null}
              {outcome ? (
                <p role={outcome.ok ? 'status' : 'alert'} className="text-caption text-ink">
                  {outcome.text}
                </p>
              ) : null}
            </div>
          </Card>
        )
      })}
      {device ? (
        <p role={device.ok ? 'status' : 'alert'} className="text-caption text-ink">
          {device.text}
        </p>
      ) : null}
    </section>
  )
}
