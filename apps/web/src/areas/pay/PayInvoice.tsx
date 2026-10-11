import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, CardHeader, Pill, focusRing, inlineLink } from '@talyvor/ui'

import { useDocumentTitle } from '../../documentTitle'
import { ApiError } from '../../lib/api'
import { SiteFooter, SiteHeader } from '../../components/SiteChrome'
import { TealRule } from '../marketing/Landing'
import { Card } from '../lens/walletBrand'
import { BOOK_KEY } from '../lens/AgentBank'
import { Note } from '../lens/WalletMoney'
import { formatWhen } from '../lens/format'
import { AgentBankError, type PayPage, agentBankApi, formatMinor, refusalText } from '../lens/agentBankApi'

// B30.97 — an invoice's pay page, opened by whoever holds its link, signed out (Lens B30.20). OUTSIDE the AuthGate
// (App.tsx) for the same reason as a shared chat: the payer has no account here. It shows the invoice as Lens serves it
// to a payer — no ids, no ledger — and three ways to pay what is due: a card (Stripe test mode, through Lens), a transfer
// to the issuer's account details quoting the reference, or one of the visitor's own Talyvor agents once they sign in.
// "Preview — test money only" while Lens says so.

const FOOTER_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]

async function readPage(token: string): Promise<PayPage> {
  const path = `/api/public/pay/${encodeURIComponent(token)}`
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as PayPage
}

/** Lens opens a Stripe test-mode Checkout for what is due; the browser goes there. */
async function startCard(token: string): Promise<string> {
  const path = `/api/public/pay/${encodeURIComponent(token)}/card`
  const res = await fetch(path, { method: 'POST', headers: { Accept: 'application/json' } })
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !body.url) throw new AgentBankError(res.status, path, body.error ?? '')
  return body.url
}

const payable = (p: PayPage) => p.invoice.status === 'sent' || p.invoice.status === 'overdue'

