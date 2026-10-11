import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, focusRing, inlineLink, type PillStatus } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { formatWhen } from './format'
import { CAPABILITIES_KEY, Note, readFailure } from './WalletMoney'
import { BOOK_KEY } from './AgentBank'
import { type CurrencyAccount, type Invoice, type InvoiceRequest, agentBankApi, formatMinor, refusalText } from './agentBankApi'

// Invoices.tsx — B30.97: invoices and their pay links (Lens B30.20). An agent's currency account issues an invoice —
// lines with optional VAT, a due date, a reminder — and sends a public pay link that takes a card, a transfer quoting the
// reference, or another Talyvor agent's payment; a paid invoice posts into the agent's account and reads paid here.
// Lens decides everything: which account may issue, what is due and which states may move. A refusal shows its sentence.

export const INVOICES_KEY = ['money-invoices']
export const MONEY_ACCOUNTS_KEY = ['money-accounts']
/** What an invoice's money moves under: a card or transfer comes in through payments_in, into a currency account. */
const INVOICE_CAPABILITIES = ['currency_accounts', 'payments_in']
const CURRENCIES = ['GBP', 'EUR', 'USD']

const STATUS: Record<Invoice['status'], { text: string; pill: PillStatus }> = {
  draft: { text: 'Draft', pill: 'idle' },
  sent: { text: 'Sent', pill: 'held' },
  overdue: { text: 'Overdue', pill: 'held' },
  paid: { text: 'Paid', pill: 'settled' },
  void: { text: 'Void', pill: 'slashed' },
}

