import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, focusRing, type PillStatus } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { formatWhen } from './format'
import { CAPABILITIES_KEY, Note, readFailure } from './WalletMoney'
import { APPROVALS_KEY, BOOK_KEY, PASSKEYS_KEY } from './AgentBank'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { signApproval, signPayee } from './passkeys'
import {
  type AgentApproval,
  type AgentSchedule,
  type CurrencyAccount,
  type Mandate,
  type OutsidePayee,
  type OutsidePayment,
  type PayeeRequest,
  type PayoutBatch,
  agentBankApi,
  formatMinor,
  formatULXC,
  minorOf,
  newMoveKey,
  refusalText,
} from './agentBankApi'

// Pay.tsx — B30.96: money out of an account. Saved payees outside Talyvor, each checked against its account by the account
// partner (Lens B30.16); a payment to one, from the company's or an agent's account (B30.17), with an agent's requests that
// wait for a person's approval shown here; standing orders (B30.18); mandates a payee pulls within (B30.19); and bulk
// payouts from a CSV, validated row by row and paid on one approval (B30.21). Lens decides everything — which account may
// pay, the agent's rules, screening, what posts — and a refusal shows its sentence. Every amount is Lens's minor units.

export const PAYEES_KEY = ['money-payees']
export const PAYMENTS_KEY = ['money-payments']
export const MANDATES_KEY = ['money-mandates']
export const PAYOUTS_KEY = ['money-payouts']
export const SCHEDULES_KEY = ['agent-schedules']
/** What a payment out moves under: out of a currency account, through payments_out. */
const PAY_CAPABILITIES = ['currency_accounts', 'payments_out']
const EVERY: AgentSchedule['every'][] = ['hour', 'day', 'week', 'month']

const PAYMENT_STATUS: Record<string, { text: string; pill: PillStatus }> = {
  pending: { text: 'Pending', pill: 'held' },
  sent: { text: 'Sent', pill: 'held' },
  completed: { text: 'Completed', pill: 'settled' },
  failed: { text: 'Failed', pill: 'slashed' },
  returned: { text: 'Returned', pill: 'slashed' },
}
const CHECK: Record<string, { text: string; pill: PillStatus }> = {
  exact_match: { text: 'Exact match', pill: 'settled' },
  close_match: { text: 'Close match', pill: 'held' },
  no_match: { text: 'No match', pill: 'slashed' },
}

