import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardHeader, Input, Pill } from '@talyvor/ui'
import { isSessionExpired } from '../../lib/productState'
import { formatWhen } from './format'
import { type Agent, type AgentCard, type CardAuthorization, type Cardholder, agentBankApi, formatULXC, refusalText } from './agentBankApi'

// AgentCardPanel.tsx — B19.24: an agent's card on Agent Wallets. Lens (B19.12) issues an agent a virtual
// card through Stripe Issuing, in TEST MODE ONLY — cards are class RED, test money until a licensed partner
// exists — and decides every purchase on it in real time by the agent's rules and balance, converting it
// from pounds at the day's European Central Bank reference rate. This shows the card and each purchase
// with Lens's own reason and the rate; issuing one asks for the cardholder Stripe needs.

const cardKey = (id: string) => ['agent-card', id]

/** An amount in a currency's minor units, as money: 150 gbp → £1.50. */
export function moneyText(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

/** "£1 = $1.3972 · ECB, 2026-09-25": the rate a purchase was converted at, from the ECB's two published figures. */
export function rateText(a: CardAuthorization): string | null {
  const usd = Number(a.ecb_usd_per_eur)
  const ccy = Number(a.ecb_currency_per_eur)
  if (!a.rate_date || !(usd > 0) || !(ccy > 0)) return null
  return `${moneyText(100, a.currency).replace(/\.00$/, '')} = $${(usd / ccy).toFixed(4)} · ECB, ${a.rate_date.slice(0, 10)}`
}

function CardFace({ card }: { card: AgentCard }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-gutter py-3" data-testid="agent-card">
      <span className="font-figure text-body text-ink">•••• {card.last4}</span>
      <span className="text-caption text-muted">
        expires {String(card.exp_month).padStart(2, '0')}/{String(card.exp_year).slice(-2)} · {card.currency.toUpperCase()}
      </span>
      {card.livemode ? null : <Pill status="held">Test mode</Pill>}
    </div>
  )
}

