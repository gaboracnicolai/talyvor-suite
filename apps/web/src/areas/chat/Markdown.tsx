import { Fragment, type ReactNode } from 'react'

import { CopyButton } from './CopyButton'

// B10.3 — a reply renders as Markdown: headings, lists, tables, quotes and code blocks with a Copy
// button.
//
// ⚠ IT BUILDS REACT ELEMENTS AND NEVER HTML. A model's answer is text from outside this product;
// rendering it through innerHTML would hand whatever it contains to the page. Here every piece of it
// ends up as a React text node, and a link is emitted only for http(s) and mailto targets.
//
// ⚠ IT IS FED HALF A MESSAGE, MANY TIMES A SECOND. Every delta re-renders the whole answer, so the
// parser must be total: an unclosed code fence is a code block still being written, an unclosed
// `**` is literal text until its partner arrives, and nothing throws on a prefix.

type Align = 'left' | 'center' | 'right' | null

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'quote'; body: string }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }
  | { kind: 'rule' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const BULLET = /^( {0,3})([-*+])\s+(.*)$/
const ORDERED = /^( {0,3})(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** A closing fence: the opening character, at least as many of it, and nothing else. */
function closesFence(line: string, marker: string): boolean {
  const t = line.trim()
  return t.length >= marker.length && t === marker[0].repeat(t.length)
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_DELIMITER.test(next) && next.includes('-'))
  )
}