function Body({ token }: { token: string }) {
  const [search] = useSearchParams()
  const returned = search.get('paid') === 'card'
  const page = useQuery({
    queryKey: ['pay-page', token],
    queryFn: () => readPage(token),
    retry: false,
    // Back from the card payment: Stripe's webhook pays the invoice a moment later, so the page reads again until it reads paid.
    refetchInterval: (q) => (returned && q.state.data !== undefined && q.state.data.invoice.status !== 'paid' ? 2000 : false),
  })

  if (page.isPending) return <p className="text-body text-muted">Reading the invoice…</p>
  if (page.isError) {
    const gone = page.error instanceof ApiError && page.error.status >= 400 && page.error.status < 500
    return (
      <>
        <h1 className="text-display-3 text-ink">{gone ? 'This invoice isn’t available' : 'The invoice couldn’t be read'}</h1>
        <TealRule className="mt-5" />
        <p className="mt-5 max-w-lg text-reading text-muted">
          {gone
            ? 'The link may be mistyped or out of date. Ask whoever sent it for a new one.'
            : 'Talyvor didn’t answer just now, so nothing is shown rather than something stale. Try again in a moment.'}
        </p>
      </>
    )
  }

  const p = page.data
  const inv = p.invoice
  const preview = p.notice.startsWith('Preview')
  const headline =
    inv.status === 'paid'
      ? 'Paid — thank you'
      : inv.status === 'void'
        ? 'This invoice was voided'
        : payable(p)
          ? `${formatMinor(inv.due_minor, inv.currency)} due by ${inv.due_date}`
          : 'This invoice has not been sent yet'
  return (
    <>
      <p className="text-eyebrow uppercase text-label">
        Invoice <span className="font-figure">{inv.number}</span> · from {inv.issuer || 'a Talyvor agent'}
      </p>
      <h1 className="mt-4 text-display-3 text-ink" data-testid="pay-headline">
        {headline}
      </h1>
      <TealRule className="mt-5" />
      {preview ? (
        <p className="mt-5 flex flex-wrap items-center gap-2 text-caption text-ink" data-testid="pay-preview">
          <Pill status="held">Preview — test money only</Pill>
          <span>{p.notice}</span>
        </p>
      ) : null}
      {returned && inv.status !== 'paid' ? (
        <p className="mt-5 text-body text-muted" role="status">
          Thank you. Your card payment is being confirmed; this page updates as soon as the invoice reads paid.
        </p>
      ) : null}
      {inv.status === 'paid' && inv.paid_at ? (
        <p className="mt-5 text-body text-muted" data-testid="pay-paid">
          <span className="font-figure">{formatMinor(inv.paid_minor, inv.currency)}</span> received{' '}
          <span className="font-figure">{formatWhen(inv.paid_at)}</span>
          {(inv.payments ?? []).map((pay) => (
            <span key={pay.entry_id}>
              {' '}· <span className="font-figure">{formatMinor(pay.amount_minor, inv.currency)}</span> by {pay.method}
            </span>
          ))}
          .
        </p>
      ) : null}

      <div className="mt-10 grid max-w-3xl gap-6">
        <Card>
          <CardHeader>The invoice</CardHeader>
          <div className="flex flex-col gap-3 px-gutter py-3 text-body text-ink">
            <p>
              Billed to {inv.customer_name}
              {inv.customer_address ? <span className="block whitespace-pre-wrap text-caption text-muted">{inv.customer_address}</span> : null}
              {inv.customer_vat_number ? <span className="block text-caption text-muted">VAT {inv.customer_vat_number}</span> : null}
            </p>
            <table className="w-full text-caption">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1 font-normal">Item</th>
                  <th className="py-1 text-right font-normal">Qty × each</th>
                  <th className="py-1 text-right font-normal">VAT</th>
                  <th className="py-1 text-right font-normal">Net</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i} className="border-t border-rule">
                    <td className="py-1 text-ink">{l.description}</td>
                    <td className="py-1 text-right font-figure">
                      {l.quantity} × {formatMinor(l.unit_amount_minor, inv.currency)}
                    </td>
                    <td className="py-1 text-right font-figure">{(l.vat_rate_bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%</td>
                    <td className="py-1 text-right font-figure">{formatMinor(l.net_minor ?? l.quantity * l.unit_amount_minor, inv.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="flex flex-col gap-1 text-caption">
              {(
                [
                  ['Subtotal', inv.subtotal_minor, false, undefined],
                  ['VAT', inv.vat_minor, false, undefined],
                  ['Total', inv.total_minor, true, 'pay-total'],
                  ...(inv.paid_minor > 0 ? [['Paid', inv.paid_minor, false, undefined] as const] : []),
                  ['Due', inv.due_minor, true, 'pay-due'],
                ] as const
              ).map(([label, minor, strong, testid]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className={strong ? 'text-ink' : 'text-muted'}>{label}</dt>
                  <dd className={`font-figure ${strong ? 'text-ink' : ''}`} data-testid={testid}>
                    {formatMinor(minor, inv.currency)}
                  </dd>
                </div>
              ))}
            </dl>
            {inv.memo ? <p className="whitespace-pre-wrap text-caption text-muted">{inv.memo}</p> : null}
            {inv.seller_vat_number ? <p className="text-caption text-muted">Issuer’s VAT number {inv.seller_vat_number}</p> : null}
          </div>
        </Card>

        {payable(p) ? (
          <>
            <PayByCard token={token} page={p} />
            {p.transfer ? <PayByTransfer transfer={p.transfer} /> : null}
            <PayByAgent token={token} page={p} />
          </>
        ) : null}
      </div>
    </>
  )
}

function PayByCard({ token, page }: { token: string; page: PayPage }) {
  const card = useMutation({
    mutationFn: () => startCard(token),
    onSuccess: (url) => window.location.assign(url),
  })
  return (
    <Card>
      <CardHeader>Pay by card</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        {page.card ? (
          <>
            <p className="text-caption text-muted">A card payment opens on Stripe’s secure page and comes back here once it is confirmed.</p>
            <div>
              <Button type="button" variant="primary" disabled={card.isPending} onClick={() => card.mutate()}>
                {card.isPending ? 'Opening…' : 'Pay '}
                {card.isPending ? null : <span className="font-figure">{formatMinor(page.invoice.due_minor, page.invoice.currency)}</span>}
                {card.isPending ? null : ' by card'}
              </Button>
            </div>
            {card.isError ? <Note ok={false}>{refusalText(card.error)}</Note> : null}
          </>
        ) : (
          <p className="text-caption text-muted">Card payments are not available for this invoice.</p>
        )}
      </div>
    </Card>
  )
}

function PayByTransfer({ transfer }: { transfer: NonNullable<PayPage['transfer']> }) {
  const [copied, setCopied] = useState(false)
  const d = transfer.details
  const rows: [string, string | undefined][] = [
    ['Account holder', d.holder],
    ['Sort code', d.sort_code],
    ['Account number', d.account_number],
    ['IBAN', d.iban],
    ['BIC', d.bic],
    ['Routing number', d.routing_number],
  ]
  return (
    <Card>
      <CardHeader>Pay by transfer</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        <p className="text-caption text-muted">
          Send {d.currency} from your own bank to these details and quote the reference exactly: it marks the invoice paid.
        </p>
        <dl className="flex flex-col gap-1 text-caption">
          {rows
            .filter((r): r is [string, string] => Boolean(r[1]))
            .map(([k, v]) => (
              <div key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <dt className="w-32 text-muted">{k}</dt>
                <dd className="font-figure text-ink">{v}</dd>
              </div>
            ))}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <dt className="w-32 text-muted">Reference</dt>
            <dd className="flex flex-wrap items-center gap-2 font-figure text-ink" data-testid="pay-reference">
              {transfer.reference}
              <Button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(transfer.reference).then(() => setCopied(true))
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </dd>
          </div>
        </dl>
        {transfer.mode === 'TEST' ? <p className="text-caption text-muted">These are test account details: no real transfer reaches them.</p> : null}
      </div>
    </Card>
  )
}

function PayByAgent({ token, page }: { token: string; page: PayPage }) {
  const qc = useQueryClient()
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book, retry: false })
  const [agent, setAgent] = useState('')
  // The chosen agent belongs to this invoice: another link in the same tab starts with none chosen.
  const [agentFor, setAgentFor] = useState(token)
  if (agentFor !== token) {
    setAgentFor(token)
    setAgent('')
  }
  const pay = useMutation({
    mutationFn: () => agentBankApi.payInvoiceByAgent(token, agent),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pay-page', token] }),
  })
  const signedOut = book.isError && book.error instanceof ApiError && book.error.status === 401
  const agents = (book.data?.agents ?? []).filter((a) => !a.archived_at)
  return (
    <Card>
      <CardHeader>Pay with a Talyvor agent</CardHeader>
      <div className="flex flex-col gap-2 px-gutter py-3">
        {book.isPending ? (
          <p className="text-caption text-muted">Looking for your agents…</p>
        ) : signedOut || book.isError ? (
          <p className="text-caption text-muted">
            One of your own agents can pay this from its {page.invoice.currency} account.{' '}
            <Link className={inlineLink} to={`/signin?next=${encodeURIComponent(`/pay/${token}`)}`}>
              Sign in
            </Link>{' '}
            to choose it.
          </p>
        ) : agents.length === 0 ? (
          <p className="text-caption text-muted">You have no agent to pay with yet.</p>
        ) : (
          <>
            <p className="text-caption text-muted">The agent pays from its {page.invoice.currency} account; its spending rules apply.</p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Which agent pays"
                className={`h-8 w-56 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`}
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
              >
                <option value="">Choose an agent…</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Button type="button" disabled={agent === '' || pay.isPending} onClick={() => pay.mutate()}>
                {pay.isPending ? 'Paying…' : 'Pay with this agent'}
              </Button>
            </div>
            {pay.isError ? <Note ok={false}>{refusalText(pay.error)}</Note> : null}
          </>
        )}
      </div>
    </Card>
  )
}

export function PayInvoicePage() {
  useDocumentTitle('Pay an invoice')
  const { token = '' } = useParams()
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <SiteHeader product="Invoices" />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-gutter py-12">
          <Body key={token} token={token} />
        </div>
      </main>

      <SiteFooter links={FOOTER_LINKS} />
    </div>
  )
}
