import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, Input, cn, inlineLink } from '@talyvor/ui'

import { type Conversation, loadConversations } from './history'
import { SyncError, deleteSyncedCopy, mergeHistories, readDeleted, syncHistory, syncIsOn, turnOffSync, turnOnSync } from './historySync'

// B28.365 — "Sync across devices" under the conversation list: off until turned on here with a passphrase, then
// this browser's history merged with the sealed copy when Chat opens, after each change, on return to the tab and
// when asked. See historySync.ts for what is sealed and where it goes.

export interface HistorySync {
  on: boolean
  busy: boolean
  /** When the last sync finished, in ms; null before one has. */
  syncedAt: number | null
  error: string | null
  turnOn: (passphrase: string) => Promise<boolean>
  turnOff: () => void
  deleteCopy: () => Promise<void>
  now: () => void
  /** A change was saved here: syncs shortly after the last of a burst. */
  soon: () => void
}

/** `write` keeps a list in this browser the way Chat's store does, without counting as a change to sync. */
export function useHistorySync(scope: string | null, write: (update: (list: Conversation[]) => Conversation[]) => void): HistorySync {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  const again = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // The stored copy merged into whatever the list holds when it lands: a question asked meanwhile is kept.
  const apply = useCallback(
    (owner: string, merged: { conversations: Conversation[]; deleted: Record<string, number> }) =>
      write((list) => mergeHistories({ conversations: list, deleted: readDeleted(owner) }, merged).conversations),
    [write],
  )

  const now = useCallback(() => {
    if (scope === null || !syncIsOn(scope)) return
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    setBusy(true)
    void (async () => {
      do {
        again.current = false
        try {
          const merged = await syncHistory(scope, loadConversations(scope).list)
          if (merged !== null) apply(scope, merged)
          setSyncedAt(Date.now())
          setError(null)
        } catch (e) {
          setError(e instanceof SyncError ? e.message : 'The history could not be synced.')
          again.current = false
        }
      } while (again.current)
      running.current = false
      setBusy(false)
      setOn(syncIsOn(scope))
    })()
  }, [scope, apply])

  const soon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(now, 1500)
  }, [now])
  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    setOn(scope !== null && syncIsOn(scope))
    setSyncedAt(null)
    setError(null)
    now()
    const back = () => {
      if (document.visibilityState === 'visible') now()
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [scope, now])

  const turnOn = useCallback(
    async (passphrase: string) => {
      if (scope === null) return false
      setBusy(true)
      setError(null)
      try {
        apply(scope, await turnOnSync(scope, passphrase, loadConversations(scope).list))
        setOn(true)
        setSyncedAt(Date.now())
        return true
      } catch (e) {
        turnOffSync(scope)
        setError(e instanceof SyncError ? e.message : 'Sync could not be turned on.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [scope, apply],
  )

  const turnOff = useCallback(() => {
    if (scope === null) return
    clearTimeout(timer.current)
    turnOffSync(scope)
    setOn(false)
    setError(null)
  }, [scope])

  const deleteCopy = useCallback(async () => {
    if (scope === null) return
    setBusy(true)
    try {
      await deleteSyncedCopy(scope)
      clearTimeout(timer.current)
      setOn(false)
      setError(null)
    } catch (e) {
      setError(e instanceof SyncError ? e.message : 'The synced copy could not be deleted.')
    } finally {
      setBusy(false)
    }
  }, [scope])

  return { on, busy, syncedAt, error, turnOn, turnOff, deleteCopy, now, soon }
}

const textButton = cn('text-caption text-muted disabled:opacity-50', inlineLink)

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Where the conversations are kept, and the switch that syncs them. */
export function HistorySyncPanel({ sync }: { sync: HistorySync }) {
  const [asking, setAsking] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (sync.on) {
    return (
      <div className="mt-1 space-y-1 px-2" data-testid="history-sync" data-sync="on">
        <p className="text-caption text-faint">
          Encrypted and synced across your devices
          {sync.busy ? ' · syncing…' : sync.syncedAt !== null ? <> · <span className="font-figure">{clock(sync.syncedAt)}</span></> : ''}
        </p>
        {sync.error !== null ? (
          <p className="text-caption text-ink" role="alert">
            {sync.error}
          </p>
        ) : null}
        {confirmingDelete ? (
          <div className="space-y-1">
            <p className="text-caption text-ink">Delete the synced copy? This browser keeps its conversations; a device still syncing stores its own again.</p>
            <div className="flex gap-3">
              <button type="button" className={textButton} disabled={sync.busy} onClick={() => void sync.deleteCopy().then(() => setConfirmingDelete(false))}>
                Delete it
              </button>
              <button type="button" className={textButton} onClick={() => setConfirmingDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <button type="button" className={textButton} disabled={sync.busy} onClick={sync.now}>
              Sync now
            </button>
            <button type="button" className={textButton} onClick={sync.turnOff}>
              Stop syncing here
            </button>
            <button type="button" className={textButton} onClick={() => setConfirmingDelete(true)}>
              Delete synced copy
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-1 space-y-1 px-2" data-testid="history-sync" data-sync="off">
      <p className="text-caption text-faint">Kept in this browser only.</p>
      {sync.error !== null ? (
        <p className="text-caption text-ink" role="alert">
          {sync.error}
        </p>
      ) : null}
      {asking ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (passphrase.length < 8) return
            void sync.turnOn(passphrase).then((done) => {
              if (done) {
                setPassphrase('')
                setAsking(false)
              }
            })
          }}
        >
          <p className="text-caption text-muted">
            Your conversations are encrypted in this browser with a passphrase before they are stored, so Talyvor cannot
            read them. Use the same passphrase on your other devices. A forgotten passphrase cannot be recovered.
          </p>
          <Input
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            aria-label="Sync passphrase"
            placeholder="Passphrase, 8 characters or more"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={sync.busy}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={passphrase.length < 8 || sync.busy}>
              {sync.busy ? 'Turning on…' : 'Turn on sync'}
            </Button>
            <Button
              type="button"
              disabled={sync.busy}
              onClick={() => {
                setPassphrase('')
                setAsking(false)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" className={textButton} onClick={() => setAsking(true)}>
          Sync across devices
        </button>
      )}
    </div>
  )
}
