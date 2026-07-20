import { useState } from 'react'
import {
  Button,
  Card,
  CardHeader,
  HoldBar,
  Input,
  MuNumeral,
  NavItem,
  Pill,
  Row,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TierDot,
} from '@talyvor/ui'
import type { Tier } from '@talyvor/ui'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <div className="flex flex-col gap-3 p-gutter">{children}</div>
    </Card>
  )
}

// A dense routing table — the highest colour density in the system, for judging the
// four-step ramp.
const routes: { model: string; tier: Tier; status: 'settled' | 'held' | 'idle' | 'slashed' }[] = [
  { model: 'haiku-4.5', tier: 1, status: 'settled' },
  { model: 'llama-3.3-70b', tier: 1, status: 'settled' },
  { model: 'mistral-large', tier: 2, status: 'held' },
  { model: 'sonnet-5', tier: 2, status: 'settled' },
  { model: 'gpt-5.1', tier: 3, status: 'held' },
  { model: 'opus-4.8', tier: 4, status: 'idle' },
  { model: 'o5-pro', tier: 4, status: 'slashed' },
]

function Gallery() {
  const [checked, setChecked] = useState(true)
  return (
    <div className="flex flex-col gap-gutter">
      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="danger">Delete workspace</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Controls">
        <Row label="Enable telemetry" hint="Send anonymous usage.">
          <Switch checked={checked} onCheckedChange={setChecked} aria-label="Enable telemetry" />
        </Row>
        <Row label="Default model" hint="Routed unless overridden.">
          <Select defaultValue="sonnet-5">
            <SelectTrigger className="w-44" aria-label="Default model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="haiku-4.5">Haiku 4.5</SelectItem>
              <SelectItem value="sonnet-5">Sonnet 5</SelectItem>
              <SelectItem value="opus-4.8">Opus 4.8</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row label="Workspace name">
          <Input placeholder="acme-prod" className="w-44" defaultValue="acme-prod" />
        </Row>
      </Section>

      <Section title="Cards">
        <div className="text-caption text-muted">A plain card and the proof-rule variant:</div>
        <Card>
          <div className="px-gutter py-2.5 text-body text-ink">Plain card — a surface with a hairline rule.</div>
        </Card>
        <Card proof>
          <div className="px-gutter py-2.5 text-body text-ink">
            Proof card — a 2&nbsp;px accent rule marks a proven claim.
          </div>
        </Card>
      </Section>

      <Section title="Status pills">
        <div className="flex flex-wrap items-center gap-2">
          <Pill status="settled">Settled</Pill>
          <Pill status="held">Held</Pill>
          <Pill status="slashed">Slashed</Pill>
          <Pill status="idle">Idle</Pill>
          <Pill status="lens">Lens</Pill>
          <Pill status="lxc">LXC</Pill>
        </div>
      </Section>

      <Section title="µ-numerals">
        <Row label="Mined this epoch">
          <MuNumeral micros={12_340567} unit="lens" />
        </Row>
        <Row label="Pegged balance">
          <MuNumeral micros={1_004200} unit="lxc" />
        </Row>
      </Section>

      <Section title="Hold bars">
        <Row label="Compute reward" hint="Held until the epoch settles.">
          <div className="w-52">
            <HoldBar elapsed={9} total={14} remainingLabel="5d left" />
          </div>
        </Row>
        <Row label="Pattern royalty" hint="Half-way through the hold.">
          <div className="w-52">
            <HoldBar elapsed={7} total={14} remainingLabel="7d left" />
          </div>
        </Row>
      </Section>

      <Section title="Routing ramp — dense table">
        <div role="table" aria-label="Routing table" className="flex flex-col">
          <div role="row" className="flex items-center gap-gutter border-b border-rule pb-1.5 text-caption uppercase tracking-wide text-faint">
            <span role="columnheader" className="w-32">Model</span>
            <span role="columnheader" className="w-24">Tier</span>
            <span role="columnheader">Status</span>
          </div>
          {routes.map((r) => (
            <div key={r.model} role="row" className="flex min-h-row items-center gap-gutter border-b border-rule last:border-b-0">
              <span role="cell" className="w-32 truncate font-mono text-body text-ink">{r.model}</span>
              <span role="cell" className="w-24"><TierDot tier={r.tier} label={`Tier ${r.tier}`} /></span>
              <span role="cell"><Pill status={r.status}>{r.status}</Pill></span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Nav items">
        <div className="w-52 rounded-card border border-rule bg-sidebar p-1">
          <NavItem active>Overview</NavItem>
          <NavItem>Economy</NavItem>
          <NavItem disabled>Disabled</NavItem>
        </div>
      </Section>
    </div>
  )
}

function Frame({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <section data-theme={theme} className="rounded-card border border-rule bg-canvas p-gutter" aria-label={`${theme} theme`}>
      <div className="mb-3 text-caption font-semibold uppercase tracking-wide text-faint">{theme}</div>
      <Gallery />
    </section>
  )
}

export function Specimen() {
  return (
    <div className="flex flex-col gap-gutter">
      <div className="text-body text-muted">
        Every component, in both themes. This is the review surface — not a throwaway.
      </div>
      <div className="grid gap-gutter wide:grid-cols-2">
        <Frame theme="light" />
        <Frame theme="dark" />
      </div>
    </div>
  )
}
