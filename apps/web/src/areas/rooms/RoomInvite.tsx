import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Row, cn, focusRing, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { ApiError } from '../../lib/api'
import { formatWhen } from '../lens/format'
import { Card, Note, readFailure } from '../marketplace/parts'
import { ROOMS_KEY, STORED_NOTICE, roomRefusal, roomsApi, shareText, spendPolicyText, splitRuleText, usdText } from './roomsApi'

// RoomInvite.tsx — B32.55: where a room's invite link opens (/rooms/invite/:token). Lens shows whoever holds a live
// link the room, its current terms and what is left of the link (B32.29); joining accepts those terms. A link that
// was revoked, has expired or is used up answers 404, as a room that does not exist does.

export function RoomInvite() {
  const { token = '' } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [accepted, setAccepted] = useState(false)
  const preview = useQuery({ queryKey: [...ROOMS_KEY, 'invite', token], queryFn: () => roomsApi.previewInvite(token), retry: false })
  const join = useMutation({
    mutationFn: (version: number) => roomsApi.joinByInvite(token, version),
    onSuccess: (joined) => {
      void qc.invalidateQueries({ queryKey: ROOMS_KEY })
      navigate(`/rooms/${encodeURIComponent(joined.room_id)}`)
    },
  })
  // Another link's terms are not accepted by ticking this one's: the box and a refusal belong to the link.
  const [stateOf, setStateOf] = useState(token)
  if (stateOf !== token) {
    setStateOf(token)
    setAccepted(false)
    join.reset()
  }
  const all = (
    <Link className={`text-body text-ink ${inlineLink}`} to="/rooms">
      All rooms
    </Link>
  )
  if (preview.isError || preview.isPending) {
    const gone = preview.error instanceof ApiError && preview.error.status === 404
    return (
      <Region index="00" label="Invite" heading="Room invite" sectionClassName="pb-10 pt-4" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">
          {preview.isPending
            ? 'Reading…'
            : gone
              ? 'This invite link no longer admits anyone: it was revoked, has expired or has been used up.'
              : readFailure(preview.error, 'This invite')}
        </p>
        {all}
      </Region>
    )
  }
  const { room, terms } = preview.data
  return (
    <>
      <Region index="00" label="Invite" heading={room.title} sectionClassName="pb-8 pt-4 wide:pb-10" className="flex max-w-2xl flex-col gap-3">
        {room.description ? <p className="text-body text-muted">{room.description}</p> : null}
        <p className="rounded-card border border-rule bg-raised p-4 text-body text-ink">{STORED_NOTICE}</p>
        <p className="text-caption text-muted">
          A private room · <span className="font-figure">{room.member_count}</span> {room.member_count === 1 ? 'member' : 'members'} ·
          this link admits <span className="font-figure">{preview.data.uses_left}</span> more until{' '}
          <span className="font-figure">{formatWhen(preview.data.expires_at)}</span>
        </p>
      </Region>
      <Region index="01" label="Terms" className="flex max-w-2xl flex-col gap-3">
        <Card>
          <Row stack label="Default price per use">
            <span className="font-figure text-body text-ink">{usdText(terms.default_price_usd_micros)}</span>
          </Row>
          <Row stack label="How earnings are split">
            <span className="text-body text-ink">{splitRuleText(terms.split_rule)}</span>
          </Row>
          <Row stack label="Remix share">
            <span className="font-figure text-body text-ink">{shareText(terms.remix_share_bps)}</span>
          </Row>
          <Row stack label="Who may spend the room’s money">
            <span className="text-body text-ink">{spendPolicyText(terms.spend_policy)}</span>
          </Row>
          <Row stack label="Version">
            <span className="font-figure text-body text-ink">{terms.version}</span>
          </Row>
        </Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (accepted && !join.isPending) join.mutate(terms.version)
          }}
        >
          <label className="flex items-start gap-2 text-body text-ink">
            <input
              type="checkbox"
              className={cn(
                'mt-1 h-4 w-4 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50',
                focusRing,
              )}
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            I accept these terms for my workspace, and I understand the room’s messages are stored by Talyvor.
          </label>
          <div>
            <Button type="submit" variant="primary" disabled={!accepted || join.isPending}>
              {join.isPending ? 'Joining…' : 'Join room'}
            </Button>
          </div>
          {join.isError ? <Note ok={false}>{roomRefusal(join.error)}</Note> : null}
        </form>
        {all}
      </Region>
    </>
  )
}
