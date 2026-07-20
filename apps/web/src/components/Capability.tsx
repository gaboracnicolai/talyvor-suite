import { Row } from '@talyvor/ui'

// A capability that is turned off is INFORMATION, not a fault, so it renders calm: a
// NEUTRAL (faint, un-hued) marker plus a plain explanatory line. No red, no "couldn't
// load" — that state is reserved for genuine failures. The dot is faint grey on purpose:
// it rhymes with a status pill's shape but carries no status hue, because "off" is the
// absence of a status, not one of them (which is also why Pill has no such variant).
export function CapabilityOff({ name, note }: { name: string; note?: string }) {
  return (
    <Row label={name} hint={note ?? 'This capability is turned off in this workspace.'}>
      <span className="inline-flex items-center gap-1.5 text-caption uppercase tracking-wide text-faint">
        <span className="h-1.5 w-1.5 rounded-pill bg-faint" aria-hidden="true" />
        Off
      </span>
    </Row>
  )
}
