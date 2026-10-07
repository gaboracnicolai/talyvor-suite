import type { ChatMessage } from './chatApi'
import { isHtmlLang, parseBlocks } from './Markdown'

// B28.120 — the canvas. An answer's HTML code blocks are its artifacts: each opens beside the conversation, drawn as a
// page, and an edit made to it there is kept with the conversation — in this browser, like the rest of it (history.ts).

/** The HTML an answer wrote: one per ```html block at its top level, in the order it wrote them. */
export function htmlArtifacts(answer: string): string[] {
  return parseBlocks(answer).flatMap((b) => (b.kind === 'code' && isHtmlLang(b.lang) ? [b.code] : []))
}

/** Artifact `n` of an answer as it stands: its last saved edit, else as the answer wrote it; undefined when it has none. */
export function artifactHtml(message: ChatMessage | undefined, n: number): string | undefined {
  if (message?.role !== 'assistant') return undefined
  const written = htmlArtifacts(message.content)[n]
  if (written === undefined) return undefined
  return message.artifact_edits?.[n] ?? written
}

/** The thread with artifact `n` of the answer at `at` saved as `html`. The answer's own HTML is no edit: saved back to
 *  it, the edit is dropped. */
export function withArtifactEdit(messages: readonly ChatMessage[], at: number, n: number, html: string): ChatMessage[] {
  return messages.map((m, i) => {
    if (i !== at) return m
    const { artifact_edits: prior = {}, ...rest } = m
    const { [n]: _was, ...others } = prior
    const edits = html === htmlArtifacts(m.content)[n] ? others : { ...others, [n]: html }
    return Object.keys(edits).length === 0 ? rest : { ...rest, artifact_edits: edits }
  })
}

/** What the canvas calls an artifact: the page's own <title>, else "HTML" and its place in the answer. */
export function artifactTitle(html: string, n: number): string {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
  return title === '' ? `HTML ${n + 1}` : title
}