const select = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`

/** "12.50" → 1250: a price typed in the currency's major units, to the minor unit; null when it is not a positive amount. */
function minorOf(text: string): number | null {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(text)
  if (m === null) return null
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

/** Thirty days from today, as the date field wants it. */
function inThirtyDays(): string {
  const d = new Date(Date.now() + 30 * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function InvoicesScreen() {
  const invoices = useQuery({ queryKey: INVOICES_KEY, queryFn: agentBankApi.invoices })
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const caps = useQuery({ queryKey: CAPABILITIES_KEY, queryFn: agentBankApi.capabilities })
  const list = invoices.data?.invoices ?? []
  const agentAccounts = (accounts.data?.accounts ?? []).filter((a) => a.purpose === 'agent' && a.status === 'open')
  const preview =
    !caps.isSuccess || (caps.data.capabilities ?? []).some((c) => INVOICE_CAPABILITIES.includes(c.capability) && !c.real_money)
  return (
    <RegionScreen>
      <Region
        index="00"
        label="Invoices"
        heading="Invoice your customers from an agent’s account"
        sectionClassName="pb-10 pt-4 wide:pb-12"
        className="flex max-w-2xl flex-col gap-3"
      >
        <p className="text-body text-muted">
          An agent issues an invoice in pounds, euros or dollars and sends a pay link. Whoever holds the link pays by card, by a
          transfer quoting the reference, or from one of their own Talyvor agents, and the money lands in the agent’s account.
        </p>
        {preview ? (
          <p className="flex flex-wrap items-center gap-2 text-caption text-ink" data-testid="invoices-preview">
            <Pill status="held">Preview — test money only</Pill>
            <span>Invoices are paid with test money only for now.</span>
          </p>
        ) : null}
        {invoices.isSuccess ? (
          <p className="text-body text-ink" data-testid="invoices-count">
            <span className="font-figure">{list.length}</span> {list.length === 1 ? 'invoice' : 'invoices'},{' '}
            <span className="font-figure">{list.filter((i) => i.status === 'paid').length}</span> paid
          </p>
        ) : null}
      </Region>
      <Region index="01" label="New invoice" heading="Issue one" className="flex max-w-2xl flex-col gap-3">
        {accounts.isError ? (
          <p className="text-body text-muted">{readFailure(accounts.error, 'Your accounts')}</p>
        ) : accounts.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : (
          <>
            <OpenAccount accounts={accounts.data.accounts ?? []} />
            {agentAccounts.length === 0 ? (
              <p className="text-body text-muted" data-testid="invoices-no-account">
                {(accounts.data.accounts ?? []).length === 0 ? 'No currency account yet. ' : ''}
                An invoice is paid into one of your agents’ accounts: open the company’s account in a currency, then the agent’s, above.
              </p>
            ) : (
              <NewInvoice accounts={agentAccounts} />
            )}
          </>
        )}
      </Region>
      <Region index="02" label="Issued" heading="Every invoice, newest first" className="flex max-w-2xl flex-col gap-3">
        {invoices.isError ? (
          <p className="text-body text-muted">{readFailure(invoices.error, 'Your invoices')}</p>
        ) : invoices.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : list.length === 0 ? (
          <p className="text-body text-muted">No invoice issued yet: create one above, and it appears here when it is issued.</p>
        ) : (
          <Card>
            <CardHeader>Invoices</CardHeader>
            <ul>
              {list.map((inv) => (
                <InvoiceRow key={inv.id} inv={inv} />
              ))}
            </ul>
          </Card>
        )}
      </Region>
    </RegionScreen>
  )
}

/** Open the company's or an agent's account in a currency (Lens B30.13): an agent's is a sub-account of the company's. */
function OpenAccount({ accounts }: { accounts: CurrencyAccount[] }) {
  const qc = useQueryClient()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const [holder, setHolder] = useState('')
  const [currency, setCurrency] = useState('GBP')
  const open = useMutation({
    mutationFn: () => agentBankApi.openMoneyAccount(currency, holder),
    onSuccess: () => void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY }),
  })
  const agents = (book.data?.agents ?? []).filter((a) => !a.archived_at)
  return (
    <Card>
      <CardHeader>Accounts</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {accounts.length > 0 ? (
          <ul className="flex flex-col gap-1" aria-label="Currency accounts">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink">
                <span>
                  {a.purpose === 'agent' ? (agents.find((x) => x.id === a.agent_id)?.name ?? a.name) : 'The company'} · {a.currency}
                </span>
                <span className="font-figure">{formatMinor(a.test_minor, a.currency)} test</span>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!open.isPending) open.mutate()
          }}
        >
          <select aria-label="Whose account" className={`${select} w-48`} value={holder} onChange={(e) => setHolder(e.target.value)}>
            <option value="">The company</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select aria-label="Currency" className={`${select} w-24`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={open.isPending}>
            {open.isPending ? 'Opening…' : 'Open account'}
          </Button>
        </form>
        {open.isError ? <Note ok={false}>{refusalText(open.error)}</Note> : null}
      </div>
    </Card>
  )
}

interface DraftLine {
  description: string
  quantity: string
  unit: string
  vat: string
}

const blankLine = (): DraftLine => ({ description: '', quantity: '1', unit: '', vat: '0' })

function NewInvoice({ accounts }: { accounts: CurrencyAccount[] }) {
  const qc = useQueryClient()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [customer, setCustomer] = useState({ name: '', email: '', address: '', vat: '' })
  const [sellerVAT, setSellerVAT] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([blankLine()])
  const [dueDate, setDueDate] = useState(inThirtyDays)
  const [remind, setRemind] = useState('0')
  const [memo, setMemo] = useState('')
  const [made, setMade] = useState<Invoice | null>(null)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const currency = account?.currency ?? 'GBP'

  const parsed = lines.map((l) => ({
    description: l.description.trim(),
    quantity: /^\d+$/.test(l.quantity.trim()) ? Number(l.quantity) : 0,
    unit_amount_minor: minorOf(l.unit),
    vat_rate_bps: /^\d+(\.\d+)?$/.test(l.vat.trim()) ? Math.round(Number(l.vat) * 100) : -1,
  }))
  const complete = customer.name.trim() !== '' && account !== undefined && dueDate !== '' &&
    parsed.every((l) => l.description !== '' && l.quantity > 0 && l.unit_amount_minor !== null && l.vat_rate_bps >= 0 && l.vat_rate_bps <= 10000)
  const total = parsed.reduce((sum, l) => {
    const net = l.quantity * (l.unit_amount_minor ?? 0)
    return sum + net + Math.round((net * Math.max(l.vat_rate_bps, 0)) / 10000)
  }, 0)

  const create = useMutation({
    mutationFn: (send: boolean) => {
      const body: InvoiceRequest = {
        account_id: account?.id ?? '',
        customer_name: customer.name.trim(),
        customer_email: customer.email.trim(),
        customer_address: customer.address.trim(),
        customer_vat_number: customer.vat.trim(),
        seller_vat_number: sellerVAT.trim(),
        lines: parsed.map((l) => ({ ...l, unit_amount_minor: l.unit_amount_minor ?? 0 })),
        due_date: dueDate,
        remind_days_before: /^\d+$/.test(remind.trim()) ? Number(remind) : 0,
        memo: memo.trim(),
        send,
      }
      return agentBankApi.createInvoice(body)
    },
    onSuccess: (inv) => {
      setMade(inv)
      setCustomer({ name: '', email: '', address: '', vat: '' })
      setLines([blankLine()])
      setMemo('')
      void qc.invalidateQueries({ queryKey: INVOICES_KEY })
    },
  })
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((old) => old.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const agentName = (a: CurrencyAccount) => book.data?.agents?.find((x) => x.id === a.agent_id)?.name ?? a.name

  return (
    <Card>
      <CardHeader>New invoice</CardHeader>
      <form
        className="flex flex-col gap-3 px-gutter py-3"
        data-testid="new-invoice"
        onSubmit={(e) => {
          e.preventDefault()
          if (complete && !create.isPending) create.mutate(true)
        }}
      >
        <label className="flex flex-col gap-1 text-caption text-muted">
          Paid into
          <select aria-label="Paid into" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {agentName(a)} · {a.currency}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 wide:grid-cols-2">
          <Input aria-label="Customer" placeholder="Customer’s name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
          <Input aria-label="Customer’s email" type="email" placeholder="Their email, for reminders" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
          <Input aria-label="Customer’s VAT number" placeholder="Their VAT number (optional)" value={customer.vat} onChange={(e) => setCustomer({ ...customer, vat: e.target.value })} />
          <Input aria-label="Your VAT number" placeholder="Your VAT number (optional)" value={sellerVAT} onChange={(e) => setSellerVAT(e.target.value)} />
        </div>
        <textarea aria-label="Customer’s address" rows={2} placeholder="Their address (optional)" className={`w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`} value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
        <ul className="flex flex-col gap-2" aria-label="Lines">
          {lines.map((l, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Input aria-label={`Line ${i + 1}: description`} placeholder="What for" className="min-w-40 flex-1" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              <Input aria-label={`Line ${i + 1}: quantity`} inputMode="numeric" placeholder="Qty" className="w-20 font-figure" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <Input aria-label={`Line ${i + 1}: unit price in ${currency}`} inputMode="decimal" placeholder={`Each, ${currency}`} className="w-28 font-figure" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
              <Input aria-label={`Line ${i + 1}: VAT %`} inputMode="decimal" placeholder="VAT %" className="w-20 font-figure" value={l.vat} onChange={(e) => setLine(i, { vat: e.target.value })} />
              <Button type="button" disabled={lines.length === 1} onClick={() => setLines((old) => old.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div>
          <Button type="button" onClick={() => setLines((old) => [...old, blankLine()])}>
            Add a line
          </Button>
        </div>
        <div className="grid gap-3 wide:grid-cols-3">
          <label className="flex flex-col gap-1 text-caption text-muted">
            Due on
            <Input aria-label="Due on" type="date" className="font-figure" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            Remind this many days before (0: none)
            <Input aria-label="Remind this many days before" inputMode="numeric" className="font-figure" value={remind} onChange={(e) => setRemind(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            Total with VAT
            <span className="text-body font-figure text-ink" data-testid="new-invoice-total">
              {formatMinor(total, currency)}
            </span>
          </label>
        </div>
        <textarea aria-label="Memo" rows={2} placeholder="A note on the invoice (optional)" className={`w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`} value={memo} onChange={(e) => setMemo(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={!complete || create.isPending}>
            {create.isPending ? 'Issuing…' : 'Create and send'}
          </Button>
          <Button type="button" disabled={!complete || create.isPending} onClick={() => create.mutate(false)}>
            Save as draft
          </Button>
        </div>
        {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
        {made !== null ? (
          <Note ok>
            <span className="font-figure">{made.number}</span> {made.status === 'draft' ? 'saved as a draft' : 'sent'}:{' '}
            <span className="font-figure">{formatMinor(made.total_minor, made.currency)}</span> due by{' '}
            <span className="font-figure">{made.due_date}</span>.{made.pay_url ? ' Pay link: ' : ''}
            {made.pay_url ? <span className="font-figure">{made.pay_url}</span> : null}
          </Note>
        ) : null}
      </form>
    </Card>
  )
}

function InvoiceRow({ inv }: { inv: Invoice }) {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)
  const refresh = () => void qc.invalidateQueries({ queryKey: INVOICES_KEY })
  const send = useMutation({ mutationFn: () => agentBankApi.sendInvoice(inv.id), onSuccess: refresh })
  const voidIt = useMutation({ mutationFn: () => agentBankApi.voidInvoice(inv.id), onSuccess: refresh })
  const s = STATUS[inv.status] ?? { text: inv.status, pill: 'idle' as PillStatus }
  const busy = send.isPending || voidIt.isPending
  return (
    <li className="flex flex-col gap-2 border-b border-rule px-gutter py-3 last:border-b-0" data-testid={`invoice-${inv.number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-body text-ink">
          <span className="font-figure">{inv.number}</span> · {inv.customer_name}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-body font-figure text-ink">{formatMinor(inv.total_minor, inv.currency)}</span>
          <Pill status={s.pill}>{s.text}</Pill>
        </span>
      </div>
      <p className="text-caption text-muted">
        Due <span className="font-figure">{inv.due_date}</span> · reference <span className="font-figure">{inv.reference}</span>
        {inv.paid_at ? (
          <>
            {' '}
            · paid <span className="font-figure">{formatWhen(inv.paid_at)}</span>
          </>
        ) : null}
        {inv.due_minor !== inv.total_minor && inv.status !== 'paid' ? (
          <>
            {' '}
            · <span className="font-figure">{formatMinor(inv.due_minor, inv.currency)}</span> still due
          </>
        ) : null}
      </p>
      {(inv.payments ?? []).map((p) => (
        <p key={p.entry_id} className="text-caption text-muted">
          <span className="font-figure">{formatMinor(p.amount_minor, inv.currency)}</span> by {p.method} · <span className="font-figure">{formatWhen(p.paid_at)}</span>
        </p>
      ))}
      {inv.pay_url && inv.status !== 'void' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label={`Pay link for ${inv.number}`} readOnly className="font-figure wide:w-96" value={inv.pay_url} data-testid="pay-link" />
          <Button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(inv.pay_url ?? '').then(() => setCopied(true))
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <a className={`text-caption ${inlineLink}`} href={inv.pay_url} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>
      ) : null}
      {inv.status === 'draft' || inv.status === 'sent' || inv.status === 'overdue' ? (
        <div className="flex flex-wrap items-center gap-2">
          {inv.status === 'draft' ? (
            <Button type="button" disabled={busy} onClick={() => send.mutate()}>
              {send.isPending ? 'Sending…' : 'Send'}
            </Button>
          ) : null}
          <Button type="button" disabled={busy} onClick={() => voidIt.mutate()}>
            {voidIt.isPending ? 'Voiding…' : 'Void'}
          </Button>
        </div>
      ) : null}
      {send.isError ? <Note ok={false}>{refusalText(send.error)}</Note> : null}
      {voidIt.isError ? <Note ok={false}>{refusalText(voidIt.error)}</Note> : null}
    </li>
  )
}