/** Splits Markdown into blocks. Total: every input, including half of one, yields blocks. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[1]
      const body: string[] = []
      i++
      // No closing fence yet is a block still streaming in: everything after it is its code.
      while (i < lines.length && !closesFence(lines[i], marker)) {
        body.push(lines[i])
        i++
      }
      i++ // the closing fence, if there was one
      blocks.push({ kind: 'code', lang: fence[2], code: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    const next = lines[i + 1]
    if (line.includes('|') && next !== undefined && TABLE_DELIMITER.test(next) && next.includes('-')) {
      const header = splitRow(line)
      const align: Align[] = splitRow(next).map((d) => {
        const l = d.startsWith(':')
        const r = d.endsWith(':')
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null
      })
      const rows: string[][] = []
      i += 2
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', header, align, rows })
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && !isBlank(lines[i])) {
        const q = QUOTE.exec(lines[i])
        body.push(q !== null ? q[1] : lines[i])
        i++
      }
      blocks.push({ kind: 'quote', body: body.join('\n') })
      continue
    }

    const bullet = BULLET.exec(line)
    const ordered = bullet === null ? ORDERED.exec(line) : null
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null
      const marker = isOrdered ? ORDERED : BULLET
      const start = isOrdered ? Number(ordered[2]) : 1
      const items: string[] = []
      let current: string[] = []
      let indent = 0
      while (i < lines.length) {
        const l = lines[i]
        const m = marker.exec(l)
        if (m !== null) {
          if (current.length > 0) items.push(current.join('\n'))
          current = [m[3]]
          // Continuation lines are de-indented by the width of "1. " / "- " so a nested list
          // inside an item parses as a list of its own.
          indent = m[1].length + (isOrdered ? m[2].length + 2 : 2)
          i++
          continue
        }
        if (isBlank(l)) {
          // A blank line ends the list unless the next line is still indented into the item.
          const after = lines[i + 1]
          if (after !== undefined && /^\s+\S/.test(after) && after.length - after.trimStart().length >= indent) {
            current.push('')
            i++
            continue
          }
          break
        }
        const leading = l.length - l.trimStart().length
        if (leading >= indent || (leading > 0 && (BULLET.test(l.trimStart()) || ORDERED.test(l.trimStart())))) {
          current.push(l.slice(Math.min(leading, indent)))
          i++
          continue
        }
        // A lazy continuation: plain text directly under an item belongs to it.
        if (!startsBlock(l, lines[i + 1])) {
          current.push(l.trim())
          i++
          continue
        }
        break
      }
      if (current.length > 0) items.push(current.join('\n'))
      blocks.push({ kind: 'list', ordered: isOrdered, start, items })
      continue
    }

    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = [line.trim()]
    i++
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      para.push(lines[i].trim())
      i++
    }
    blocks.push({ kind: 'paragraph', text: para.join('\n') })
  }
  return blocks
}

// Inline spans. The order of the alternation is the precedence: code first, so `**` inside a code
// span stays literal.
const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9])|\*(?=[^\s*])([\s\S]*?[^\s*])\*|(?<![A-Za-z0-9])_(?=[^\s_])([\s\S]*?[^\s_])_(?![A-Za-z0-9])|\[([^\]\n]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)|<((?:https?:\/\/|mailto:)[^>\s]+)>/g

function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null
}

function renderInline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  // A fresh instance per call: renderInline recurses, and a shared /g regex shares lastIndex.
  const re = new RegExp(INLINE.source, 'g')
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(...withBreaks(text.slice(last, m.index), `${key}.t${n}`))
    const k = `${key}.${n++}`
    if (m[2] !== undefined) {
      out.push(
        <code key={k} className="rounded-control bg-surface px-1 font-mono text-ink">
          {m[2].replace(/^ (.*) $/, '$1')}
        </code>,
      )
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(
        <strong key={k} className="font-semibold">
          {renderInline(m[3] ?? m[4], k)}
        </strong>,
      )
    } else if (m[5] !== undefined || m[6] !== undefined) {
      out.push(<em key={k}>{renderInline(m[5] ?? m[6], k)}</em>)
    } else if (m[7] !== undefined) {
      const href = safeHref(m[8])
      out.push(
        href === null ? (
          <Fragment key={k}>{m[7]}</Fragment>
        ) : (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="underline">
            {renderInline(m[7], k)}
          </a>
        ),
      )
    } else if (m[9] !== undefined) {
      out.push(
        <a key={k} href={m[9]} target="_blank" rel="noopener noreferrer" className="underline">
          {m[9]}
        </a>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(...withBreaks(text.slice(last), `${key}.t${n}`))
  return out
}

/** A single newline inside a paragraph is a soft break in Markdown; a reply reads better keeping it. */
function withBreaks(text: string, key: string): ReactNode[] {
  const parts = text.replace(/\\([\\`*_[\]()#|>-])/g, '$1').split('\n')
  return parts.flatMap((p, i) => (i === 0 ? [p] : [<br key={`${key}.br${i}`} />, p]))
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-rule bg-surface">
      <div className="flex items-center justify-between border-b border-rule pl-3 pr-1">
        <span className="font-figure text-eyebrow uppercase text-faint">{lang === '' ? 'code' : lang}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-body text-ink">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const HEADING_CLASS: Record<number, string> = {
  1: 'text-title text-ink',
  2: 'text-head text-ink',
  3: 'text-body font-semibold text-ink',
}

const ALIGN_CLASS: Record<Exclude<Align, null>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

function renderBlocks(blocks: Block[], key: string, tight = false): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${key}.${i}`
    switch (b.kind) {
      case 'heading': {
        // Reply headings sit below the page's <h1> and the conversation's title, so they start at
        // <h3>; a model's "# Title" must not claim the page.
        const Tag = (['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const)[b.level - 1]
        return (
          <Tag key={k} className={HEADING_CLASS[b.level] ?? 'text-body font-semibold text-ink'}>
            {renderInline(b.text, k)}
          </Tag>
        )
      }
      case 'paragraph':
        return tight ? (
          <Fragment key={k}>{renderInline(b.text, k)}</Fragment>
        ) : (
          <p key={k}>{renderInline(b.text, k)}</p>
        )
      case 'code':
        return <CodeBlock key={k} lang={b.lang} code={b.code} />
      case 'rule':
        return <hr key={k} className="border-rule" />
      case 'quote':
        return (
          <blockquote key={k} className="space-y-3 border-l-2 border-rule-strong pl-4 text-muted">
            {renderBlocks(parseBlocks(b.body), k)}
          </blockquote>
        )
      case 'list': {
        const items = b.items.map((item, j) => {
          const inner = parseBlocks(item)
          const isTight = inner.length <= 1 || (inner[0].kind === 'paragraph' && inner.slice(1).every((x) => x.kind === 'list'))
          return (
            <li key={`${k}.${j}`} className="space-y-2 pl-1">
              {renderBlocks(inner, `${k}.${j}`, isTight)}
            </li>
          )
        })
        return b.ordered ? (
          <ol key={k} start={b.start} className="list-decimal space-y-1 pl-6">
            {items}
          </ol>
        ) : (
          <ul key={k} className="list-disc space-y-1 pl-6">
            {items}
          </ul>
        )
      }
      case 'table':
        return (
          <div key={k} className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr>
                  {b.header.map((h, j) => (
                    <th
                      key={j}
                      className={`border-b border-rule-strong px-3 py-2 font-semibold text-ink ${ALIGN_CLASS[b.align[j] ?? 'left']}`}
                    >
                      {renderInline(h, `${k}.h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {b.header.map((_, j) => (
                      <td key={j} className={`border-b border-rule px-3 py-2 ${ALIGN_CLASS[b.align[j] ?? 'left']}`}>
                        {renderInline(row[j] ?? '', `${k}.${r}.${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
  })
}

/** A chat reply, rendered from Markdown. */
export function Markdown({ source }: { source: string }) {
  return <div className="space-y-3 text-body text-ink">{renderBlocks(parseBlocks(source), 'md')}</div>
}