function Purchases({ auths }: { auths: CardAuthorization[] }) {
  return (
    <table className="w-full text-body" data-testid="agent-card-purchases">
      <thead>
        <tr className="text-left text-caption text-muted">
          <th className="px-gutter py-2 font-normal">When</th>
          <th className="py-2 font-normal">Purchase</th>
          <th className="py-2 text-right font-normal">Amount</th>
          <th className="px-gutter py-2 text-right font-normal">Charged</th>
        </tr>
      </thead>
      <tbody>
        {auths.map((a) => {
          const rate = rateText(a)
          return (
            <tr key={a.id} className="border-t border-rule align-top text-ink">
              <td className="px-gutter py-2 font-figure text-caption text-muted">{formatWhen(a.created_at)}</td>
              <td className="py-2">
                <span className="mr-2">{a.merchant_name || 'A merchant'}</span>
                <Pill status={a.approved ? 'settled' : 'slashed'}>{a.approved ? 'Approved' : 'Declined'}</Pill>
                {a.reason ? <p className="text-caption text-muted">{a.reason}</p> : null}
                {rate ? <p className="font-figure text-caption text-muted">{rate}</p> : null}
              </td>
              <td className="py-2 text-right font-figure">{moneyText(a.amount_minor, a.currency)}</td>
              <td className="px-gutter py-2 text-right font-figure">
                {a.approved && a.amount_ulxc ? `−${formatULXC(a.amount_ulxc)}` : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/**
 * B27.21 — the cardholder's phone as Stripe takes it, E.164: "+44 7700 900123" → "+447700900123". Empty stays
 * empty (Lens gives a test card an unallocated number); null when what was typed is not a phone number.
 */
export function e164(text: string): string | null {
  const compact = text.replace(/[\s().-]/g, '')
  if (compact === '') return ''
  return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : null
}

const FIELDS: { key: keyof Cardholder; label: string; required: boolean; width: string; auto: string; type?: string }[] = [
  { key: 'first_name', label: 'First name', required: true, width: 'w-40', auto: 'given-name' },
  { key: 'last_name', label: 'Last name', required: true, width: 'w-40', auto: 'family-name' },
  { key: 'email', label: 'Email', required: false, width: 'w-64', auto: 'email' },
  { key: 'phone_number', label: 'Phone', required: false, width: 'w-48', auto: 'tel', type: 'tel' },
  { key: 'line1', label: 'Address', required: true, width: 'w-64', auto: 'address-line1' },
  { key: 'line2', label: 'Address line 2', required: false, width: 'w-64', auto: 'address-line2' },
  { key: 'city', label: 'Town or city', required: true, width: 'w-40', auto: 'address-level2' },
  { key: 'postal_code', label: 'Postcode', required: true, width: 'w-28', auto: 'postal-code' },
  { key: 'country', label: 'Country (two letters)', required: false, width: 'w-20', auto: 'country' },
]

function IssueCard({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const [holder, setHolder] = useState<Cardholder>({
    first_name: '',
    last_name: '',
    email: '',
    phone_number: '',
    line1: '',
    line2: '',
    city: '',
    postal_code: '',
    country: 'GB',
  })
  const phone = e164(holder.phone_number)
  const ready = FIELDS.every((f) => !f.required || holder[f.key].trim() !== '') && phone !== null
  const issue = useMutation({
    mutationFn: () => agentBankApi.issueCard(agent.id, { ...holder, phone_number: phone ?? '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: cardKey(agent.id) }),
  })
  return (
    <form
      className="flex flex-col gap-2 px-gutter py-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !issue.isPending) issue.mutate()
      }}
    >
      <p className="text-body text-muted">
        Give {agent.name} a virtual card for test purchases. Each purchase is paid from its wallet only if its rules
        allow it, converted from pounds at the day’s European Central Bank rate. Stripe issues the card to a person —
        the cardholder — and a merchant may ask for their billing address. Their phone number is optional on a test
        card.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {FIELDS.map((f) => (
          <Input
            key={f.key}
            aria-label={f.label}
            placeholder={f.required ? f.label : `${f.label} (optional)`}
            autoComplete={f.auto}
            type={f.type}
            aria-invalid={f.key === 'phone_number' && phone === null}
            className={f.width}
            value={holder[f.key]}
            onChange={(e) => setHolder((h) => ({ ...h, [f.key]: e.target.value }))}
          />
        ))}
      </div>
      {phone === null ? (
        <p className="text-caption text-ink">
          The phone number needs its country code, like +44 7700 900123.
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={!ready || issue.isPending}>
          {issue.isPending ? 'Issuing…' : 'Issue a test card'}
        </Button>
      </div>
      {issue.isError ? (
        <p role="alert" className="text-caption text-ink">
          {refusalText(issue.error)}
        </p>
      ) : null}
    </form>
  )
}

export function AgentCardPanel({ agent }: { agent: Agent }) {
  const q = useQuery({ queryKey: cardKey(agent.id), queryFn: () => agentBankApi.card(agent.id) })
  return (
    <Card>
      <CardHeader>Card</CardHeader>
      {q.isError ? (
        <p className="px-gutter py-3 text-body text-muted">
          {isSessionExpired(q.error)
            ? 'Its card can’t be read until you sign in again.'
            : 'Its card could not be read just now.'}
        </p>
      ) : q.isPending ? (
        <p className="px-gutter py-3 text-body text-muted">Reading…</p>
      ) : q.data ? (
        <>
          <CardFace card={q.data.card} />
          <div className="border-t border-rule">
            {(q.data.authorizations ?? []).length === 0 ? (
              <p className="px-gutter py-3 text-body text-muted">
                No purchases yet. Each one appears here when the agent pays with this card, with what its rules
                decided and why.
              </p>
            ) : (
              <Purchases auths={q.data.authorizations ?? []} />
            )}
          </div>
        </>
      ) : (
        <IssueCard agent={agent} />
      )}
    </Card>
  )
}
