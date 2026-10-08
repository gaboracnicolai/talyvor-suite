import { useRef, useState } from 'react'

import { cn, inlineLink } from '@talyvor/ui'

import { download } from '../track/issueExport'
import type { Conversation } from './history'
import { type Imported, exportFile, exportName, readExport } from './transfer'

// B28.128 — Export and Import under the conversation list. Export downloads every conversation kept in this browser as
// one file; Import reads such a file (or one chat's, from Share) into this browser's list. See transfer.ts.

/** Downloads `list` as an export file. */
export function exportConversations(list: Conversation[]): void {
  const now = Date.now()
  download(exportName(list, now), 'application/json', exportFile(list, now))
}

const textButton = cn('text-caption text-muted disabled:opacity-50', inlineLink)

const many = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'conversation' : 'conversations'}`

/** What the screen says an import did. */
export function importedSentence(r: Imported): string {
  const brought = r.added + r.updated
  if (brought === 0) return r.already === 0 ? 'That file holds no conversations.' : 'Every conversation in that file is already here.'
  const here = r.already === 0 ? '' : ` ${many(r.already)} ${r.already === 1 ? 'was' : 'were'} already here.`
  return `Imported ${many(brought)}.${here}`
}

/** The file's text, or null when the browser could not read it. */
function readText(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => resolve(null)
    reader.readAsText(file)
  })
}

/** `canExport` while this browser's list is read and holds a conversation; `onImport` puts the file's conversations in
 *  the list and answers what that did. */
export function ExportImport({
  list,
  canExport,
  onImport,
}: {
  list: Conversation[]
  canExport: boolean
  onImport: (incoming: Conversation[]) => Imported
}) {
  const picker = useRef<HTMLInputElement>(null)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  return (
    <div className="mt-1 space-y-1 px-2" data-testid="history-transfer">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <button type="button" className={textButton} disabled={!canExport} onClick={() => exportConversations(list)}>
          Export all
        </button>
        <button type="button" className={textButton} onClick={() => picker.current?.click()}>
          Import
        </button>
        <input
          ref={picker}
          type="file"
          accept="application/json,.json"
          aria-label="Conversations file to import"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file === undefined) return
            void readText(file).then((text) => {
              const read = text === null ? { error: 'That file could not be read.' } : readExport(text, Date.now())
              setSaid('error' in read ? { ok: false, text: read.error } : { ok: true, text: importedSentence(onImport(read.conversations)) })
            })
          }}
        />
      </div>
      {said !== null ? (
        <p className="text-caption text-ink" role={said.ok ? 'status' : 'alert'}>
          {said.text}
        </p>
      ) : null}
    </div>
  )
}
