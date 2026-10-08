import { Switch } from '@talyvor/ui'

// B28.381 — a chat kept out of the shared pool. "Sharing", under the composer, is on in a new chat, where the
// workspace's Answer sharing decides. Turned off, it is kept with the conversation (history.ts `pool_off`) and every
// question in it goes with chatApi.ts POOL_HEADER `off`: Lens puts none of its answers in the shared pool, so no other
// workspace is ever served one, and serves it none of theirs (talyvor-lens B28.133). The workspace's own cache still
// serves it its own earlier answers. With the workspace's Answer sharing off nothing is shared anyway, and it says so.

export function ChatSharing({
  off,
  workspaceOff,
  onChange,
  disabled,
}: {
  /** This chat is kept out of the shared pool. */
  off: boolean
  /** The workspace's Answer sharing is off, so no chat of it shares. */
  workspaceOff: boolean
  onChange: (off: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="chat-sharing">
      <label htmlFor="chat-sharing" className="font-figure text-eyebrow uppercase text-label">
        Sharing
      </label>
      <Switch
        id="chat-sharing"
        checked={!off && !workspaceOff}
        disabled={disabled || workspaceOff}
        onCheckedChange={(on) => onChange(!on)}
        aria-describedby="chat-sharing-state"
      />
      <span id="chat-sharing-state" className="text-caption text-muted" data-testid="chat-sharing-state">
        {workspaceOff
          ? 'Off for your workspace'
          : off
            ? 'Off — this chat’s answers are never shared with another workspace'
            : 'On'}
      </span>
    </div>
  )
}