const select = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`
const field = 'flex flex-col gap-1 text-caption text-muted'

/** A date typed in the form, at nine in the morning UTC, as Lens wants a time. */
const morningOf = (date: string) => `${date}T09:00:00Z`
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const status = (s: string, of: Record<string, { text: string; pill: PillStatus }>) => of[s] ?? { text: s, pill: 'idle' as PillStatus }

/** The payee's account details, as it gave them. */
function detailsOf(p: OutsidePayee): string {
  if (p.iban) return `${p.iban}${p.bic ? ` · ${p.bic}` : ''}`
  if (p.routing_number) return `${p.routing_number} · ${p.account_number ?? ''}`
  return `${p.sort_code ?? ''} · ${p.account_number ?? ''}`
}

export function PayScreen() {
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const payments = useQuery({ queryKey: PAYMENTS_KEY, queryFn: agentBankApi.payments })
  const caps = useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const open = (accounts.data?.accounts ?? []).filter((a) => a.status === 'open')
  const agentAccounts = open.filter((a) => a.purpose === 'agent')
  const saved = payees.data?.payees ?? []
  const sent = payments.data?.payments ?? []
  const preview = !caps.isSuccess || (caps.data.capabilities ?? []).some((c) => PAY_CAPABILITIES.includes(c.capability) && !c.real_money)
  const agentName = (id: string | undefined) => book.data?.agents?.find((x) => x.id === id)?.name ?? id ?? ''
  const accountName = (a: CurrencyAccount) => `${a.purpose === 'agent' ? agentName(a.agent_id) : 'The company'} · ${a.currency}`
  const payeeName = (id: string | undefined) => saved.find((p) => p.id === id)?.name ?? id ?? ''
  const reading = (q: { isError: boolean; isPending: boolean; error: unknown }, what: string) =>
    q.isError ? <p className="text-body text-muted">{readFailure(q.error, what)}</p> : q.isPending ? <p className="text-body text-muted">Reading…</p> : null

  return (
    <RegionScreen>
      <Region index="00" label="Pay" heading="Send money from an account" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">
          Save the people and companies you pay, then send money from the company’s or an agent’s account in pounds, euros or dollars:
          one payment, a standing order, a mandate the payee pulls within, or a file of payouts approved once. An agent’s own request
          above its approval amount waits here for you.
        </p>
        {preview ? (
          <p className="flex flex-wrap items-center gap-2 text-caption text-ink" data-testid="pay-preview">
            <Pill status="held">Preview — test money only</Pill>
            <span>Payments leave with test money only for now.</span>
          </p>
        ) : null}
        {payments.isSuccess ? (
          <p className="text-body text-ink" data-testid="pay-count">
            <span className="font-figure">{sent.length}</span> {sent.length === 1 ? 'payment' : 'payments'} out,{' '}
            <span className="font-figure">{sent.filter((p) => p.status === 'completed').length}</span> completed
          </p>
        ) : null}
      </Region>
      <Region index="01" label="Payees" heading="People and companies you pay" className="flex max-w-2xl flex-col gap-3">
        {reading(payees, 'Your payees') ?? <Payees payees={saved} />}
      </Region>
      <Region index="02" label="Send" heading="Pay a saved payee" className="flex max-w-2xl flex-col gap-3">
        {reading(accounts, 'Your accounts') ??
          (open.length === 0 ? (
            <p className="text-body text-muted" data-testid="pay-no-account">No currency account yet: open the company’s account on Invoices, then pay from it here.</p>
          ) : (
            <SendPayment accounts={open} payees={saved} accountName={accountName} />
          ))}
        <Waiting agentName={agentName} />
        {reading(payments, 'Your payments') ??
          (sent.length > 0 ? (
            <Card>
              <CardHeader>Payments out</CardHeader>
              <ul>
                {sent.map((p) => (
                  <PaymentRow key={p.id} p={p} />
                ))}
              </ul>
            </Card>
          ) : null)}
      </Region>
      <Region index="03" label="Standing orders" heading="Pay the same amount on a schedule" className="flex max-w-2xl flex-col gap-3">
        {reading(accounts, 'Your accounts') ??
          (agentAccounts.length === 0 ? (
            <p className="text-body text-muted">A standing order runs from an agent’s account: open one on Invoices first.</p>
          ) : (
            <StandingOrders accounts={agentAccounts} payees={saved} accountName={accountName} payeeName={payeeName} agentName={agentName} />
          ))}
      </Region>
      <Region index="04" label="Mandates" heading="Let a payee pull within limits you set" className="flex max-w-2xl flex-col gap-3">
        {reading(accounts, 'Your accounts') ??
          (agentAccounts.length === 0 ? (
            <p className="text-body text-muted">A mandate is on an agent’s account: open one on Invoices first.</p>
          ) : (
            <Mandates accounts={agentAccounts} payees={saved} accountName={accountName} agentName={agentName} />
          ))}
      </Region>
      <Region index="05" label="Bulk payouts" heading="Pay many at once from a file" className="flex max-w-2xl flex-col gap-3">
        <Payouts />
      </Region>
    </RegionScreen>
  )
}

/** Saved payees outside Talyvor, each with what its bank said of the name; a close or no match confirmed with a passkey (B30.16). */
function Payees({ payees }: { payees: OutsidePayee[] }) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<'uk' | 'iban' | 'us'>('uk')
  const [form, setForm] = useState({ name: '', country: 'GB', sort_code: '', account_number: '', iban: '', bic: '', routing_number: '' })
  const [made, setMade] = useState<OutsidePayee | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: PAYEES_KEY })
  const create = useMutation({
    mutationFn: () => {
      const body: PayeeRequest = { name: form.name.trim(), country: form.country.trim().toUpperCase() }
      if (kind === 'iban') Object.assign(body, { iban: form.iban.replace(/\s/g, '').toUpperCase(), bic: form.bic.trim().toUpperCase() })
      else if (kind === 'us') Object.assign(body, { routing_number: form.routing_number.trim(), account_number: form.account_number.trim() })
      else Object.assign(body, { sort_code: form.sort_code.replace(/\D/g, ''), account_number: form.account_number.trim() })
      return agentBankApi.createPayee(body)
    },
    onSuccess: (p) => {
      setMade(p)
      setForm({ name: '', country: 'GB', sort_code: '', account_number: '', iban: '', bic: '', routing_number: '' })
      refresh()
    },
  })
  const confirm = useMutation({ mutationFn: async (id: string) => agentBankApi.confirmPayee(id, await signPayee(id)), onSuccess: refresh })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const complete = form.name.trim() !== '' && form.country.trim().length === 2 &&
    (kind === 'iban' ? form.iban.trim() !== '' : kind === 'us' ? form.routing_number.trim() !== '' && form.account_number.trim() !== '' : form.sort_code.trim() !== '' && form.account_number.trim() !== '')
  return (
    <Card>
      <CardHeader>Payees</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {payees.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Saved payees">
            {payees.map((p) => {
              const c = status(p.check, CHECK)
              return (
                <li key={p.id} className="flex flex-col gap-1 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`payee-${p.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
                    <span>
                      {p.name} · {p.country}
                    </span>
                    <span className="flex items-center gap-2">
                      <Pill status={c.pill}>{c.text}</Pill>
                      {p.needs_confirmation ? <Pill status="held">Needs confirmation</Pill> : null}
                    </span>
                  </div>
                  <p className="text-caption text-muted">
                    <span className="font-figure">{detailsOf(p)}</span>
                    {p.suggested_name ? ` · the account is held by ${p.suggested_name}` : ''}
                    {p.screening ? ` · ${p.screening}` : ''}
                  </p>
                  {p.needs_confirmation ? (
                    <div>
                      <Button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate(p.id)}>
                        {confirm.isPending && confirm.variables === p.id ? 'Confirming…' : 'Confirm with a passkey'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-body text-muted">No payee saved yet. Save one below: its name is checked against the account before it can be paid.</p>
        )}
        {confirm.isError ? <Note ok={false}>{refusalText(confirm.error)}</Note> : null}
        <form
          className="flex flex-col gap-3"
          data-testid="new-payee"
          onSubmit={(e) => {
            e.preventDefault()
            if (complete && !create.isPending) create.mutate()
          }}
        >
          <div className="grid gap-3 wide:grid-cols-3">
            <Input aria-label="Payee’s name" placeholder="Name on the account" className="wide:col-span-2" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            <Input aria-label="Country" placeholder="Country (GB)" className="font-figure" value={form.country} onChange={(e) => set({ country: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Account details" className={select} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="uk">Sort code and account number</option>
              <option value="iban">IBAN</option>
              <option value="us">Routing and account number</option>
            </select>
            {kind === 'iban' ? (
              <>
                <Input aria-label="IBAN" placeholder="IBAN" className="min-w-56 flex-1 font-figure" value={form.iban} onChange={(e) => set({ iban: e.target.value })} />
                <Input aria-label="BIC" placeholder="BIC (optional)" className="w-36 font-figure" value={form.bic} onChange={(e) => set({ bic: e.target.value })} />
              </>
            ) : (
              <>
                {kind === 'us' ? (
                  <Input aria-label="Routing number" placeholder="Routing number" className="w-36 font-figure" value={form.routing_number} onChange={(e) => set({ routing_number: e.target.value })} />
                ) : (
                  <Input aria-label="Sort code" placeholder="Sort code" className="w-28 font-figure" value={form.sort_code} onChange={(e) => set({ sort_code: e.target.value })} />
                )}
                <Input aria-label="Account number" placeholder="Account number" className="w-40 font-figure" value={form.account_number} onChange={(e) => set({ account_number: e.target.value })} />
              </>
            )}
          </div>
          <div>
            <Button type="submit" disabled={!complete || create.isPending}>
              {create.isPending ? 'Checking…' : 'Save payee'}
            </Button>
          </div>
          {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
          {made !== null ? (
            <Note ok>
              {made.name} saved: {status(made.check, CHECK).text.toLowerCase()}
              {made.suggested_name ? ` — the account is held by ${made.suggested_name}` : ''}
              {made.needs_confirmation ? '. Confirm it with a passkey before the first payment.' : '.'}
            </Note>
          ) : null}
        </form>
      </div>
    </Card>
  )
}

/** One payment to a saved payee, from the company's or an agent's account (B30.17). */
function SendPayment({ accounts, payees, accountName }: { accounts: CurrencyAccount[]; payees: OutsidePayee[]; accountName: (a: CurrencyAccount) => string }) {
  const qc = useQueryClient()
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [key, setKey] = useState(newMoveKey)
  const [made, setMade] = useState<OutsidePayment | null>(null)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const payee = payees.find((p) => p.id === payeeID)
  const minor = minorOf(amount)
  const complete = account !== undefined && payee !== undefined && !payee.needs_confirmation && minor !== null
  const pay = useMutation({
    mutationFn: () =>
      agentBankApi.payOutside({ account_id: account?.id ?? '', payee_id: payeeID, amount_minor: minor ?? 0, currency: account?.currency ?? '', reference: reference.trim(), idempotency_key: key }),
    onSuccess: (p) => {
      setMade(p)
      setAmount('')
      setReference('')
      setKey(newMoveKey())
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY })
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    },
  })
  return (
    <Card>
      <CardHeader>Send</CardHeader>
      <form
        className="flex flex-col gap-3 px-gutter py-3"
        data-testid="send-payment"
        onSubmit={(e) => {
          e.preventDefault()
          if (complete && !pay.isPending) pay.mutate()
        }}
      >
        <div className="grid gap-3 wide:grid-cols-2">
          <label className={field}>
            From
            <select aria-label="From" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountName(a)}
                </option>
              ))}
            </select>
            <span>
              Holds <span className="font-figure">{formatMinor(account?.test_minor ?? 0, account?.currency ?? 'GBP')}</span> of test money
            </span>
          </label>
          <label className={field}>
            To
            <select aria-label="To" className={`${select} w-full`} value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
              <option value="">Choose a payee</option>
              {payees.map((p) => (
                <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                  {p.name}
                  {p.needs_confirmation ? ' (confirm first)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            Amount in {account?.currency ?? 'GBP'}
            <Input aria-label={`Amount in ${account?.currency ?? 'GBP'}`} inputMode="decimal" placeholder="20.00" className="font-figure" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className={field}>
            Reference
            <Input aria-label="Reference" placeholder="What the payee sees" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>
        <div>
          <Button type="submit" variant="primary" disabled={!complete || pay.isPending}>
            {pay.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
        {pay.isError ? <Note ok={false}>{refusalText(pay.error)}</Note> : null}
        {made !== null ? (
          <Note ok>
            <span className="font-figure">{formatMinor(made.amount_minor, made.currency)}</span> to {made.payee_name}: {status(made.status, PAYMENT_STATUS).text.toLowerCase()}
            {made.detail ? ` — ${made.detail}` : ''}.
          </Note>
        ) : null}
      </form>
    </Card>
  )
}

/** An agent's own payments out that its rules sent to a person: approve or deny here, signed once the workspace has a passkey. */
function Waiting({ agentName }: { agentName: (id: string) => string }) {
  const qc = useQueryClient()
  const approvals = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const keys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: agentBankApi.passkeys })
  const signed = (keys.data?.passkeys ?? []).length > 0
  const waiting = (approvals.data?.approvals ?? []).filter((a) => a.status === 'pending' && a.payee?.kind === 'outside')
  const decide = useMutation({
    mutationFn: async ({ a, decision }: { a: AgentApproval; decision: 'approve' | 'deny' }) =>
      agentBankApi.decide(a.id, decision, signed ? await signApproval(a.id) : undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: APPROVALS_KEY }),
  })
  if (approvals.isError) return <p className="text-body text-muted">{readFailure(approvals.error, 'The agents’ requests')}</p>
  if (waiting.length === 0) return null
  return (
    <Card>
      <CardHeader>Waiting for your approval</CardHeader>
      <ul>
        {waiting.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 border-b border-rule px-gutter py-3 last:border-b-0" data-testid={`approval-${a.id}`}>
            <p className="text-body text-ink">
              {agentName(a.agent_id)} asked to pay {a.payee?.name} <span className="font-figure">{formatULXC(a.amount_ulxc)}</span>
              {a.memo ? ` — ${a.memo}` : ''}
            </p>
            <p className="text-caption text-muted">
              Asked <span className="font-figure">{formatWhen(a.created_at)}</span>. Approved, the agent’s next identical request goes through, once.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ a, decision: 'approve' })}>
                Approve
              </Button>
              <Button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ a, decision: 'deny' })}>
                Deny
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {decide.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{refusalText(decide.error)}</Note>
        </div>
      ) : null}
    </Card>
  )
}

