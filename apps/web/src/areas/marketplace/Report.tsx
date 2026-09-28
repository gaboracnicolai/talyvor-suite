import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, focusRing } from '@talyvor/ui'
import { type Listing, REPORT_REASONS, marketApi, refusalText } from './marketApi'
import { Note, selectClass } from './parts'

// Report.tsx — B20.11: anyone who can see a listing can report it to Talyvor's review (Lens B20.4). A
// second report from the same workspace while the first is open changes nothing, and says so.

export function ReportListing({ listing }: { listing: Listing }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const report = useMutation({ mutationFn: () => marketApi.report(listing.id, reason, details.trim()) })
  if (report.isSuccess) {
    return (
      <Note ok>
        {report.data.already_reported
          ? 'You have already reported this listing; Talyvor’s review has it.'
          : 'Reported. Talyvor reviews it, and takes it down if it breaks the rules — anyone who paid for it inside the holdback is refunded.'}
      </Note>
    )
  }
  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Report this listing</Button>
      </div>
    )
  }
  return (
    <form
      className="flex max-w-2xl flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (reason !== '' && !report.isPending) report.mutate()
      }}
    >
      <label className="text-caption text-muted">
        What is wrong with it
        <select className={selectClass} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choose a reason</option>
          {REPORT_REASONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-caption text-muted">
        Details (optional)
        <textarea
          className={`min-h-20 w-full rounded-control border border-rule bg-surface p-3 text-body text-ink placeholder:text-faint transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          maxLength={2000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={reason === '' || report.isPending}>
          {report.isPending ? 'Sending…' : 'Send report'}
        </Button>
        <Button type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {report.isError ? <Note ok={false}>{refusalText(report.error)}</Note> : null}
    </form>
  )
}