function PaymentRow({ p }: { p: OutsidePayment }) {
  const s = status(p.status, PAYMENT_STATUS)
  return (
    <li className="flex flex-col gap-1 border-b border-rule px-gutter py-3 last:border-b-0" data-testid={`payment-${p.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-body text-ink">{p.payee_name}</span>
        <span className="flex items-center gap-2">
          <span className="text-body font-figure text-ink">{formatMinor(p.amount_minor, p.currency)}</span>
          <Pill status={s.pill}>{s.text}</Pill>
        </span>
      </div>
      <p className="text-caption text-muted">
        {p.reference ? `${p.reference} · ` : ''}
        <span className="font-figure">{formatWhen(p.created_at)}</span>
        {p.detail ? ` · ${p.detail}` : ''}
      </p>
    </li>
  )
}

/** A standing order: an agent's schedule to a saved payee, each tick a payment out judged by its rules when it runs (B30.18). */
function StandingOrders({
  accounts,
  payees,
  accountName,
  payeeName,
  agentName,
}: {
  accounts: CurrencyAccount[]
  payees: OutsidePayee[]
  accountName: (a: CurrencyAccount) => string
  payeeName: (id: string | undefined) => string
  agentName: (id: string) => string
}) {
  const qc = useQueryClient()
  const schedules = useQuery({ queryKey: SCHEDULES_KEY, queryFn: agentBankApi.schedules })
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState<AgentSchedule['every']>('week')
  const [first, setFirst] = useState(() => inDays(7))
  const [end, setEnd] = useState('')
  const [memo, setMemo] = useState('')
  const [made, setMade] = useState<AgentSchedule | null>(null)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const payee = payees.find((p) => p.id === payeeID)
  const minor = minorOf(amount)
  const complete = account !== undefined && payee !== undefined && !payee.needs_confirmation && minor !== null && first !== ''
  const refresh = () => void qc.invalidateQueries({ queryKey: SCHEDULES_KEY })
  const create = useMutation({
    mutationFn: () =>
      agentBankApi.schedule(account?.agent_id ?? '', {
        to_agent_id: '',
        to_listing_id: '',
        to_payee_id: payeeID,
        amount_ulxc: 0,
        amount_minor: minor ?? 0,
        currency: account?.currency ?? '',
        memo: memo.trim(),
        every,
        first_run_at: morningOf(first),
        ...(end !== '' ? { end_at: morningOf(end) } : {}),
      }),
    onSuccess: (s) => {
      setMade(s)
      setAmount('')
      setMemo('')
      refresh()
    },
  })
  const stop = useMutation({ mutationFn: (sid: string) => agentBankApi.stopSchedule(sid), onSuccess: refresh })
  const orders = (schedules.data?.schedules ?? []).filter((s) => s.to_payee_id)
  return (
    <Card>
      <CardHeader>Standing orders</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {schedules.isError ? (
          <p className="text-body text-muted">{readFailure(schedules.error, 'Your standing orders')}</p>
        ) : orders.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Standing orders">
            {orders.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`standing-order-${s.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
                  <span>
                    <span className="font-figure">{formatMinor(s.amount_minor ?? 0, s.currency ?? 'GBP')}</span> every {s.every} to {payeeName(s.to_payee_id)} from{' '}
                    {agentName(s.from_agent_id)}
                  </span>
                  <Pill status={s.active ? 'settled' : 'idle'}>{s.active ? 'Active' : 'Stopped'}</Pill>
                </div>
                <p className="text-caption text-muted">
                  Next <span className="font-figure">{formatWhen(s.next_run_at)}</span>
                  {s.end_at ? (
                    <>
                      {' '}
                      · until <span className="font-figure">{formatWhen(s.end_at)}</span>
                    </>
                  ) : null}
                  {s.memo ? ` · ${s.memo}` : ''}
                </p>
                {s.active ? (
                  <div>
                    <Button type="button" disabled={stop.isPending} onClick={() => stop.mutate(s.id)}>
                      Stop
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted">{schedules.isPending ? 'Reading…' : 'No standing order yet.'}</p>
        )}
        {stop.isError ? <Note ok={false}>{refusalText(stop.error)}</Note> : null}
          <form
            className="flex flex-col gap-3"
            data-testid="new-standing-order"
            onSubmit={(e) => {
              e.preventDefault()
              if (complete && !create.isPending) create.mutate()
            }}
          >
            <div className="grid gap-3 wide:grid-cols-2">
              <label className={field}>
                From
                <select aria-label="Standing order from" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountName(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                To
                <select aria-label="Standing order to" className={`${select} w-full`} value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
                  <option value="">Choose a payee</option>
                  {payees.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                      {p.name}
                      {p.needs_confirmation ? ' (confirm first)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Amount in {account?.currency ?? 'GBP'}
                <Input aria-label="Standing order amount" inputMode="decimal" placeholder="10.00" className="font-figure" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className={field}>
                Every
                <select aria-label="Every" className={`${select} w-full`} value={every} onChange={(e) => setEvery(e.target.value as AgentSchedule['every'])}>
                  {EVERY.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                First payment on
                <Input aria-label="First payment on" type="date" className="font-figure" value={first} onChange={(e) => setFirst(e.target.value)} />
              </label>
              <label className={field}>
                Until (optional)
                <Input aria-label="Until" type="date" className="font-figure" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <Input aria-label="Standing order memo" placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <div>
              <Button type="submit" disabled={!complete || create.isPending}>
                {create.isPending ? 'Setting up…' : 'Set up standing order'}
              </Button>
            </div>
            {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
            {made !== null ? (
              <Note ok>
                <span className="font-figure">{formatMinor(made.amount_minor ?? 0, made.currency ?? 'GBP')}</span> every {made.every}, first on{' '}
                <span className="font-figure">{formatWhen(made.next_run_at)}</span>.
              </Note>
            ) : null}
          </form>
      </div>
    </Card>
  )
}

/** A mandate from an agent's account: a Talyvor company or an outside business pulls within it (B30.19). */
function Mandates({
  accounts,
  payees,
  accountName,
  agentName,
}: {
  accounts: CurrencyAccount[]
  payees: OutsidePayee[]
  accountName: (a: CurrencyAccount) => string
  agentName: (id: string) => string
}) {
  const qc = useQueryClient()
  const mandates = useQuery({ queryKey: MANDATES_KEY, queryFn: agentBankApi.mandates })
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [kind, setKind] = useState<'company' | 'business'>('business')
  const [form, setForm] = useState({ workspace: '', business: '', payee: '', name: '', pull: '', month: '', expires: inDays(365) })
  const [made, setMade] = useState<Mandate | null>(null)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const pull = minorOf(form.pull)
  const month = minorOf(form.month)
  const complete = account !== undefined && pull !== null && month !== null && form.expires !== '' &&
    (kind === 'company' ? form.workspace.trim() !== '' : form.business.trim() !== '' && form.payee !== '')
  const refresh = () => void qc.invalidateQueries({ queryKey: MANDATES_KEY })
  const grant = useMutation({
    mutationFn: () =>
      agentBankApi.grantMandate({
        account_id: account?.id ?? '',
        payee_workspace_id: kind === 'company' ? form.workspace.trim() : '',
        payee_business_id: kind === 'business' ? form.business.trim() : '',
        payee_id: kind === 'business' ? form.payee : '',
        payee_name: form.name.trim(),
        max_per_pull_minor: pull ?? 0,
        max_per_month_minor: month ?? 0,
        expires_at: `${form.expires}T23:59:59Z`,
      }),
    onSuccess: (m) => {
      setMade(m)
      setForm({ workspace: '', business: '', payee: '', name: '', pull: '', month: '', expires: inDays(365) })
      refresh()
    },
  })
  const revoke = useMutation({ mutationFn: (id: string) => agentBankApi.revokeMandate(id), onSuccess: refresh })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const row = (m: Mandate, granted: boolean) => (
    <li key={m.id} className="flex flex-col gap-1 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`mandate-${m.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
        <span>
          {granted ? `${m.payee_name} pulls from ${agentName(m.agent_id)}` : `${m.payee_name} lets you pull`} · up to <span className="font-figure">{formatMinor(m.max_per_pull_minor, m.currency)}</span> a pull,{' '}
          <span className="font-figure">{formatMinor(m.max_per_month_minor, m.currency)}</span> a month
        </span>
        <Pill status={m.status === 'active' ? 'settled' : 'slashed'}>{m.status === 'active' ? 'Active' : 'Revoked'}</Pill>
      </div>
      <p className="text-caption text-muted">
        Pulled this month <span className="font-figure">{formatMinor(m.pulled_this_month_minor, m.currency)}</span> · expires{' '}
        <span className="font-figure">{formatWhen(m.expires_at)}</span>
      </p>
      {granted && m.status === 'active' ? (
        <div>
          <Button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(m.id)}>
            Revoke
          </Button>
        </div>
      ) : null}
    </li>
  )
  const granted = mandates.data?.granted ?? []
  const received = mandates.data?.received ?? []
  return (
    <Card>
      <CardHeader>Mandates</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {mandates.isError ? (
          <p className="text-body text-muted">{readFailure(mandates.error, 'Your mandates')}</p>
        ) : granted.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Mandates granted">
            {granted.map((m) => row(m, true))}
          </ul>
        ) : (
          <p className="text-body text-muted">{mandates.isPending ? 'Reading…' : 'No mandate granted yet.'}</p>
        )}
        {received.length > 0 ? (
          <>
            <p className="text-caption text-label">Received</p>
            <ul className="flex flex-col gap-2" aria-label="Mandates received">
              {received.map((m) => row(m, false))}
            </ul>
          </>
        ) : null}
        {revoke.isError ? <Note ok={false}>{refusalText(revoke.error)}</Note> : null}
          <form
            className="flex flex-col gap-3"
            data-testid="new-mandate"
            onSubmit={(e) => {
              e.preventDefault()
              if (complete && !grant.isPending) grant.mutate()
            }}
          >
            <div className="grid gap-3 wide:grid-cols-2">
              <label className={field}>
                On
                <select aria-label="Mandate on" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountName(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Payee
                <select aria-label="Mandate payee kind" className={`${select} w-full`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="business">An outside business, paid to a saved payee</option>
                  <option value="company">A Talyvor company, by its workspace id</option>
                </select>
              </label>
              {kind === 'company' ? (
                <Input aria-label="Payee’s workspace id" placeholder="Their workspace id" className="font-figure" value={form.workspace} onChange={(e) => set({ workspace: e.target.value })} />
              ) : (
                <>
                  <Input aria-label="Business id" placeholder="The business’s id, as it names itself" className="font-figure" value={form.business} onChange={(e) => set({ business: e.target.value })} />
                  <label className={field}>
                    Paid out to
                    <select aria-label="Paid out to" className={`${select} w-full`} value={form.payee} onChange={(e) => set({ payee: e.target.value })}>
                      <option value="">Choose a saved payee</option>
                      {payees.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <Input aria-label="Payee’s name" placeholder="Payee’s name (optional)" value={form.name} onChange={(e) => set({ name: e.target.value })} />
              <label className={field}>
                Most per pull, {account?.currency ?? 'GBP'}
                <Input aria-label="Most per pull" inputMode="decimal" placeholder="5.00" className="font-figure" value={form.pull} onChange={(e) => set({ pull: e.target.value })} />
              </label>
              <label className={field}>
                Most per month, {account?.currency ?? 'GBP'}
                <Input aria-label="Most per month" inputMode="decimal" placeholder="20.00" className="font-figure" value={form.month} onChange={(e) => set({ month: e.target.value })} />
              </label>
              <label className={field}>
                Expires on
                <Input aria-label="Expires on" type="date" className="font-figure" value={form.expires} onChange={(e) => set({ expires: e.target.value })} />
              </label>
            </div>
            <div>
              <Button type="submit" disabled={!complete || grant.isPending}>
                {grant.isPending ? 'Granting…' : 'Grant mandate'}
              </Button>
            </div>
            {grant.isError ? <Note ok={false}>{refusalText(grant.error)}</Note> : null}
            {made !== null ? (
              <Note ok>
                Granted to {made.payee_name}.
                {made.pull_key ? (
                  <>
                    {' '}
                    Give the business this key once; it is not shown again: <span className="font-figure" data-testid="mandate-pull-key">{made.pull_key}</span>
                  </>
                ) : null}
              </Note>
            ) : null}
          </form>
      </div>
    </Card>
  )
}

/** A file of payouts (payee_id, amount, currency, reference), validated row by row by Lens and paid on one approval (B30.21). */
function Payouts() {
  const qc = useQueryClient()
  const batches = useQuery({ queryKey: PAYOUTS_KEY, queryFn: agentBankApi.payouts })
  const [file, setFile] = useState<File | null>(null)
  const [key, setKey] = useState(newMoveKey)
  const [made, setMade] = useState<PayoutBatch | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
  const upload = useMutation({
    mutationFn: async () => agentBankApi.uploadPayouts(await (file as File).text(), key),
    onSuccess: (b) => {
      setMade(b)
      setFile(null)
      setKey(newMoveKey())
      refresh()
    },
  })
  const list = batches.data?.payouts ?? []
  return (
    <Card>
      <CardHeader>Bulk payouts</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <form
          className="flex flex-col gap-3"
          data-testid="payout-upload"
          onSubmit={(e) => {
            e.preventDefault()
            if (file !== null && !upload.isPending) upload.mutate()
          }}
        >
          <p className="text-caption text-muted">
            A CSV with a header row — <span className="font-figure">payee_id,amount,currency,reference</span> — and up to 1,000 rows, each a saved payee’s id, an amount such as{' '}
            <span className="font-figure">12.34</span>, GBP, EUR or USD and a reference. Every row is checked before anything moves; one approval pays the valid ones from the company’s
            account.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Payouts CSV" type="file" accept=".csv,text/csv" className="file:mr-3 file:border-0 file:bg-transparent file:text-caption file:text-ink" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button type="submit" disabled={file === null || upload.isPending}>
              {upload.isPending ? 'Checking rows…' : 'Upload and check'}
            </Button>
          </div>
          {upload.isError ? <Note ok={false}>{refusalText(upload.error)}</Note> : null}
        </form>
        {made !== null ? <Batch b={made} /> : null}
        {list.filter((b) => b.id !== made?.id).length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Payout batches">
            {list
              .filter((b) => b.id !== made?.id)
              .map((b) => (
                <li key={b.id}>
                  <Batch b={b} />
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </Card>
  )
}

/** One batch: its counts and totals, every row's result once read, and its one approval. */
function Batch({ b }: { b: PayoutBatch }) {
  const qc = useQueryClient()
  const [shown, setShown] = useState(b.rows !== undefined && b.rows !== null)
  const detail = useQuery({ queryKey: [...PAYOUTS_KEY, b.id], queryFn: () => agentBankApi.payout(b.id), enabled: shown, initialData: b.rows ? b : undefined })
  const approve = useMutation({
    mutationFn: () => agentBankApi.approvePayout(b.id),
    onSuccess: (next) => {
      qc.setQueryData([...PAYOUTS_KEY, b.id], next)
      setShown(true)
      void qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY })
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    },
  })
  const batch = detail.data ?? b
  const totals = Object.entries(batch.totals_minor ?? {})
  const rows = batch.rows ?? []
  return (
    <div className="flex flex-col gap-2 rounded-card border border-rule p-3" data-testid={`payout-${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
        <span>
          <span className="font-figure">{batch.rows_total}</span> rows: <span className="font-figure">{batch.rows_valid}</span> valid,{' '}
          <span className="font-figure">{batch.rows_invalid}</span> invalid
          {totals.length > 0 ? (
            <>
              {' '}
              · <span className="font-figure">{totals.map(([c, n]) => formatMinor(n, c)).join(', ')}</span> to pay
            </>
          ) : null}
        </span>
        <Pill status={batch.status === 'approved' ? 'settled' : batch.status === 'awaiting_approval' ? 'held' : 'idle'}>
          {batch.status === 'awaiting_approval' ? 'Awaiting approval' : batch.status === 'approved' ? 'Approved' : batch.status}
        </Pill>
      </div>
      <p className="text-caption text-muted">
        Uploaded <span className="font-figure">{formatWhen(batch.created_at)}</span>
        {batch.approved_at ? (
          <>
            {' '}
            · approved <span className="font-figure">{formatWhen(batch.approved_at)}</span>
          </>
        ) : null}
      </p>
      {shown ? (
        rows.length > 0 ? (
          <ul className="flex flex-col gap-1" aria-label="Rows">
            {rows.map((r) => (
              <li key={r.line} className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink" data-testid={`payout-row-${r.line}`}>
                <span className="min-w-0">
                  <span className="font-figure">{r.line}</span> · {r.payee_name || r.payee_id}
                  {r.reference ? ` · ${r.reference}` : ''}
                  {r.detail ? <span className="text-muted"> — {r.detail}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-figure">{formatMinor(r.amount_minor, r.currency)}</span>
                  <Pill status={r.status === 'invalid' || r.status === 'failed' || r.status === 'returned' ? 'slashed' : r.status === 'completed' ? 'settled' : r.status === 'valid' ? 'idle' : 'held'}>
                    {r.status}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted">{detail.isError ? readFailure(detail.error, 'Its rows') : 'Reading rows…'}</p>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {!shown ? (
          <Button type="button" onClick={() => setShown(true)}>
            Rows
          </Button>
        ) : null}
        {batch.status === 'awaiting_approval' && batch.rows_valid > 0 ? (
          <Button type="button" disabled={approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? 'Paying…' : `Approve and pay ${batch.rows_valid} ${batch.rows_valid === 1 ? 'row' : 'rows'}`}
          </Button>
        ) : null}
      </div>
      {approve.isError ? <Note ok={false}>{refusalText(approve.error)}</Note> : null}
    </div>
  )
}
